/**
 * Extração de links de streaming de animes, em processo.
 *
 * HISTÓRIA: isto já foi um cliente HTTP da API Consumet (`api.consumet.org`).
 * Essa instância pública foi DESATIVADA e o provider HiAnime (antigo Zoro)
 * fechou em definitivo em março de 2026, pelo que apontar para um servidor
 * Consumet deixou de resolver: não havia fonte viva por baixo.
 *
 * AGORA: a biblioteca `@consumet/extensions` corre DENTRO do bot (sem
 * servidor, sem auto-hospedagem) e extrai os links dos providers vivos. O
 * `ANIME_PROVIDERS` define a ordem de preferência e cada provider é tentado
 * até um devolver o episódio. O link devolvido é um m3u8/mp4 que o yt-dlp
 * baixa (ver `src/utils/animeMenu.js`).
 *
 * O `provider` é encadeado explicitamente (`getAnimeInfo(id, provider)`) em
 * vez de guardado em estado global, porque cada episódio pertence ao provider
 * onde foi encontrado e as sessões podem coexistir.
 *
 * @author Dev Gui
 */
import { ANIME_API_TIMEOUT_MS, ANIME_PROVIDERS } from "../config.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { normalizeSources } from "../utils/animeFormat.js";

/** Erro de configuração/indisponibilidade da fonte (não do anime escolhido). */
export class AnimeApiError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "AnimeApiError";
  }
}

const DEP_MISSING_HINT =
  "A biblioteca de animes não está instalada neste servidor. Rode `npm install` " +
  "para instalar `@consumet/extensions`.";

const NO_PROVIDER_HINT =
  "Nenhuma fonte de animes respondeu. Os sites de anime mudam de domínio com " +
  "frequência — ajuste ANIME_PROVIDERS (ex: animeunity,animepahe,kickassanime) " +
  "com um provider que esteja no ar.";

/** Nome → construtor no namespace `ANIME` da biblioteca. */
const PROVIDER_FACTORIES = {
  animeunity: (A) => new A.AnimeUnity(),
  animepahe: (A) => new A.AnimePahe(),
  kickassanime: (A) => new A.KickAssAnime(),
  animesaturn: (A) => new A.AnimeSaturn(),
  animesama: (A) => new A.AnimeSama(),
  hianime: (A) => new A.Hianime(),
  animekai: (A) => new A.AnimeKai(),
};

let consumetAnime = null;
const instancias = new Map();

async function loadConsumet() {
  if (consumetAnime) return consumetAnime;

  try {
    const mod = await import("@consumet/extensions");
    consumetAnime = mod?.ANIME || mod?.default?.ANIME || null;
  } catch (error) {
    errorLog(`[anime] falha ao carregar @consumet/extensions: ${error.message}`);
    throw new AnimeApiError(DEP_MISSING_HINT, { cause: error });
  }

  if (!consumetAnime) throw new AnimeApiError(DEP_MISSING_HINT);
  return consumetAnime;
}

/**
 * Providers a tentar, na ordem configurada, ignorando nomes desconhecidos.
 *
 * @returns {Promise<Array<{nome: string, instance: object}>>}
 */
async function activeProviders() {
  const A = await loadConsumet();
  const lista = [];

  for (const nome of ANIME_PROVIDERS) {
    const fabrica = PROVIDER_FACTORIES[nome];
    if (!fabrica) {
      errorLog(`[anime] provider desconhecido em ANIME_PROVIDERS: "${nome}"`);
      continue;
    }

    if (!instancias.has(nome)) {
      try {
        instancias.set(nome, fabrica(A));
      } catch (error) {
        errorLog(`[anime] provider "${nome}" indisponível: ${error.message}`);
        continue;
      }
    }

    lista.push({ nome, instance: instancias.get(nome) });
  }

  if (!lista.length) throw new AnimeApiError(NO_PROVIDER_HINT);
  return lista;
}

/** Impede que uma chamada pendurada bloqueie o bot para sempre. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} excedeu ${ms} ms`)), ms);
    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Pesquisa um anime e devolve o primeiro resultado de um provider que responda.
 *
 * @param {string} nome
 * @returns {Promise<{id: string, provider: string, title: string, image: string|null, releaseDate: string|null}>}
 */
export async function searchAnime(nome) {
  const termo = String(nome || "").trim();
  if (!termo) throw new AnimeApiError("Envie o nome do anime.");

  const providers = await activeProviders();
  const falhas = [];

  for (const { nome: provider, instance } of providers) {
    try {
      const res = await withTimeout(
        instance.search(termo),
        ANIME_API_TIMEOUT_MS,
        `${provider}.search`,
      );
      const primeiro = res?.results?.[0];

      if (!primeiro?.id) {
        falhas.push(`${provider}: sem resultados`);
        continue;
      }

      infoLog(`[anime] "${primeiro.title}" encontrado em ${provider}`);

      return {
        id: String(primeiro.id),
        provider,
        title: primeiro.title || termo,
        image: primeiro.image || null,
        releaseDate: primeiro.releaseDate || null,
      };
    } catch (error) {
      falhas.push(`${provider}: ${error.message}`);
      errorLog(`[anime] ${provider} falhou na pesquisa: ${error.message}`);
    }
  }

  errorLog(`[anime] nenhum provider respondeu: ${falhas.join(" | ")}`);
  throw new AnimeApiError(NO_PROVIDER_HINT);
}

/**
 * Informações do anime (com episódios) no provider onde foi encontrado.
 *
 * @param {string} id
 * @param {string} provider
 * @returns {Promise<{id: string, provider: string, title: string, episodes: Array<object>}>}
 */
export async function getAnimeInfo(id, provider) {
  const instance = await resolveProvider(provider);

  const info = await withTimeout(
    instance.fetchAnimeInfo(id),
    ANIME_API_TIMEOUT_MS,
    `${provider}.fetchAnimeInfo`,
  ).catch((error) => {
    errorLog(`[anime] ${provider} falhou em info: ${error.message}`);
    throw new AnimeApiError(
      "A fonte de animes não devolveu os episódios deste título. Tente outro nome.",
      { cause: error },
    );
  });

  const episodes = Array.isArray(info?.episodes) ? info.episodes : [];
  if (!episodes.length) {
    throw new AnimeApiError("Este anime não tem episódios disponíveis na fonte.");
  }

  return {
    id: String(id),
    provider,
    title: info?.title || "Anime",
    episodes,
  };
}

/**
 * Fontes de streaming de um episódio, já normalizadas por qualidade.
 *
 * @param {string} episodeId
 * @param {string} provider
 * @returns {Promise<Array<{url: string, label: string, isM3U8: boolean}>>}
 */
export async function getEpisodeSources(episodeId, provider) {
  const instance = await resolveProvider(provider);

  const data = await withTimeout(
    instance.fetchEpisodeSources(episodeId),
    ANIME_API_TIMEOUT_MS,
    `${provider}.fetchEpisodeSources`,
  ).catch((error) => {
    errorLog(`[anime] ${provider} falhou nas fontes: ${error.message}`);
    throw new AnimeApiError(
      "Não consegui obter o link de streaming deste episódio. Tente outro episódio ou qualidade.",
      { cause: error },
    );
  });

  // Prefere HLS quando existe: o yt-dlp lida melhor com m3u8 do que com alguns
  // .mpd destes sites, que vêm sem faixa de áudio.
  const brutas = Array.isArray(data?.sources) ? data.sources : [];
  const hls = brutas.filter((source) => source?.isM3U8);
  const sources = normalizeSources(hls.length ? hls : brutas);

  if (!sources.length) {
    throw new AnimeApiError(
      "Nenhum link de streaming foi encontrado para este episódio.",
    );
  }

  return sources;
}

async function resolveProvider(provider) {
  const nome = String(provider || "").toLowerCase();
  const providers = await activeProviders();
  const encontrado = providers.find((p) => p.nome === nome);

  if (!encontrado) {
    throw new AnimeApiError(
      `A fonte "${provider}" não está disponível. Ajuste ANIME_PROVIDERS.`,
    );
  }

  return encontrado.instance;
}
