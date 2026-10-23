/**
 * Provider "animegg": extrai o MP4 direto do site, sem API de terceiros.
 *
 * PORQUÊ: é o único site testado que responde a IPs de datacenter (Render
 * incluído), entrega H.264 (`avc1`) — que o WhatsApp reproduz — e não precisa de
 * browser: a extração é `fetch` + regex. O anikoto só publica 1080p e o
 * animeheaven não tem catálogo recente; o animegg preenche esse espaço.
 *
 * COMO: a cadeia é toda em HTML estático, sem JavaScript:
 *
 *   GET /search/?q=<termo>       → href="/series/<slug>"
 *   GET /series/<slug>           → href="/<slug>-episode-<n>"
 *   GET /<slug>-episode-<n>      → href="/embed/<id>"
 *   GET /embed/<id>              → var videoSources = [{file, label}, ...]
 *   GET /play/<id>/video.mp4?for=<n>  → 302 para o CDN (vidcache.net)
 *
 * Cada entrada de `videoSources` é um degrau de qualidade (`360p`/`480p`/`720p`).
 * O rótulo diz a resolução, mas NÃO o tamanho: medido num episódio de 24 min,
 * 360p = 31 MB, 480p = 80 MB e 720p = 201 MB — ou seja, o 720p passa o teto de
 * 200 MB. Por isso a escolha é feita aqui, por `Content-Length`, e não pelo
 * rótulo. O degrau preferido é `ANIME_GG_MAX_HEIGHT` (480p).
 *
 * LIMITE CONHECIDO: em ~1 de cada 8 episódios o embed traz
 * `var videoSources = []` e não há fonte nenhuma. A falha é persistente (não
 * passa a repetir), pelo que o fluxo tem de cair para o provider seguinte — ver
 * o fallback em `src/services/anime.js`.
 *
 * @author Dev Gui
 */
import {
  ANIME_API_TIMEOUT_MS,
  ANIME_GG_MAX_HEIGHT,
  ANIME_MAX_DOWNLOAD_BYTES,
  ANIME_USER_AGENT,
} from "../config.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { audioVersionLabel } from "../utils/animeFormat.js";
import { AnimeApiError } from "./anime.js";

const BASE = "https://www.animegg.org";
const REQUEST_TIMEOUT_MS = Math.min(ANIME_API_TIMEOUT_MS, 20 * 1000);

async function fetchText(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": ANIME_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(referer ? { Referer: referer } : {}),
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Segue o 302 do `/play/` e devolve o URL final do CDN, ou null. */
async function resolverPlay(playPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetch(`${BASE}${playPath}`, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": ANIME_USER_AGENT, Referer: `${BASE}/` },
    });

    return response.headers.get("location") || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Tamanho em bytes do recurso, ou 0 quando o servidor não responde. */
async function tamanhoDe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": ANIME_USER_AGENT, Referer: `${BASE}/` },
    });

    if (!response.ok) return 0;
    return Number(response.headers.get("content-length")) || 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extrai os resultados de pesquisa do HTML.
 *
 * Cada resultado é um `<a class="mse" href="/series/<slug>">` com o título no
 * `<h2>` e a capa no `<img>`.
 *
 * @param {string} html
 * @returns {Array<{slug: string, title: string, image: string|null}>}
 */
export function parseSearch(html) {
  const vistos = new Set();
  const resultados = [];

  for (const [, slug, bloco] of String(html ?? "").matchAll(
    /<a\s+href="\/series\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    if (vistos.has(slug)) continue;

    const titulo = bloco.match(/<h2>\s*([^<]{1,140}?)\s*<\/h2>/i)?.[1];
    if (!titulo) continue;

    vistos.add(slug);
    resultados.push({
      slug,
      title: titulo.trim(),
      image: bloco.match(/<img[^>]+src="([^"]+)"/i)?.[1] || null,
    });
  }

  return resultados;
}

/**
 * Extrai os números dos episódios da página da série.
 *
 * @param {string} html
 * @param {string} slug
 * @returns {Array<number>}
 */
export function parseEpisodes(html, slug) {
  const escapado = String(slug).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const padrao = new RegExp(`href="/${escapado}-episode-(\\d+)"`, "gi");
  const numeros = new Set();

  for (const [, numero] of String(html ?? "").matchAll(padrao)) {
    numeros.add(Number(numero));
  }

  return [...numeros].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
}

/**
 * Faixas publicadas de cada episódio da página da série.
 *
 * O site marca cada faixa com um link próprio e um fragmento:
 *
 *   <a href="/naruto-episode-220#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a>
 *   <a href="/one-piece-episode-1156#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>
 *
 * O fragmento é o sinal fiável: há episódios com as duas faixas, outros só com
 * uma. Ler isto evita prometer uma faixa que o episódio não tem.
 *
 * @param {string} html
 * @param {string} slug
 * @returns {Map<number, string[]>} número do episódio → faixas publicadas
 */
export function parseEpisodeVersions(html, slug) {
  const escapado = String(slug).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const padrao = new RegExp(
    `href="/${escapado}-episode-(\\d+)#(subbed|dubbed)"`,
    "gi",
  );
  const mapa = new Map();

  for (const [, numero, versao] of String(html ?? "").matchAll(padrao)) {
    const chave = Number(numero);
    if (!Number.isFinite(chave) || chave <= 0) continue;

    const faixa = versao.toLowerCase();
    const lista = mapa.get(chave) || [];
    if (!lista.includes(faixa)) lista.push(faixa);

    mapa.set(chave, lista);
  }

  return mapa;
}

/**
 * Extrai os degraus de qualidade do `var videoSources` do embed.
 *
 * @param {string} html
 * @returns {Array<{file: string, label: string, height: number}>}
 */
export function parseVideoSources(html) {
  const array = String(html ?? "").match(/var\s+videoSources\s*=\s*(\[[\s\S]*?\])\s*;/)?.[1];
  if (!array) return [];

  const fontes = [];

  for (const [, bloco] of array.matchAll(/\{([^{}]*)\}/g)) {
    const file = bloco.match(/file:\s*"([^"]+)"/)?.[1];
    if (!file) continue;

    const label = bloco.match(/label:\s*"([^"]+)"/)?.[1] || "";

    fontes.push({
      file,
      label,
      height: Number(label.replace(/\D/g, "")) || 0,
    });
  }

  return fontes;
}

/**
 * Ordena os degraus pela distância ao preferido.
 *
 * O degrau preferido (`ANIME_GG_MAX_HEIGHT`, 480p por padrão) vem primeiro; se
 * faltar, tenta-se o imediatamente abaixo antes do acima, porque subir de
 * resolução arrisca passar o teto de 200 MB.
 *
 * @param {Array<{file: string, label: string, height: number}>} fontes
 * @returns {Array<{file: string, label: string, height: number}>}
 */
export function ordenarPorPreferencia(fontes, preferido = ANIME_GG_MAX_HEIGHT) {
  const distancia = (fonte) => {
    if (!fonte.height) return 1000;
    if (fonte.height === preferido) return 0;
    // Abaixo do preferido vale mais que acima (acima pode exceder o limite).
    return fonte.height < preferido
      ? preferido - fonte.height
      : (fonte.height - preferido) * 10;
  };

  return [...fontes].sort((a, b) => distancia(a) - distancia(b));
}

/**
 * Escolhe o degrau a descarregar.
 *
 * O rótulo dá a resolução mas não o tamanho, e o mesmo episódio mede 31 MB em
 * 360p e 201 MB em 720p: por isso cada candidato é medido por `Content-Length` e
 * o primeiro que caiba no teto ganha. Quando nenhum responde, devolve o preferido
 * na mesma — o yt-dlp volta a verificar o limite e o erro é reportado.
 *
 * @param {Array<{file: string, label: string, height: number}>} fontes
 * @returns {Promise<{url: string, quality: string}|null>}
 */
export async function escolherDegrau(fontes) {
  const candidatos = ordenarPorPreferencia(fontes);
  if (!candidatos.length) return null;

  let primeiroResolvido = null;

  for (const candidato of candidatos) {
    const url = await resolverPlay(candidato.file);
    if (!url) continue;

    const tamanho = await tamanhoDe(url);
    const caber = tamanho > 0 && tamanho <= ANIME_MAX_DOWNLOAD_BYTES;

    if (!primeiroResolvido) primeiroResolvido = { url, quality: candidato.label };

    if (caber) {
      infoLog(
        `[anime] animegg degrau ${candidato.label} (${(tamanho / 1048576).toFixed(0)} MB)`,
      );
      return { url, quality: candidato.label };
    }

    errorLog(
      `[anime] animegg degrau ${candidato.label} descartado (${tamanho} bytes)`,
    );
  }

  return primeiroResolvido;
}

/**
 * Escolhe o embed do episódio, pela faixa pedida.
 *
 * A página do episódio traz uma aba por faixa, cada uma com o seu `iframe`:
 *
 *   <li><a href="#subbed-Animegg" data-version="subbed" data-id='27657'>SUBBED</a></li>
 *   <li><a href="#dubbed-Animegg" data-version="dubbed" data-id='27658'>DUBBED</a></li>
 *   <div id="subbed-Animegg"><iframe src="/embed/27657"></iframe></div>
 *   <div id="dubbed-Animegg"><iframe src="/embed/27658"></iframe></div>
 *
 * Ler o `data-version` junto do `data-id` (e não só o primeiro iframe) é o que
 * evita servir sempre o legendado: o `subbed` vem primeiro no HTML, portanto o
 * "primeiro embed" era o legendado mesmo quando o utilizador queria o dublado.
 *
 * Sem faixa pedida, mantém-se o comportamento antigo — o primeiro embed — que
 * é o único caminho possível para as páginas sem abas identificadas.
 *
 * @param {string} html
 * @param {string} [audioVersion]
 * @returns {string|null}
 */
export function escolherEmbed(html, audioVersion = "") {
  const pagina = String(html ?? "");
  // Whitelist: o valor vem de um token do menu e é interpolado num regex, pelo
  // que só as faixas conhecidas podem chegar ao padrão.
  const pedida = ["subbed", "dubbed"].includes(
    String(audioVersion || "").trim().toLowerCase(),
  )
    ? String(audioVersion).trim().toLowerCase()
    : "";

  if (pedida) {
    const padrao = new RegExp(
      `data-version="${pedida}"[^>]*data-id='(\\d+)'|data-id='(\\d+)'[^>]*data-version="${pedida}"`,
      "i",
    );
    const porAtributo = pagina.match(padrao);

    if (porAtributo) return porAtributo[1] || porAtributo[2];

    // Variante sem `data-id` no mesmo elemento: usa o painel da aba.
    const painel = new RegExp(
      `id="${pedida}-[^"]*"[\\s\\S]{0,400}?src="/embed/(\\d+)"`,
      "i",
    ).exec(pagina);

    if (painel) return painel[1];

    return null;
  }

  return pagina.match(/(?:src|href)="\/embed\/(\d+)"/)?.[1] || null;
}

/**
 * Pesquisa animes e devolve os resultados com o slug de cada um.
 *
 * @param {string} termo
 * @returns {Promise<Array<{id: string, slug: string, title: string, image: string|null}>>}
 */
export async function search(termo) {
  const html = await fetchText(
    `${BASE}/search/?q=${encodeURIComponent(termo)}`,
    `${BASE}/`,
  );

  return parseSearch(html).map(({ slug, title, image }) => ({
    id: slug,
    slug,
    title,
    image,
  }));
}

/**
 * Episódios de um anime, a partir do slug da série.
 *
 * @param {string} animeId
 * @param {string} slug
 * @returns {Promise<Array<{id: string, number: number, ids: string}>>}
 */
export async function episodes(animeId, slug) {
  const serie = String(slug || animeId).split(":")[0];
  const html = await fetchText(`${BASE}/series/${encodeURIComponent(serie)}`, `${BASE}/`);
  const numeros = parseEpisodes(html, serie);

  if (!numeros.length) {
    throw new AnimeApiError("Este anime não tem episódios disponíveis na fonte.");
  }

  const faixas = parseEpisodeVersions(html, serie);

  return numeros.map((numero) => {
    const id = `${serie}-episode-${numero}`;
    return { id, number: numero, ids: id, versions: faixas.get(numero) || [] };
  });
}

/**
 * Link do MP4 direto de um episódio, na faixa e no degrau pedidos.
 *
 * @param {{id: string, ids: string}} episodio
 * @param {string} slug
 * @param {string} [audioVersion] "subbed" ou "dubbed"
 * @returns {Promise<{url: string, quality: string, isM3U8: boolean}>}
 */
export async function sources(episodio, slug, audioVersion = "") {
  const paginaEp = String(episodio?.ids || episodio?.id || "").trim();

  if (!paginaEp) {
    throw new AnimeApiError("Este episódio não tem um link válido na fonte.");
  }

  const serie = String(slug || "").split(":")[0] || paginaEp.replace(/-episode-\d+$/, "");
  const referer = `${BASE}/${paginaEp}`;
  const pagina = await fetchText(referer, `${BASE}/series/${serie}`);
  const embedId = escolherEmbed(pagina, audioVersion);

  if (!embedId) {
    // A faixa pedida pode não existir (a lista dizia que sim, mas o site mudou).
    // O erro diz qual foi, para o utilizador perceber o que aconteceu.
    const pedida = audioVersionLabel(audioVersion);
    throw new AnimeApiError(
      pedida
        ? `Esta faixa (${pedida}) não está disponível neste episódio.`
        : "Nenhum link de streaming foi encontrado para este episódio.",
    );
  }

  const embed = await fetchText(`${BASE}/embed/${embedId}`, referer);
  const degraus = parseVideoSources(embed);

  if (!degraus.length) {
    // Caso conhecido (~1 em 8 episódios): o embed responde
    // "Please wait while the video is loading..." com `videoSources = []`.
    // Não adianta repetir — o fluxo deve cair para o provider seguinte.
    throw new AnimeApiError(
      "A fonte não tem vídeo para este episódio. A tentar outra fonte...",
    );
  }

  const escolhido = await escolherDegrau(degraus);

  if (!escolhido?.url) {
    throw new AnimeApiError(
      "Nenhum link de streaming foi encontrado para este episódio.",
    );
  }

  infoLog(`[anime] animegg episódio resolvido em ${escolhido.url.split("/")[2]}`);

  // Objeto (e não só o URL) para o fluxo saber que é MP4 direto: o rótulo de
  // qualidade e o `--max-filesize` comportam-se de forma diferente de um HLS.
  return { url: escolhido.url, quality: escolhido.quality, isM3U8: false };
}

/**
 * Encontra o primeiro resultado que tenha episódios, devolvendo o par
 * (anime, episódios) pronto para o menu.
 *
 * @param {string} termo
 * @returns {Promise<{anime: object, episodes: Array<object>}>}
 */
export async function searchWithEpisodes(termo) {
  const resultados = await search(termo);
  if (!resultados.length) {
    throw new AnimeApiError(`Nenhum anime encontrado para "${termo}".`);
  }

  for (const anime of resultados) {
    try {
      const lista = await episodes(anime.id, anime.slug);
      if (lista.length) return { anime, episodes: lista };
    } catch (error) {
      errorLog(`[anime] animegg "${anime.title}" sem episódios: ${error.message}`);
    }
  }

  throw new AnimeApiError(
    `Os resultados de "${termo}" não têm episódios disponíveis nesta fonte.`,
  );
}
