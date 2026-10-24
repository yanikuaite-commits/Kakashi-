/**
 * Provider "anitube": extrai o vídeo do site, sem API de terceiros.
 *
 * PORQUÊ: é o segundo site testado que responde a IPs de datacenter e não precisa
 * de browser. Serve H.264, que o WhatsApp reproduz — ao contrário do anime7, cujo
 * MP4 é AV1.
 *
 * COMO: o site é WordPress, pelo que a pesquisa usa a REST API nativa
 * (`/wp-json/wp/v2/...`), que já devolve JSON e evita parsing de HTML de busca.
 * Cada episódio é um post próprio:
 *
 *   GET /wp-json/wp/v2/posts?search=<termo>&per_page=100  → posts (título + id)
 *   GET /video/<id>/                                      → <iframe src="...">
 *
 * O site serve o vídeo de DUAS formas, conforme a idade do episódio, e ambas
 * têm de ser lidas:
 *
 *   (a) HLS antigo: o iframe é `api.anivideo.net/videohls.php?d=<m3u8>` e o
 *       parâmetro `d` já é a playlist do CDN;
 *   (b) Blogger (formato novo): o iframe é `api.anivideo.net/file/<token>`, cujo
 *       HTML traz um token do `blogger.com/video.g`; essa página publica o
 *       `videoplayback` do Google Video (itag 18 = 360p, itag 22 = 720p).
 *
 * Sem o caso (b) o provider falhava em todos os episódios recentes com "Nenhum
 * link de streaming encontrado": a página deixou de publicar qualquer m3u8 e o
 * leitor antigo procurava só isso. A leitura do Blogger vive em `bloggerVideo.js`
 * (partilhada com o animesonlinehd, que usa o mesmo player).
 *
 * ATENÇÃO ao tamanho: no formato Blogger um episódio de 24 min mede ~64 MB em
 * 360p e ~162 MB em 720p — ambos dentro do teto. No HLS antigo o site publicava
 * só um degrau em 720p (~257 MB), pelo que esse caminho continua a medir a
 * playlist antes de descarregar e deixa o fallback passar ao provider seguinte.
 *
 * O agrupamento em séries é feito pelo título: os episódios de um anime são
 * posts com o mesmo nome-base e o número em "Episódio <n>", pelo que a série é
 * reconstruída a partir de uma pesquisa paginada.
 *
 * @author Dev Gui
 */
import { ANIME_API_TIMEOUT_MS, ANIME_MAX_DOWNLOAD_BYTES, ANIME_USER_AGENT } from "../config.js";
import { infoLog } from "../utils/logger.js";
import { AnimeApiError } from "./anime.js";
import { extrairDegraus, extrairIframes, extrairTokenBlogger } from "./bloggerVideo.js";

const BASE = "https://www.anitube.zip";
const REQUEST_TIMEOUT_MS = Math.min(ANIME_API_TIMEOUT_MS, 20 * 1000);
const MAX_PAGINAS = 6;

async function fetchText(url, referer, json = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": ANIME_USER_AGENT,
        Accept: json
          ? "application/json, text/plain, */*"
          : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        ...(referer ? { Referer: referer } : {}),
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return json ? await response.json() : await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Remove acentos e o ruído do título, para comparar nomes de série.
 *
 * O sufixo de episódio é retirado, mas "dublado"/"legendado" fica: são faixas
 * diferentes do mesmo anime e no site são posts distintos — juntá-las faria a
 * série misturar episódios das duas (e a deduplicação por número descartaria uma
 * delas em silêncio).
 */
function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*[-–—]\s*epis[oó]dio\s*\d+.*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Chave estável da série: o título sem o sufixo de episódio. */
export function chaveDaSerie(titulo) {
  return normalizar(titulo).replace(/\s+/g, "-");
}

/**
 * Faixa de áudio de um título de post.
 *
 * O site publica "dublado"/"legendado" no próprio título e o post é único, pelo
 * que o título é a fonte da verdade. Sem marca assume-se legendado: é o caso
 * comum no site e evita prometer dublagem onde ela não foi anunciada.
 *
 * @param {string} titulo
 * @returns {string} "dubbed" ou "subbed"
 */
export function versaoDoTitulo(titulo) {
  return /dublado|dublagem|\bdub\b/i.test(String(titulo ?? ""))
    ? "dubbed"
    : "subbed";
}

/**
 * Extrai o número do episódio do título ("... – Episódio 500" → 500).
 *
 * @param {string} titulo
 * @returns {number}
 */
export function numeroDoEpisodio(titulo) {
  return (
    Number(String(titulo ?? "").match(/epis[oó]dio\s*(\d+)/i)?.[1]) ||
    Number(String(titulo ?? "").match(/\b(?:ep|e)\s*(\d+)\b/i)?.[1]) ||
    0
  );
}

/**
 * Extrai o m3u8 do formato ANTIGO (iframe `videohls.php?d=<m3u8>`).
 *
 * O player monta um iframe (`api.anivideo.net/videohls.php?d=<m3u8>`) cujo
 * parâmetro `d` já é o m3u8 do CDN — é ESSE o URL a descarregar. A ordem importa:
 * o URL do player também contém ".m3u8" (dentro do `d`), pelo que um padrão
 * genérico de ".m3u8" casaria primeiro com o player e o yt-dlp tentaria baixar
 * uma página HTML. Por isso o `d` é lido primeiro e um `.m3u8` solto só serve de
 * recurso quando o player não aparece.
 *
 * Os episódios recentes já não publicam m3u8 nenhum; nesses a extração segue por
 * `extrairDoBlogger`.
 *
 * @param {string} html
 * @returns {{url: string, isM3U8: boolean}|null}
 */
export function parseVideoHls(html) {
  const conteudo = String(html ?? "");

  const dentroDoPlayer = conteudo.match(/videohls\.php\?d=([^"&\s]+)/i)?.[1];
  if (dentroDoPlayer) {
    const url = decodeURIComponent(dentroDoPlayer);
    if (/\.m3u8/i.test(url)) return { url, isM3U8: true };
  }

  const direto = conteudo.match(/https:\/\/(?!api\.anivideo\.net)[^"'\s&]+\.m3u8[^"'\s]*/)?.[0];
  if (direto) return { url: direto, isM3U8: true };

  return null;
}

/**
 * Segue o iframe do player até aos degraus do Blogger.
 *
 * O iframe aponta para o intermediário do site (`api.anivideo.net/file/<token>`),
 * cujo HTML traz o token do `blogger.com/video.g`; é essa página que publica o
 * `videoplayback` do Google Video. Cada iframe é tentado por ordem até um render
 * o token: a página pode trazer mais do que um e a ordem não é garantida.
 *
 * @param {string} html página do episódio
 * @returns {Promise<Array<{url: string, quality: string, isM3U8: boolean}>>}
 */
async function extrairDoBlogger(html) {
  for (const iframe of extrairIframes(html, BASE)) {
    const intermediario = await fetchText(iframe, `${BASE}/`).catch(() => "");
    const token = extrairTokenBlogger(intermediario);
    if (!token) continue;

    const pagina = await fetchText(
      `https://www.blogger.com/video.g?token=${token}`,
      "https://www.blogger.com/",
    );
    const degraus = extrairDegraus(pagina);
    if (degraus.length) return degraus;
  }

  return [];
}

/**
 * Estima o tamanho do HLS medindo alguns segmentos.
 *
 * O site não publica duração nem tamanho no HTML e a playlist não traz
 * `Content-Length`. Os segmentos têm todos ~10 s mas tamanhos muito diferentes
 * (o primeiro chega a 4,7 MB por trazer o cabeçalho, e o último cai para 0,1 MB),
 * pelo que medir só o primeiro sobrestima ~2,5x. Medindo 5 segmentos espalhados
 * pela lista a estimativa fica a ~4% do real (266 MB estimados contra 257 MB
 * medidos num episódio de 24 min).
 *
 * Sem esta verificação o utilizador só descobria o excesso no fim do download,
 * já depois de o ter feito por inteiro.
 *
 * @param {string} playlist
 * @returns {Promise<number>} bytes estimados, ou 0 quando não é possível medir
 */
async function estimarTamanho(playlist) {
  const segmentos = String(playlist ?? "").match(/^https?:\/\/\S+$/gm) || [];
  if (!segmentos.length) return 0;

  const passo = Math.max(1, Math.floor(segmentos.length / 5));
  const amostra = segmentos.filter((_, i) => i % passo === 0).slice(0, 5);

  const tamanhos = await Promise.all(
    amostra.map(async (segmento) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      timer.unref?.();

      try {
        const response = await fetch(segmento, {
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
    }),
  );

  const validos = tamanhos.filter((bytes) => bytes > 0);
  if (!validos.length) return 0;

  const media = validos.reduce((soma, bytes) => soma + bytes, 0) / validos.length;
  return Math.round(media * segmentos.length);
}

/**
 * Pesquisa posts de episódios e agrupa-os por série.
 *
 * @param {string} termo
 * @returns {Promise<Array<{slug: string, title: string, episodes: Array<{id: string, number: number}>}>>}
 */
export async function buscarSeries(termo) {
  const posts = [];

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
    let lote;
    try {
      lote = await fetchText(
        `${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(termo)}` +
          `&per_page=100&page=${pagina}&_fields=id,title`,
        `${BASE}/`,
        true,
      );
    } catch (error) {
      if (!posts.length) throw error;
      break;
    }

    if (!Array.isArray(lote) || !lote.length) break;
    posts.push(...lote);
    if (lote.length < 100) break;
  }

  const series = new Map();

  for (const post of posts) {
    const titulo = post?.title?.rendered || "";
    const numero = numeroDoEpisodio(titulo);
    if (!numero) continue;

    const slug = chaveDaSerie(titulo);
    if (!slug) continue;

    if (!series.has(slug)) {
      series.set(slug, {
        slug,
        title: titulo.replace(/\s*[-–—]\s*epis[oó]dio\s*\d+.*$/i, "").trim() || titulo,
        episodes: [],
      });
    }

    // A faixa sai do próprio título ("... - Episódio 12 Dublado"), que é como o
    // site separa os posts. Sem marca, assume-se legendado (o caso comum).
    series.get(slug).episodes.push({
      id: String(post.id),
      number: numero,
      versions: [versaoDoTitulo(titulo)],
    });
  }

  for (const serie of series.values()) {
    const vistos = new Set();
    serie.episodes = serie.episodes
      .filter((ep) => (vistos.has(ep.number) ? false : vistos.add(ep.number)))
      .sort((a, b) => a.number - b.number);
  }

  return [...series.values()].filter((serie) => serie.episodes.length);
}

/**
 * Pesquisa animes e devolve as séries encontradas.
 *
 * @param {string} termo
 * @returns {Promise<Array<{id: string, slug: string, title: string, image: string|null}>>}
 */
export async function search(termo) {
  const series = await buscarSeries(termo);

  return series.map((serie) => ({
    id: serie.slug,
    slug: serie.slug,
    title: serie.title,
    image: null,
  }));
}

/**
 * Episódios de uma série, identificada pelo slug reconstruído.
 *
 * @param {string} animeId
 * @param {string} slug
 * @returns {Promise<Array<{id: string, number: number, ids: string}>>}
 */
export async function episodes(animeId, slug) {
  const alvo = String(slug || animeId).split(":")[0];
  const series = await buscarSeries(alvo.replace(/-/g, " "));
  const serie = series.find((s) => s.slug === alvo) || series[0];

  if (!serie?.episodes?.length) {
    throw new AnimeApiError("Este anime não tem episódios disponíveis na fonte.");
  }

  return serie.episodes.map((ep) => ({
    id: ep.id,
    number: ep.number,
    ids: ep.id,
    versions: ep.versions || [],
  }));
}

/**
 * Links de vídeo de um episódio.
 *
 * O site publica o episódio em dois formatos conforme a idade do post, e ambos
 * são tentados: primeiro o m3u8 antigo (que já vem pronto no HTML e não precisa
 * de pedidos extra) e, se não houver, a cadeia do Blogger. Sem a segunda via os
 * episódios recentes falhavam sempre — o site deixou de publicar m3u8.
 *
 * @param {{id: string, ids: string}} episodio
 * @param {string} slug
 * @returns {Promise<Array<{url: string, quality: string, isM3U8: boolean}>>}
 */
export async function sources(episodio, slug) {
  const postId = String(episodio?.ids || episodio?.id || "").trim();

  if (!/^\d+$/.test(postId)) {
    throw new AnimeApiError("Este episódio não tem um link válido na fonte.");
  }

  const html = await fetchText(`${BASE}/video/${postId}/`, `${BASE}/`);

  const hls = parseVideoHls(html);

  if (hls?.url) {
    // O HLS antigo publica um único degrau, em 720p, e um episódio de 24 min
    // mede ~257 MB — acima do teto. Medir aqui evita um download inteiro que
    // acabaria cancelado, e deixa o fallback passar ao provider seguinte.
    const playlist = await fetchText(hls.url, `${BASE}/`);
    const tamanho = await estimarTamanho(playlist);

    if (tamanho > ANIME_MAX_DOWNLOAD_BYTES) {
      throw new AnimeApiError(
        `A fonte só tem este episódio em 720p (~${Math.round(tamanho / 1048576)} MB), ` +
          "acima do limite de envio. A tentar outra fonte...",
      );
    }

    infoLog(`[anime] anitube episódio resolvido (HLS, ${hls.url.split("/")[2]})`);

    return [{ url: hls.url, quality: "720p", isM3U8: true }];
  }

  const degraus = await extrairDoBlogger(html);

  if (!degraus.length) {
    throw new AnimeApiError(
      "Nenhum link de streaming foi encontrado para este episódio.",
    );
  }

  infoLog(
    `[anime] anitube episódio resolvido (Blogger, ` +
      `${degraus.map((degrau) => degrau.quality).join("/")})`,
  );

  // MP4 direto, um URL por degrau: o menu oferece 360p e 720p e o teto de MB
  // decide o que é enviável.
  return degraus;
}

/**
 * Encontra a primeira série com episódios, devolvendo o par pronto para o menu.
 *
 * @param {string} termo
 * @returns {Promise<{anime: object, episodes: Array<object>}>}
 */
export async function searchWithEpisodes(termo) {
  const series = await buscarSeries(termo);

  if (!series.length) {
    throw new AnimeApiError(`Nenhum anime encontrado para "${termo}".`);
  }

  const primeira = series[0];

  return {
    anime: { id: primeira.slug, slug: primeira.slug, title: primeira.title, image: null },
    episodes: primeira.episodes.map((ep) => ({
      id: ep.id,
      number: ep.number,
      ids: ep.id,
      // Sem isto o fallback perde a faixa e o dublado é inalcançável quando a
      // primeira série da lista é a legendada.
      versions: ep.versions || [],
    })),
  };
}
