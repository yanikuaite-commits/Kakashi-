/**
 * Provider "animesonlinehd": extrai o vídeo do site, sem API de terceiros.
 *
 * PORQUÊ: é o único site testado que publica DUBLADO EM PORTUGUÊS e responde a
 * IPs de datacenter (Render incluído), sem Cloudflare. Os sites PT-BR mais
 * conhecidos (goyabu, animefire, animesonlinecc, dattebayo) estão todos atrás de
 * Cloudflare, e o AniTube publica o dublado num único degrau de 720p (~330-450 MB)
 * que passa o teto de envio. Aqui cada episódio traz as DUAS faixas com ids
 * próprios, e o dublado mede ~75 MB num episódio de 24 min.
 *
 * COMO: o site é Next.js e o backend é WordPress (`animesonline.blue`). O HTML
 * de `/anime/<slug>` traz o catálogo completo no payload RSC (`self.__next_f`),
 * pelo que uma única página dá as temporadas e os episódios das duas faixas —
 * sem passar pela API REST do WordPress, que exige autenticação (401). A cadeia:
 *
 *   GET /api/search?q=<termo>              → {results:[{slug, title, audios:["dub","leg"]}]}
 *   GET /anime/<slug>                      → payload RSC: temporadas[].eps[] com leg/dub
 *   GET /api/episodio/<id>                 → {tipo:"Dublado", playerUrl:"https://www.blogger.com/..."}
 *   GET <playerUrl>                        → URL googlevideo do MP4
 *
 * O `playerUrl` é um link do Blogger cuja página traz o `videoplayback` do
 * Google Video no HTML. O extractor `blogger` do yt-dlp falha neste formato
 * ("Unable to extract JSON data"), por isso o URL é lido AQUI e o yt-dlp recebe
 * o googlevideo direto. Esse CDN exige `Referer` do Blogger E um User-Agent de
 * browser: sem o User-Agent responde 403 mesmo com o Referer certo.
 *
 * TAMANHO: o Blogger publica dois degraus, itag 18 (360p) e itag 22 (720p). Num
 * episódio de 24 min o 360p mede ~75 MB e o 720p ~219 MB — o 720p passa o teto de
 * 200 MB, pelo que o episódio é servido em 360p. É a única forma de caber sem
 * subir o teto e arriscar o OOM do Render.
 *
 * @author Dev Gui
 */
import {
  ANIME_API_TIMEOUT_MS,
  ANIME_PREFER_DUBBED,
  ANIME_USER_AGENT,
} from "../config.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { AnimeApiError } from "./anime.js";

const BASE = "https://animesonlinehd.vip";
const REQUEST_TIMEOUT_MS = Math.min(ANIME_API_TIMEOUT_MS, 20 * 1000);

/** User-Agent de browser, exigido pelo CDN do Google Video (sem ele: 403). */
const UA_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** Degraus do Blogger: 18 = 360p (cabe no teto), 22 = 720p (passa). */
const ITAG_360P = "18";
const ITAG_720P = "22";

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

/**
 * Junta os pedaços do payload RSC do Next.js num só texto.
 *
 * O Next.js envia o estado em várias chamadas `self.__next_f.push([1, "..."])`,
 * cada uma com um fragmento escapado. Sem os juntar não há JSON válido para ler.
 *
 * @param {string} html
 * @returns {string}
 */
export function extrairPayloadRsc(html) {
  const pedacos = [
    ...String(html ?? "").matchAll(
      /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g,
    ),
  ].map(([, corpo]) => {
    try {
      return JSON.parse(`"${corpo}"`);
    } catch {
      return corpo;
    }
  });

  return pedacos.join("").replace(/\\"/g, '"');
}

/**
 * Lê as temporadas e os episódios do payload RSC.
 *
 * A forma no site é `"temporadas":[{"numero":1,"nome":"...","eps":[{"num":1,
 * "leg":{...}|null,"dub":{...}|null}]}]`. Cada faixa tem o seu id de episódio
 * (endpoints `/api/episodio/<id>` diferentes), pelo que o id de cada faixa é
 * preservado — é isso que torna o dublado alcançável.
 *
 * Puro (sem rede) para poder ser testado com payload real capturado.
 *
 * @param {string} payload
 * @returns {Array<{numero: number, nome: string, eps: Array<{num: number, leg: object|null, dub: object|null}>}>}
 */
export function parseTemporadas(payload) {
  const inicio = String(payload ?? "").indexOf('"temporadas":[');
  if (inicio < 0) return [];

  const texto = String(payload).slice(inicio + '"temporadas":'.length);

  // O array de temporadas é equilibrado; extrai-se por contagem de parênteses
  // retos para não depender do que vem a seguir no payload.
  let profundidade = 0;
  let fim = -1;

  for (let i = 0; i < texto.length; i += 1) {
    if (texto[i] === "[") profundidade += 1;
    else if (texto[i] === "]") {
      profundidade -= 1;
      if (profundidade === 0) {
        fim = i + 1;
        break;
      }
    }
  }

  if (fim < 0) return [];

  try {
    const temporadas = JSON.parse(texto.slice(0, fim));
    return Array.isArray(temporadas) ? temporadas : [];
  } catch (error) {
    errorLog(`[anime] animesonlinehd: payload RSC ilegível: ${error.message}`);
    return [];
  }
}

/**
 * Variantes do termo a tentar, da mais literal para a mais genérica.
 *
 * A pesquisa do site é literal: "naruto dublado" devolve 0 resultados, porque
 * "dublado" não existe no índice (a faixa é um campo, não parte do nome). Como
 * é natural o utilizador escrever a faixa, uma pesquisa sem resultados é
 * repetida sem essas palavras antes de desistir.
 *
 * Puro (sem rede) para poder ser testado.
 *
 * @param {string} termo
 * @returns {string[]}
 */
export function variantesDeBusca(termo) {
  const limpo = String(termo ?? "").trim();
  const semFaixa = limpo.replace(/\b(dublado|legendado|dub|leg)\b/gi, " ").trim();

  return [limpo, semFaixa].filter((t, i, lista) => t && lista.indexOf(t) === i);
}

/**
 * Pesquisa animes pelo endpoint JSON do próprio site.
 *
 * @param {string} termo
 * @returns {Promise<Array<{id: string, slug: string, title: string, image: string|null, audios: string[]}>>}
 */
export async function search(termo) {
  for (const pedido of variantesDeBusca(termo)) {
    const dados = await fetchText(
      `${BASE}/api/search?q=${encodeURIComponent(pedido)}`,
      { referer: `${BASE}/`, json: true },
    );

    const resultados = Array.isArray(dados?.results) ? dados.results : [];

    const lista = resultados
      .filter((item) => item?.slug)
      .map((item) => ({
        id: item.slug,
        slug: item.slug,
        title: item.title || item.slug,
        image: item.cover || null,
        audios: Array.isArray(item.audios) ? item.audios : [],
      }));

    if (lista.length) return lista;
  }

  return [];
}

/**
 * Traduz as faixas do site (`leg`/`dub`) para as do bot (`subbed`/`dubbed`).
 *
 * @param {{leg: object|null, dub: object|null}} ep
 * @returns {string[]}
 */
function faixasDoEpisodio(ep) {
  const faixas = [];
  if (ep?.leg) faixas.push("subbed");
  if (ep?.dub) faixas.push("dubbed");
  return faixas;
}

/**
 * Episódios de uma temporada, com a faixa e o id de cada uma.
 *
 * O id de cada episódio é o da faixa pedida. Um episódio que NÃO publica a faixa
 * pedida é descartado em vez de cair para a outra: servir o legendado a quem
 * pediu dublado é exatamente o defeito que este provider vem corrigir (o menu
 * perguntava "Dublado" e tocava inglês), e um episódio com o áudio errado é pior
 * do que um episódio ausente — o utilizador só descobre o engano depois do
 * download. É a mesma regra que o `fontesDoProvider` já aplica ao AniTube.
 *
 * Sem faixa pedida, segue a preferência global (`ANIME_PREFER_DUBBED`): o
 * dublado é o que a maioria dos pedidos procura. Um episódio sem dublagem cai
 * para o legendado, para não desaparecer da lista.
 *
 * @param {object} temporada
 * @param {string} [audioVersion] "subbed" ou "dubbed"
 * @returns {Array<{id: string, number: number, ids: string, versions: string[]}>}
 */
export function episodiosDaTemporada(temporada, audioVersion = "") {
  const faixa = String(audioVersion || "").trim().toLowerCase();

  return (temporada?.eps || [])
    .map((ep) => {
      const versions = faixasDoEpisodio(ep);

      // Com faixa PEDIDA não há recurso para a outra: servir o áudio errado é o
      // defeito que este provider corrige. Sem pedido, a preferência global
      // (dublado) pode cair para o legendado, para o episódio não desaparecer.
      const escolhido = faixa
        ? ep?.[faixa === "dubbed" ? "dub" : "leg"]
        : ((ANIME_PREFER_DUBBED ? ep?.dub : ep?.leg) ?? ep?.leg ?? ep?.dub);

      if (!escolhido?.id) return null;

      return {
        id: String(escolhido.id),
        number: Number(ep.num) || 0,
        ids: String(escolhido.id),
        versions,
      };
    })
    .filter((ep) => ep && ep.number);
}

/**
 * Busca as temporadas de um slug (payload RSC da página do anime).
 *
 * @param {string} slug
 * @returns {Promise<Array<object>>}
 */
async function temporadasDe(slug) {
  const html = await fetchText(`${BASE}/anime/${encodeURIComponent(slug)}`, {
    referer: `${BASE}/`,
  });

  const temporadas = parseTemporadas(extrairPayloadRsc(html));

  if (!temporadas.length) {
    throw new AnimeApiError("Este anime não tem episódios disponíveis na fonte.");
  }

  return temporadas;
}

/**
 * Temporadas de um anime, no formato que o menu espera.
 *
 * O site agrupa as temporadas na mesma página (ao contrário do anikoto, onde
 * cada temporada é um anime separado), por isso o `slug` da temporada é o slug
 * do anime com o número — é isso que `seasonEpisodes` volta a ler.
 *
 * @param {string} animeId
 * @param {string} slug
 * @returns {Promise<Array<{slug: string, title: string}>>}
 */
export async function seasons(animeId, slug) {
  const alvo = String(slug || animeId).split(":")[0];
  const temporadas = await temporadasDe(alvo);

  // Só há passo de temporada quando o site agrupa 2+ entradas.
  if (temporadas.length < 2) return [];

  return temporadas.map((temporada, indice) => ({
    slug: `${alvo}::${indice}`,
    title: temporada?.nome || `Temporada ${temporada?.numero ?? indice + 1}`,
  }));
}

/**
 * Episódios de uma temporada (`"<slug>::<indice>"`) ou do anime inteiro.
 *
 * @param {string} entrada
 * @param {string} [audioVersion]
 * @returns {Promise<Array<{id: string, number: number, ids: string, versions: string[]}>>}
 */
export async function seasonEpisodes(entrada, audioVersion = "") {
  const [slug, indice] = String(entrada).split("::");
  const temporadas = await temporadasDe(slug);

  const temporada = temporadas[Number(indice)] || temporadas[0];
  const lista = episodiosDaTemporada(temporada, audioVersion);

  if (!lista.length) {
    throw new AnimeApiError("Esta temporada não tem episódios disponíveis.");
  }

  return lista;
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
  const alvo = String(slug || animeId).split(":")[0];
  const temporadas = await temporadasDe(alvo);
  const lista = episodiosDaTemporada(temporadas[0], audioVersion);

  if (!lista.length) {
    throw new AnimeApiError("Este anime não tem episódios disponíveis na fonte.");
  }

  return lista;
}

/**
 * Extrai o URL do `videoplayback` do Google Video a partir da página do Blogger.
 *
 * Puro (sem rede). O URL vem com as entidades HTML e os escapes do JSON
 * (`&quot;`, `\u003d`, `\u0026`, `\/`), pelo que é preciso desescapá-lo antes de
 * o ler. O itag é escolhido explicitamente: 18 (360p) por caber no teto de envio.
 *
 * @param {string} html
 * @param {string} [itag]
 * @returns {string|null}
 */
export function parseVideoUrl(html, itag = ITAG_360P) {
  const conteudo = String(html ?? "")
    .replace(/&quot;/g, '"')
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/");

  const urls = [
    ...new Set(
      [
        ...conteudo.matchAll(
          /https?:\/\/[^"'\s\\]+googlevideo\.com\/videoplayback[^"'\s\\]*/g,
        ),
      ].map(([url]) => url),
    ),
  ];

  return urls.find((url) => new RegExp(`[?&]itag=${itag}(?:&|$)`).test(url)) || null;
}

/**
 * Link do vídeo de um episódio.
 *
 * O id do episódio já é o da faixa correta (o site tem ids distintos para
 * dublado e legendado), por isso o `audioVersion` não é preciso aqui.
 *
 * @param {{id: string, ids: string}} episodio
 * @param {string} slug
 * @returns {Promise<{url: string, quality: string, isM3U8: boolean, referer: string}>}
 */
export async function sources(episodio) {
  const id = String(episodio?.ids || episodio?.id || "").trim();

  if (!/^\d+$/.test(id)) {
    throw new AnimeApiError("Este episódio não tem um link válido na fonte.");
  }

  const dados = await fetchText(`${BASE}/api/episodio/${id}`, {
    referer: `${BASE}/`,
    json: true,
  });

  const playerUrl = String(dados?.playerUrl || "").trim();

  if (!playerUrl) {
    throw new AnimeApiError(
      "Nenhum link de streaming foi encontrado para este episódio.",
    );
  }

  const pagina = await fetchText(playerUrl, { referer: `${BASE}/` });
  const url = parseVideoUrl(pagina, ITAG_360P);

  if (!url) {
    throw new AnimeApiError(
      "A fonte não devolveu o vídeo deste episódio. Tente outro episódio.",
    );
  }

  infoLog(`[anime] animesonlinehd episódio resolvido (${dados?.tipo || "?"}, 360p)`);

  // Devolve objeto (e não só o URL) para o fluxo saber que é MP4 direto: o
  // rótulo de qualidade e o `--max-filesize` comportam-se de forma diferente de
  // um HLS, e o yt-dlp lê os metadados reais do ficheiro.
  return { url, quality: "360p", isM3U8: false };
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
        `[anime] animesonlinehd "${anime.title}" sem episódios: ${error.message}`,
      );
    }
  }

  throw new AnimeApiError(
    `Os resultados de "${termo}" não têm episódios disponíveis nesta fonte.`,
  );
}
