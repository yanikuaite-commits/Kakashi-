/**
 * Provider "animeheaven": extrai o MP4 direto do site, sem API de terceiros.
 *
 * PORQUÊ: o `anikoto` (HiAnime) só publica UMA variante, em 1080p, o que obriga
 * a baixar ~350 MB e a reduzir localmente com o ffmpeg. O AnimeHeaven publica o
 * episódio em 720p nativo (~95–128 MB), já dentro do teto de 200 MB: não há
 * compressão nem downscale, e o download termina muito mais rápido.
 *
 * COMO: o site é PHP simples, sem Cloudflare e responde a IPs de datacenter
 * (Render incluído). A cadeia é:
 *
 *   GET /search.php?s=<termo>          → resultados; id curto em anime.php?<id>
 *   GET /anime.php?<id>                → episódios; cada um tem um hash de 32 hex
 *   GET /gate.php  (cookie key=<hash>) → <source> com o MP4 direto por mirror
 *
 * O `gate.php` sem o cookie `key` responde 404 — o hash do episódio é a
 * credencial, e é por isso que o `sources` recebe o hash e não um id numérico.
 *
 * Nem todos os `<source>` são o episódio: o primeiro mirror (`ax`) serve um
 * trailer de ~3,7 s (88 KB). O yt-dlp não sabe distinguir (o URL é "video.mp4"
 * sem metadados), por isso o mirror é escolhido AQUI, por tamanho — ver
 * `escolherMirror`.
 *
 * @author Dev Gui
 */
import { ANIME_API_TIMEOUT_MS, ANIME_USER_AGENT } from "../config.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { AnimeApiError } from "./anime.js";

const BASE = "https://animeheaven.me";

/**
 * Mirrors que nunca servem o episódio (medido em vários títulos):
 * - `ax` devolve sempre um trailer de ~3,7 s (88 KB);
 * - `ct` e `ck` respondem 0 bytes/erro.
 *
 * São ignorados antes de qualquer pedido, para não gastar um HEAD a cada um.
 * Os restantes (`rx`, `co`, `cy`, `ci`, `sr`, `rt`, `cx`, `cz`, ...) servem o
 * episódio completo e variam por título, por isso a escolha é por tamanho e não
 * por uma lista fixa.
 */
const MIRRORS_IGNORADOS = new Set(["ax", "ct", "ck"]);

const REQUEST_TIMEOUT_MS = Math.min(ANIME_API_TIMEOUT_MS, 20 * 1000);
const TAMANHO_MINIMO_EPISODIO = 1024 * 1024;

const HASH_EPISODIO = /^[a-f0-9]{32}$/i;

async function fetchText(url, { cookie, referer, method = "GET" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": ANIME_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(referer ? { Referer: referer } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Tamanho em bytes do recurso, ou 0 quando o servidor não responde. */
async function tamanhoDe(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": ANIME_USER_AGENT,
        ...(referer ? { Referer: referer } : {}),
      },
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
 * Puro (sem rede) para poder ser testado com HTML real capturado.
 *
 * @param {string} html
 * @returns {Array<{id: string, title: string}>}
 */
export function parseSearch(html) {
  const vistos = new Set();
  const resultados = [];

  for (const [, id, titulo] of String(html ?? "").matchAll(
    /href='anime\.php\?([a-z0-9]+)'[^>]*>([^<]{1,120})<\/a>/gi,
  )) {
    if (vistos.has(id)) continue;
    vistos.add(id);

    const nome = titulo.trim();
    if (nome) resultados.push({ id, title: nome });
  }

  return resultados;
}

/**
 * Extrai os episódios do HTML da página do anime.
 *
 * Cada episódio é um `<a>` com o hash de 32 hex no `id`/`gatea(...)` e o número
 * no `watch2`. O parsing é por bloco (`<a ...>...</a>`) para não depender da
 * ordem nem da posição dos atributos.
 *
 * @param {string} html
 * @returns {Array<{hash: string, number: number}>}
 */
export function parseEpisodes(html) {
  const episodios = [];

  for (const [, hash, bloco] of String(html ?? "").matchAll(
    /<a\b[^>]*id\s*=\s*"([a-f0-9]{32})"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const numero = Number(bloco.match(/watch2[^>]*>\s*(\d+)\s*</)?.[1]) || 0;
    if (numero) episodios.push({ hash, number: numero });
  }

  return episodios.sort((a, b) => a.number - b.number);
}

/**
 * Extrai os URLs MP4 (por mirror) do HTML do `gate.php`.
 *
 * @param {string} html
 * @returns {Array<{host: string, url: string}>}
 */
export function parseSources(html) {
  const fontes = [];
  const vistos = new Set();

  for (const [, url] of String(html ?? "").matchAll(
    /<source\s+src='(https:\/\/[^']+\.mp4[^']*)'/gi,
  )) {
    if (vistos.has(url)) continue;
    vistos.add(url);
    fontes.push({ host: url.match(/^https:\/\/([^.]+)\./)?.[1] || "", url });
  }

  return fontes;
}

/**
 * Escolhe o mirror que serve o episódio completo.
 *
 * Os mirrors conhecidos por nunca servirem o episódio (`ax` = trailer, `ct`/`ck`
 * = erro) são descartados antes de qualquer pedido. Dos restantes, o primeiro
 * que devolva um tamanho de episódio vence: a lista muda por título, por isso
 * não há uma ordem fixa fiável — o tamanho é a única prova de que aquilo é o
 * episódio e não um trailer.
 *
 * @param {Array<{host: string, url: string}>} fontes
 * @param {string} referer
 * @returns {Promise<string|null>}
 */
export async function escolherMirror(fontes, referer) {
  const candidatas = fontes.filter(
    (fonte) => !MIRRORS_IGNORADOS.has(String(fonte.host).toLowerCase()),
  );

  for (const fonte of candidatas) {
    const tamanho = await tamanhoDe(fonte.url, referer);
    if (tamanho >= TAMANHO_MINIMO_EPISODIO) return fonte.url;
    errorLog(
      `[anime] animeheaven mirror "${fonte.host}" ignorado (${tamanho} bytes)`,
    );
  }

  return null;
}

/**
 * Pesquisa animes e devolve os resultados com o id curto de cada um.
 *
 * @param {string} termo
 * @returns {Promise<Array<{id: string, slug: string, title: string, image: string|null}>>}
 */
export async function search(termo) {
  const html = await fetchText(
    `${BASE}/search.php?s=${encodeURIComponent(termo)}`,
    { referer: `${BASE}/` },
  );

  return parseSearch(html).map(({ id, title }) => ({
    id,
    slug: id,
    title,
    image: null,
  }));
}

/**
 * Episódios de um anime.
 *
 * O id chega como `"<idCurto>"` (o `slug` é o mesmo). Cada episódio devolve
 * `ids` igual ao hash para manter o formato que o resto do fluxo espera
 * (`<slug>::<epId>::<ids>`).
 *
 * @param {string} animeId
 * @param {string} slug
 * @returns {Promise<Array<{id: string, number: number, ids: string}>>}
 */
export async function episodes(animeId, slug) {
  const id = String(slug || animeId).split(":")[0];
  const html = await fetchText(`${BASE}/anime.php?${encodeURIComponent(id)}`, {
    referer: `${BASE}/`,
  });

  const lista = parseEpisodes(html);

  if (!lista.length) {
    throw new AnimeApiError("Este anime não tem episódios disponíveis na fonte.");
  }

  return lista.map(({ hash, number }) => ({
    id: hash,
    number,
    ids: hash,
  }));
}

/**
 * Link do MP4 direto de um episódio.
 *
 * @param {{id: string, ids: string}} episodio
 * @param {string} slug
 * @returns {Promise<string|null>}
 */
export async function sources(episodio, slug) {
  const hash = String(episodio?.ids || episodio?.id || "").trim();

  if (!HASH_EPISODIO.test(hash)) {
    throw new AnimeApiError("Este episódio não tem um link válido na fonte.");
  }

  const referer = `${BASE}/anime.php?${String(slug || "").split(":")[0]}`;
  const pagina = await fetchText(`${BASE}/gate.php`, {
    cookie: `key=${hash}`,
    referer,
  });

  const fontes = parseSources(pagina);

  if (!fontes.length) {
    throw new AnimeApiError(
      "Nenhum link de streaming foi encontrado para este episódio.",
    );
  }

  const url = await escolherMirror(fontes, `${BASE}/gate.php`);

  if (!url) {
    errorLog("[anime] animeheaven: todos os mirrors devolveram trailers");
    throw new AnimeApiError(
      "A fonte só devolveu pré-visualizações deste episódio. Tente outro episódio.",
    );
  }

  infoLog(`[anime] animeheaven episódio resolvido em ${url.split("/")[2]}`);

  // Devolve objeto (e não só o URL) para o fluxo saber que é MP4 direto: o
  // rótulo de qualidade e o `--max-filesize` comportam-se de forma diferente de
  // um HLS, e o yt-dlp lê os metadados reais do ficheiro.
  return { url, quality: "720p", isM3U8: false };
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
      errorLog(`[anime] animeheaven "${anime.title}" sem episódios: ${error.message}`);
    }
  }

  throw new AnimeApiError(
    `Os resultados de "${termo}" não têm episódios disponíveis nesta fonte.`,
  );
}
