/**
 * Provider "meusanimes": extrai o vídeo do site, sem API de terceiros.
 *
 * PORQUÊ: é o provider PT-BR mais completo testado — responde a IPs de datacenter
 * SEM qualquer desafio Cloudflare, publica temporadas
 * agrupadas na própria página e serve o episódio pelo player do Blogger, que o
 * projeto já sabe ler. Os sites PT-BR mais conhecidos (goyabu, animefire,
 * animesonlinecc) estão atrás de Cloudflare e o `animesonlinehd` publica um
 * catálogo mais estreito. Aqui cada episódio traz 360p (~89 MB num episódio de
 * 23 min, dentro do teto) e 720p (~285 MB, no limite) como degraus separados,
 * para o menu de qualidades deixar o utilizador escolher.
 *
 * COMO: o site é WordPress e o player é uma SPA React noutro domínio. A cadeia:
 *
 *   GET /?s=<termo>                     → HTML com <article> por título
 *   GET /a/<slug>/                      → id='seasons': temporadas[].episodios[]
 *   GET /e/<ep-slug>/                   → <iframe> com tmdb/temporada/episódio
 *   GET serv01.../posts/get-video.php   → {success, videoUrl:"...blogger.com..."}
 *   GET <videoUrl>                      → URL googlevideo do MP4 (360p e 720p)
 *
 * O `get-video.php` responde igual com e sem cookies (o cookie do site é de
 * sessão), pelo que o provider não mantém estado nenhum — o `tmdb`, a temporada
 * e o episódio viajam todos no id do episódio.
 *
 * O último passo é um link do Blogger cuja página traz o `videoplayback` do
 * Google Video. O extractor `blogger` do yt-dlp falha neste formato ("Unable to
 * extract JSON data"), por isso o URL é lido em `bloggerVideo.js` (partilhado
 * com o animesonlinehd e o anitube) e o yt-dlp recebe o googlevideo direto.
 *
 * ÁUDIO: ao contrário do animesonlinehd (que traz as duas faixas no mesmo id), o
 * dublado é uma ENTRADA separada (`/a/<base>-dublado/`). O sufixo é a convenção
 * do site, mas não é uma garantia — `naruto-shippuden` serve dublado sem o
 * sufixo —, por isso a faixa real é confirmada na página do PRIMEIRO episódio
 * (`span.qualidade`) antes de rotular a lista. Sem essa confirmação o provider
 * podia dizer "legendado" de um episódio dublado, que é exatamente o defeito que
 * o fluxo de faixa existe para corrigir.
 *
 * @author Dev Yanik
 */
import {
  ANIME_API_TIMEOUT_MS,
  ANIME_PREFER_DUBBED,
  ANIME_USER_AGENT,
} from "../config.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { AnimeApiError } from "./anime.js";
import { DEGRAUS_BLOGGER, extrairDegraus } from "./bloggerVideo.js";

const BASE = "https://meusanimes.blog";
const PLAYER = "https://serv01.meusdoramas.club";
const REQUEST_TIMEOUT_MS = Math.min(ANIME_API_TIMEOUT_MS, 20 * 1000);

async function fetchText(url, { referer, json = false } = {}) {
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

/** Desescapa as entidades que o WordPress usa nos títulos. */
function desescapar(texto) {
  return String(texto ?? "")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Lê os resultados da página de busca (`/?s=<termo>`).
 *
 * Cada resultado é um `<article>` com o link, o título, a capa e o ano. O
 * título é a única marca de áudio fiável na busca (o slug pode faltar o sufixo),
 * pelo que é ele que decide a faixa inicial de cada entrada.
 *
 * Puro (sem rede) para poder ser testado com HTML real capturado.
 *
 * @param {string} html
 * @returns {Array<{slug: string, title: string, image: string|null, year: string|null}>}
 */
export function extrairResultados(html) {
  const blocos = String(html ?? "").split(/<article\b/i).slice(1);
  const vistos = new Set();
  const resultados = [];

  for (const bloco of blocos) {
    const slug = bloco.match(/\/a\/([a-z0-9-]+)\//i)?.[1];
    if (!slug || vistos.has(slug)) continue;

    const titulo =
      desescapar(
        bloco.match(/<div class="title">\s*<a[^>]*>([^<]*)<\/a>/i)?.[1],
      ) || desescapar(bloco.match(/<img[^>]*alt="([^"]*)"/i)?.[1]);

    if (!titulo) continue;

    vistos.add(slug);
    resultados.push({
      slug,
      title: titulo,
      image: bloco.match(/<img[^>]*src="([^"]+)"/i)?.[1] || null,
      year: bloco.match(/<span class="year">(\d{4})<\/span>/i)?.[1] || null,
    });
  }

  return resultados;
}

/**
 * Lê as temporadas e os episódios da página do anime (`/a/<slug>/`).
 *
 * O bloco `id='seasons'` traz um `<div class='se-c'>` por temporada, cada um com
 * o título ("Temporada 1") e um `<ul class='episodios'>` de `<li>`. O número do
 * episódio sai do texto do link ("Episódio 30"); sem ele vale a ordem na lista.
 *
 * Puro (sem rede) para poder ser testado com HTML real capturado.
 *
 * @param {string} html
 * @returns {Array<{title: string, episodes: Array<{slug: string, number: number}>}>}
 */
export function extrairTemporadas(html) {
  const conteudo = String(html ?? "");
  const inicio = conteudo.search(/id=['"]seasons['"]/i);
  if (inicio < 0) return [];

  const zona = conteudo.slice(inicio);

  return zona
    .split(/<div class=['"]se-c['"]/i)
    .slice(1)
    .map((bloco) => {
      const titulo = desescapar(
        bloco.match(/<span class=['"]title['"]>([^<]*)/i)?.[1],
      );

      const episodes = [
        ...bloco.matchAll(
          /<a href=['"][^'"]*\/e\/([a-z0-9-]+)\/['"][^>]*>\s*Epis[oó]dio\s*(\d+)/gi,
        ),
      ].map(([, slug, numero]) => ({ slug, number: Number(numero) || 0 }));

      return {
        title: titulo || "Temporada",
        episodes: episodes.filter((ep) => ep.number > 0),
      };
    })
    .filter((temporada) => temporada.episodes.length);
}

/**
 * Lê o `tmdb`, a temporada e o episódio do iframe do player.
 *
 * O iframe é `serv01.meusdoramas.club/#/video/<tmdb>/<temporada>/<episódio>`; é
 * esta tripla que a API do player precisa, e é ela que viaja no id do episódio.
 * Puro (sem rede).
 *
 * @param {string} html
 * @returns {{tmdb: string, season: string, episode: string}|null}
 */
export function extrairReferenciaDoPlayer(html) {
  const referencia = String(html ?? "").match(
    /#\/video\/(\d+)\/(\d+)\/(\d+)/,
  );

  if (!referencia) return null;

  return { tmdb: referencia[1], season: referencia[2], episode: referencia[3] };
}

/**
 * Lê a faixa de áudio publicada na página do episódio.
 *
 * A página marca o vídeo servido em `<span class="qualidade">Dublado|Legendado`,
 * que é a única prova do áudio REAL — o slug pode mentir. Puro (sem rede).
 *
 * @param {string} html
 * @returns {"dubbed"|"subbed"|null}
 */
export function extrairFaixa(html) {
  const texto = String(html ?? "").match(
    /class=['"]qualidade['"][^>]*>([\s\S]*?)<\/span>/i,
  )?.[1];

  if (!texto) return null;

  const rotulo = desescapar(String(texto).replace(/<[^>]+>/g, "")).toLowerCase();

  if (/dublado|dublagem|\bdub\b/.test(rotulo)) return "dubbed";
  if (/legendado|\bleg\b/.test(rotulo)) return "subbed";
  return null;
}

/** Base do slug, sem o sufixo de faixa que o site acrescenta. */
export function slugBase(slug) {
  return String(slug || "")
    .replace(/-dublado$/i, "")
    .replace(/-legendado$/i, "");
}

/**
 * Slugs a tentar, por ordem, para a faixa pedida.
 *
 * O site publica o dublado como entrada própria (`<base>-dublado`), pelo que a
 * faixa escolhe a entrada. Sem pedido, vale a preferência global. A ordem é uma
 * ordem de TENTATIVA: a faixa real é confirmada na página do episódio, porque o
 * sufixo não é garantia.
 *
 * Puro (sem rede) para poder ser testado.
 *
 * @param {string} slug
 * @param {string} [audioVersion] "subbed"/"dubbed"/""
 * @returns {string[]}
 */
export function candidatosDeSlug(slug, audioVersion = "") {
  const base = slugBase(slug);
  if (!base) return [];

  const dublado = `${base}-dublado`;
  const faixa = String(audioVersion || "").trim().toLowerCase();

  if (faixa === "dubbed") return [dublado, base];
  if (faixa === "subbed") return [base, dublado];
  return ANIME_PREFER_DUBBED ? [dublado, base] : [base, dublado];
}

/** Temporadas de um slug, ou `[]` quando o slug não existe/tem episódios. */
async function temporadasDe(slug) {
  const html = await fetchText(`${BASE}/a/${encodeURIComponent(slug)}/`, {
    referer: `${BASE}/`,
  });

  return extrairTemporadas(html);
}

/**
 * Resolve o slug a usar e as suas temporadas, tentando as entradas da faixa.
 *
 * @param {string} slug
 * @param {string} [audioVersion]
 * @returns {Promise<{slug: string, temporadas: Array<object>}>}
 */
async function resolverSlug(slug, audioVersion = "") {
  for (const candidato of candidatosDeSlug(slug, audioVersion)) {
    try {
      const temporadas = await temporadasDe(candidato);
      if (temporadas.length) return { slug: candidato, temporadas };
    } catch (error) {
      errorLog(`[anime] meusanimes "${candidato}" indisponível: ${error.message}`);
    }
  }

  throw new AnimeApiError("Este anime não tem episódios disponíveis na fonte.");
}

/**
 * Confirma a faixa real na página do primeiro episódio.
 *
 * Uma verificação por anime (não por episódio): a entrada serve uma só faixa, por
 * isso o primeiro episódio representa a lista. Se a página não puder ser lida, a
 * faixa do slug é usada como estimativa em vez de bloquear o pedido.
 *
 * @param {string} episodioSlug
 * @param {string} slugUsado
 * @returns {Promise<string>} "subbed" ou "dubbed"
 */
async function faixaConfirmada(episodioSlug, slugUsado) {
  const estimativa = /-dublado$/i.test(String(slugUsado))
    ? "dubbed"
    : "subbed";

  try {
    const html = await fetchText(
      `${BASE}/e/${encodeURIComponent(episodioSlug)}/`,
      { referer: `${BASE}/` },
    );

    return extrairFaixa(html) || estimativa;
  } catch (error) {
    errorLog(
      `[anime] meusanimes faixa não confirmada ("${episodioSlug}"): ${error.message}`,
    );
    return estimativa;
  }
}

/** Episódios da primeira temporada, com a faixa real da entrada. */
async function listaDeEpisodios(slug, audioVersion) {
  const { slug: slugUsado, temporadas } = await resolverSlug(slug, audioVersion);
  const temporada = temporadas[0];
  const primeira = temporada?.episodes?.[0]?.slug;

  const versao = primeira
    ? await faixaConfirmada(primeira, slugUsado)
    : /-dublado$/i.test(slugUsado)
      ? "dubbed"
      : "subbed";

  return temporada.episodes.map((ep) => ({
    id: ep.slug,
    number: ep.number,
    ids: ep.slug,
    versions: [versao],
  }));
}

/**
 * Pesquisa animes e devolve os títulos encontrados.
 *
 * @param {string} termo
 * @returns {Promise<Array<{id: string, slug: string, title: string, image: string|null}>>}
 */
export async function search(termo) {
  const html = await fetchText(
    `${BASE}/?s=${encodeURIComponent(termo)}`,
    { referer: `${BASE}/` },
  );

  return extrairResultados(html).map((item) => ({
    id: item.slug,
    slug: item.slug,
    title: item.title,
    image: item.image,
  }));
}

/**
 * Temporadas de um anime, no formato que o menu espera.
 *
 * O site agrupa as temporadas na mesma página, por isso o slug da temporada é o
 * slug do anime com o índice — é isso que `seasonEpisodes` volta a ler. Só há
 * passo de temporada quando o site publica 2+.
 *
 * A faixa faz parte da escolha do slug: a entrada dublada é uma página própria
 * (`<base>-dublado`), e usar a entrada errada aqui faria `seasonEpisodes` listar
 * os episódios da outra faixa — o índice da temporada só é válido dentro da
 * mesma entrada.
 *
 * @param {string} animeId
 * @param {string} slug
 * @param {string} [audioVersion] "subbed"/"dubbed"
 * @returns {Promise<Array<{slug: string, title: string}>>}
 */
export async function seasons(animeId, slug, audioVersion = "") {
  const alvo = String(slug || animeId).split("::")[0];
  const { slug: slugUsado, temporadas } = await resolverSlug(alvo, audioVersion);

  if (temporadas.length < 2) return [];

  return temporadas.map((temporada, indice) => ({
    slug: `${slugUsado}::${indice}`,
    title: temporada.title || `Temporada ${indice + 1}`,
  }));
}

/**
 * Episódios de uma temporada (`"<slug>::<indice>"`).
 *
 * @param {string} entrada
 * @param {string} [audioVersion]
 * @returns {Promise<Array<{id: string, number: number, ids: string, versions: string[]}>>}
 */
export async function seasonEpisodes(entrada, audioVersion = "") {
  const [slug, indice] = String(entrada).split("::");
  const { slug: slugUsado, temporadas } = await resolverSlug(slug, audioVersion);
  const temporada = temporadas[Number(indice)] || temporadas[0];

  if (!temporada?.episodes?.length) {
    throw new AnimeApiError("Esta temporada não tem episódios disponíveis.");
  }

  const versao = await faixaConfirmada(temporada.episodes[0].slug, slugUsado);

  return temporada.episodes.map((ep) => ({
    id: ep.slug,
    number: ep.number,
    ids: ep.slug,
    versions: [versao],
  }));
}

/**
 * Episódios do anime inteiro (a primeira temporada, ou a única).
 *
 * @param {string} animeId
 * @param {string} slug
 * @param {string} [audioVersion]
 * @returns {Promise<Array<{id: string, number: number, ids: string, versions: string[]}>>}
 */
export async function episodes(animeId, slug, audioVersion = "") {
  const alvo = String(slug || animeId).split("::")[0];
  const lista = await listaDeEpisodios(alvo, audioVersion);

  if (!lista.length) {
    throw new AnimeApiError("Este anime não tem episódios disponíveis na fonte.");
  }

  return lista;
}

/**
 * Links de vídeo de um episódio, um por degrau publicado.
 *
 * O id do episódio é o slug da página (`/e/<slug>/`), que traz o iframe com a
 * tripla que a API do player precisa. A resposta do `get-video.php` é um link do
 * Blogger (ou uma lista de servidores com um cada), cuja página publica os
 * degraus — 360p e 720p — como URLs distintos.
 *
 * @param {{id: string, ids: string}} episodio
 * @param {string} slug
 * @returns {Promise<Array<{url: string, quality: string, isM3U8: boolean}>>}
 */
export async function sources(episodio) {
  const epSlug = String(episodio?.ids || episodio?.id || "").trim();

  if (!/^[a-z0-9-]+$/i.test(epSlug)) {
    throw new AnimeApiError("Este episódio não tem um link válido na fonte.");
  }

  const pagina = await fetchText(`${BASE}/e/${encodeURIComponent(epSlug)}/`, {
    referer: `${BASE}/`,
  });

  const referencia = extrairReferenciaDoPlayer(pagina);

  if (!referencia) {
    throw new AnimeApiError(
      "A fonte não publicou o player deste episódio. Tente outro episódio.",
    );
  }

  const dados = await fetchText(
    `${PLAYER}/posts/get-video.php?episode_number=${referencia.episode}` +
      `&season_number=${referencia.season}&tmdb=${referencia.tmdb}`,
    { referer: `${PLAYER}/`, json: true },
  );

  // O player pode devolver um link só ou uma lista de servidores, cada um com o
  // seu URL; todos os candidatos são tentados até um render os degraus.
  const brutos = Array.isArray(dados?.videoUrl)
    ? dados.videoUrl.map((item) => item?.url || item)
    : [dados?.videoUrl];

  for (const candidato of brutos) {
    const url = String(candidato || "").trim();
    if (!url) continue;

    const html = await fetchText(url, { referer: `${PLAYER}/` }).catch(
      () => "",
    );
    const degraus = extrairDegraus(html, DEGRAUS_BLOGGER);

    if (degraus.length) {
      infoLog(
        `[anime] meusanimes episódio resolvido (` +
          `${degraus.map((degrau) => degrau.quality).join("/")})`,
      );

      // MP4 direto, um URL por degrau: o menu oferece 360p e 720p e o teto de MB
      // decide o que é enviável.
      return degraus;
    }
  }

  throw new AnimeApiError(
    "A fonte não devolveu o vídeo deste episódio. Tente outro episódio.",
  );
}

/**
 * Encontra o primeiro resultado com episódios, pronto para o menu.
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
      errorLog(
        `[anime] meusanimes "${anime.title}" sem episódios: ${error.message}`,
      );
    }
  }

  throw new AnimeApiError(
    `Os resultados de "${termo}" não têm episódios disponíveis nesta fonte.`,
  );
}
