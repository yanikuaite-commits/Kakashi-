/**
 * Extração de links de streaming de animes, em processo.
 *
 * FONTE ÚNICA: o `meusanimes` (`src/services/meusanimes.js`). Responde a IPs de
 * datacenter sem desafio Cloudflare, agrupa temporadas na própria página e serve
 * o episódio pelo player do Blogger. Os outros providers foram removidos a
 * pedido do dono do bot; se um dia voltarem, o sítio onde entram é aqui.
 *
 * O `provider` continua a viajar na sessão do menu (é o rótulo do card) mesmo
 * havendo uma só fonte: assim o fluxo não precisa de saber que é única.
 *
 * @author Dev Yanik
 */
import { ANIME_API_TIMEOUT_MS, TRANSLATE_ENABLED } from "../config.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { translateToEnglish } from "./translate.js";
import { correspondenciaExata, normalizeSources, tituloDeBusca } from "../utils/animeFormat.js";
import * as meusanimes from "./meusanimes.js";

/** Erro de configuração/indisponibilidade da fonte (não do anime escolhido). */
export class AnimeApiError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "AnimeApiError";
  }
}

/** Nome da fonte única, usado como rótulo em toda a sessão do menu. */
export const ANIME_PROVIDER = "meusanimes";

const FONTE = meusanimes;

const NO_PROVIDER_HINT =
  "A fonte de animes não respondeu. O site pode estar fora do ar ou a bloquear " +
  "este IP — tente novamente mais tarde.";

/** Impede que uma chamada pendurada bloqueie o bot para sempre. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} excedeu ${ms} ms`)), ms);
    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Pesquisa na fonte, com timeout e log de falha. */
async function pesquisar(termo) {
  return withTimeout(
    FONTE.search(termo),
    ANIME_API_TIMEOUT_MS,
    `${ANIME_PROVIDER}.search`,
  );
}

/** Converte um resultado da fonte no formato de anime do menu. */
function comoAnime(item, termo) {
  return {
    id: `${item.id}:${item.slug}`,
    provider: ANIME_PROVIDER,
    title: item.title || termo,
    image: item.image || null,
    releaseDate: item.year || null,
  };
}

/**
 * Pesquisa um anime pelo nome.
 *
 * O termo é pesquisado sem os sufixos que só o site usa: "Attack on Titan
 * Dublado" vira "Attack on Titan". Se a pesquisa normalizada não der nada, o
 * termo original é tentado como recurso, para nunca perder um título que o site
 * só indexe com o sufixo.
 *
 * Quando há correspondência exata, ela ganha ao primeiro resultado. Sem
 * correspondência exata, mantém-se o primeiro resultado (compatibilidade com o
 * comportamento histórico): quem quer desambiguar usa `searchAnimeCandidates`.
 *
 * @param {string} nome
 * @param {string} [audioVersion] faixa pedida ("subbed"/"dubbed")
 * @returns {Promise<{id: string, provider: string, title: string, image: string|null, releaseDate: string|null}>}
 */
export async function searchAnime(nome, audioVersion = "") {
  const original = String(nome || "").trim();
  if (!original) throw new AnimeApiError("Envie o nome do anime.");

  const termos = [...new Set([tituloDeBusca(original), original].filter(Boolean))];
  const falhas = [];

  for (const termo of termos) {
    if (termo !== original) {
      infoLog(`[anime] pesquisa normalizada: "${original}" → "${termo}"`);
    }

    let resultados;
    try {
      resultados = await pesquisar(termo);
    } catch (error) {
      falhas.push(error.message);
      errorLog(`[anime] ${ANIME_PROVIDER} falhou na pesquisa: ${error.message}`);
      continue;
    }

    const lista = (resultados || []).filter((item) => item?.id);
    if (!lista.length) {
      falhas.push(`${ANIME_PROVIDER}: sem resultados`);
      continue;
    }

    const escolhido = correspondenciaExata(lista, termo) || lista[0];
    infoLog(`[anime] "${escolhido.title}" encontrado em ${ANIME_PROVIDER}`);

    return comoAnime(escolhido, termo);
  }

  errorLog(`[anime] nenhuma pesquisa respondeu: ${falhas.join(" | ")}`);
  throw new AnimeApiError(NO_PROVIDER_HINT);
}

/**
 * Pesquisa com DESAMBIGUAÇÃO: devolve o título quando a correspondência é
 * exata e, quando não é, a lista de candidatos para o utilizador escolher.
 *
 * Existe porque `searchAnime` cai no primeiro resultado quando não há
 * correspondência exata, o que entrega um anime errado em silêncio: pesquisar
 * "Meu Hero Academia" no meusanimes devolvia "Eiyuu Kyoushitsu" (outro anime) e
 * o fluxo seguia como se fosse o pedido. Aqui essa ambiguidade é resolvida com
 * uma escolha explícita em vez de um palpite.
 *
 * A tradução entra como ÚLTIMO RECURSO, depois de a pesquisa pelo termo
 * original falhar a correspondência exata: o catálogo do site está indexado em
 * inglês/romaji, e "Meu Hero Academia" só encontra "Boku no Hero Academia"
 * depois de traduzido. Tentar a tradução PRIMEIRO estragaria o que já funciona
 * — o `meusanimes` indexa aliases PT ("Ataque dos Titãs" → "Shingeki No
 * Kyojin") e a tradução desse termo ("Attack on Titan") até devolve resultados
 * piores.
 *
 * @param {string} nome
 * @param {string} [audioVersion]
 * @returns {Promise<{anime: object|null, candidatos: Array<object>, provider: string, traduzidoDe: string|null, termoTraduzido: string|null}>}
 */
export async function searchAnimeCandidates(nome, audioVersion = "") {
  const original = String(nome || "").trim();
  if (!original) throw new AnimeApiError("Envie o nome do anime.");

  const falhas = [];

  const tentar = async (termo) => {
    const termos = [...new Set([tituloDeBusca(termo), termo].filter(Boolean))];

    for (const t of termos) {
      try {
        const resultados = ((await pesquisar(t)) || []).filter((item) => item?.id);
        if (!resultados.length) continue;
        return { resultados, exato: correspondenciaExata(resultados, t) };
      } catch (error) {
        falhas.push(error.message);
        errorLog(`[anime] ${ANIME_PROVIDER} falhou na pesquisa: ${error.message}`);
      }
    }

    return null;
  };

  const primeiro = await tentar(original);

  if (primeiro?.exato) {
    infoLog(
      `[anime] "${primeiro.exato.title}" encontrado em ${ANIME_PROVIDER} (exato)`,
    );
    return {
      anime: comoAnime(primeiro.exato, original),
      candidatos: [],
      provider: ANIME_PROVIDER,
      traduzidoDe: null,
      termoTraduzido: null,
    };
  }

  // Sem correspondência exata: o termo pode estar em português e o catálogo em
  // inglês. Traduzir e tentar de novo antes de mostrar a lista.
  let segundo = null;
  let termoTraduzido = null;

  if (TRANSLATE_ENABLED) {
    termoTraduzido = await translateToEnglish(original);
    if (termoTraduzido) segundo = await tentar(termoTraduzido);
  }

  if (segundo?.exato) {
    infoLog(
      `[anime] "${segundo.exato.title}" encontrado em ${ANIME_PROVIDER} (exato após tradução)`,
    );
    return {
      anime: comoAnime(segundo.exato, termoTraduzido),
      candidatos: [],
      provider: ANIME_PROVIDER,
      traduzidoDe: original,
      termoTraduzido,
    };
  }

  // A lista junta os dois conjuntos: o termo traduzido primeiro (foi a
  // tentativa mais provável para o catálogo) e o original a seguir, para não
  // perder resultados que o site já indexava em português.
  const candidatos = [];
  const vistos = new Set();

  for (const item of [
    ...(segundo?.resultados || []),
    ...(primeiro?.resultados || []),
  ]) {
    if (vistos.has(item.id)) continue;
    vistos.add(item.id);
    candidatos.push(item);
  }

  if (!candidatos.length) {
    errorLog(`[anime] nenhuma pesquisa respondeu: ${falhas.join(" | ")}`);
    throw new AnimeApiError(NO_PROVIDER_HINT);
  }

  infoLog(
    `[anime] "${original}" sem correspondência exata: ${candidatos.length} candidato(s)${
      termoTraduzido ? ` (traduzido para "${termoTraduzido}")` : ""
    }`,
  );

  return {
    anime: null,
    candidatos,
    provider: ANIME_PROVIDER,
    traduzidoDe: termoTraduzido ? original : null,
    termoTraduzido,
  };
}

/**
 * Informações do anime (com episódios) na fonte.
 *
 * O `id` chega como `"<slug>:<slug>"` e cada episódio passa a carregar
 * `"<slug>::<epId>::<ids>"`, porque a cadeia do meusanimes precisa do slug
 * (Referer) em todos os passos seguintes.
 *
 * @param {string} id
 * @param {string} [provider] mantido por compatibilidade da assinatura
 * @param {string} [audioVersion] "subbed"/"dubbed" — escolhe a entrada do site
 * @returns {Promise<{id: string, provider: string, title: string, episodes: Array<object>}>}
 */
export async function getAnimeInfo(id, provider, audioVersion = "") {
  const [animeId, slug] = String(id).split(":");

  const lista = await withTimeout(
    FONTE.episodes(animeId, slug, audioVersion),
    ANIME_API_TIMEOUT_MS,
    `${ANIME_PROVIDER}.episodes`,
  ).catch((error) => {
    errorLog(`[anime] ${ANIME_PROVIDER} falhou em info: ${error.message}`);
    throw new AnimeApiError(
      "A fonte de animes não devolveu os episódios deste título. Tente outro nome.",
      { cause: error },
    );
  });

  if (!lista?.length) {
    throw new AnimeApiError("Este anime não tem episódios disponíveis na fonte.");
  }

  return {
    id: String(id),
    provider: ANIME_PROVIDER,
    // Vazio de propósito: o menu faz `info.title || anime.title` e o título
    // da pesquisa ("Naruto") é melhor do que o slug.
    title: "",
    episodes: lista.map((episode) => ({
      id: `${slug}::${episode.id}::${episode.ids}`,
      number: episode.number,
      title: "",
      // Faixas publicadas ("subbed"/"dubbed"), lidas da página do episódio.
      versions: episode.versions || [],
    })),
  };
}

/**
 * Temporadas de um anime, quando o site as agrupa.
 *
 * Devolve `[]` quando não há agrupamento (a maioria dos títulos) — nesse caso o
 * fluxo salta o passo e vai direto para os episódios.
 *
 * @param {string} id
 * @param {string} [provider] mantido por compatibilidade da assinatura
 * @param {string} [audioVersion] "subbed"/"dubbed" — escolhe a página a ler
 * @returns {Promise<Array<{slug: string, title: string}>>}
 */
export async function getAnimeSeasons(id, provider, audioVersion = "") {
  const [animeId, slug] = String(id).split(":");

  return withTimeout(
    FONTE.seasons(animeId, slug, audioVersion),
    ANIME_API_TIMEOUT_MS,
    `${ANIME_PROVIDER}.seasons`,
  ).catch((error) => {
    // Temporadas são um extra: se falharem, o fluxo segue para os episódios
    // em vez de bloquear o pedido do utilizador.
    errorLog(`[anime] ${ANIME_PROVIDER} falhou nas temporadas: ${error.message}`);
    return [];
  });
}

/**
 * Episódios de uma temporada específica (identificada pelo seu slug).
 *
 * @param {string} slug
 * @param {string} [provider] mantido por compatibilidade da assinatura
 * @param {string} [audioVersion] "subbed"/"dubbed" — escolhe a entrada do site
 * @returns {Promise<Array<object>>}
 */
export async function getSeasonEpisodes(slug, provider, audioVersion = "") {
  const lista = await withTimeout(
    FONTE.seasonEpisodes(slug, audioVersion),
    ANIME_API_TIMEOUT_MS,
    `${ANIME_PROVIDER}.seasonEpisodes`,
  ).catch((error) => {
    errorLog(`[anime] ${ANIME_PROVIDER} falhou na temporada "${slug}": ${error.message}`);
    throw new AnimeApiError(
      "Não consegui obter os episódios desta temporada. Tente outra.",
      { cause: error },
    );
  });

  if (!lista?.length) {
    throw new AnimeApiError("Esta temporada não tem episódios disponíveis.");
  }

  return lista.map((episode) => ({
    id: `${slug}::${episode.id}::${episode.ids}`,
    number: episode.number,
    title: "",
    versions: episode.versions || [],
  }));
}

/**
 * Normaliza o retorno de `sources()` da fonte em fontes de menu.
 *
 * O meusanimes devolve uma lista de degraus (360p e 720p no mesmo player), mas o
 * contrato fica permissivo: um URL solto ou um objeto único também são aceites,
 * para a fonte poder mudar de forma sem partir o menu.
 *
 * @param {string|object|Array<string|object>} resolvido
 * @returns {Array<{url: string, label: string, isM3U8: boolean}>}
 */
function normalizarFontesDoProvider(resolvido) {
  const brutas = Array.isArray(resolvido) ? resolvido : [resolvido];

  const validas = brutas
    .map((item) => (typeof item === "string" ? { url: item } : item))
    .filter((item) => Boolean(item?.url));

  return normalizeSources(
    validas.map((item) => ({
      url: item.url,
      quality: item.quality,
      resolution: item.resolution,
      isM3U8: Boolean(item.isM3U8),
    })),
  );
}

/**
 * Fontes de streaming de um episódio, já normalizadas por qualidade.
 *
 * @param {string} episodeId formato `"<slug>::<epId>::<ids>"`
 * @param {string} [provider] mantido por compatibilidade da assinatura
 * @param {string} [audioVersion] "subbed"/"dubbed"
 * @returns {Promise<Array<{url: string, label: string, isM3U8: boolean}>>}
 */
export async function getEpisodeSources(episodeId, provider, audioVersion = "") {
  const [slug, epId, ids] = String(episodeId).split("::");

  const resolvido = await withTimeout(
    FONTE.sources({ id: epId, ids }, slug, audioVersion),
    ANIME_API_TIMEOUT_MS,
    `${ANIME_PROVIDER}.sources`,
  ).catch((error) => {
    errorLog(`[anime] ${ANIME_PROVIDER} falhou nas fontes: ${error.message}`);
    throw new AnimeApiError(
      "Não consegui obter o link de streaming deste episódio. Tente outro episódio ou qualidade.",
      { cause: error },
    );
  });

  const sources = normalizarFontesDoProvider(resolvido);

  if (!sources.length) {
    throw new AnimeApiError(
      "Nenhum link de streaming foi encontrado para este episódio.",
    );
  }

  return sources;
}
