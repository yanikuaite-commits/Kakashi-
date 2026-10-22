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
import {
  ANIME_ACCEPT_LANGUAGE,
  ANIME_API_TIMEOUT_MS,
  ANIME_PROVIDERS,
  ANIME_PROXY_URL,
  ANIME_USER_AGENT,
} from "../config.js";
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
  "Nenhuma fonte de animes respondeu. Estes sites bloqueiam IPs de datacenter " +
  "(como o Render) e mudam de domínio com frequência — ajuste ANIME_PROVIDERS " +
  "com um provider que esteja no ar ou ANIME_PROXY_URL com um proxy residencial.";

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

/**
 * Providers próprios, extraídos do site sem passar pela biblioteca.
 *
 * O `anikoto` não depende do `@consumet/extensions`: fala diretamente com um
 * site que responde a IPs de datacenter, ao contrário dos providers da
 * biblioteca, que ficam atrás de Cloudflare.
 */
const PROVIDERS_PROPIOS = {
  anikoto: () => import("./anikoto.js"),
  animeheaven: () => import("./animeheaven.js"),
};

let consumetAnime = null;
const instancias = new Map();

/**
 * Aplica cabeçalhos de browser e proxy ao cliente HTTP de um provider.
 *
 * A biblioteca não define User-Agent, pelo que o axios envia "axios/1.x" e o
 * Cloudflare — à frente de todos estes sites — bloqueia esse agente em IPs de
 * datacenter (Render incluído). Sem isto, a pesquisa falha com "nenhuma fonte
 * respondeu" mesmo com o site no ar. O proxy é o escape hatch para quando o IP
 * do host está bloqueado de vez.
 *
 * @param {object} instance
 * @param {string} nome
 */
export function applyProviderClient(instance, nome) {
  const client = instance?.client;
  if (!client?.defaults?.headers) return;

  client.defaults.headers.common["User-Agent"] = ANIME_USER_AGENT;
  client.defaults.headers.common["Accept-Language"] = ANIME_ACCEPT_LANGUAGE;
  client.defaults.headers.common["Accept"] =
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

  if (ANIME_PROXY_URL) {
    try {
      client.defaults.proxy = {
        host: new URL(ANIME_PROXY_URL).hostname,
        port: Number(new URL(ANIME_PROXY_URL).port) || undefined,
        protocol: new URL(ANIME_PROXY_URL).protocol.replace(":", ""),
        auth:
          new URL(ANIME_PROXY_URL).username
            ? {
                username: decodeURIComponent(new URL(ANIME_PROXY_URL).username),
                password: decodeURIComponent(new URL(ANIME_PROXY_URL).password),
              }
            : undefined,
      };
      infoLog(`[anime] ${nome} a usar ANIME_PROXY_URL`);
    } catch (error) {
      errorLog(`[anime] ANIME_PROXY_URL inválido: ${error.message}`);
    }
  }
}

async function loadConsumet() {
  if (consumetAnime) return consumetAnime;

  try {
    const mod = await import("@consumet/extensions");
    consumetAnime = mod?.ANIME || mod?.default?.ANIME || null;
  } catch (error) {
    // Só é erro se algum provider da biblioteca for realmente usado: o
    // provider próprio (`anikoto`) não depende dela.
    errorLog(`[anime] @consumet/extensions indisponível: ${error.message}`);
    return null;
  }

  return consumetAnime;
}

/** Exige a biblioteca apenas quando um provider dela vai ser construído. */
async function requireConsumet() {
  const A = await loadConsumet();
  if (!A) throw new AnimeApiError(DEP_MISSING_HINT);
  return A;
}

/**
 * Providers a tentar, na ordem configurada, ignorando nomes desconhecidos.
 *
 * Cada entrada é `{nome, tipo, instance}`: `tipo: "consumet"` usa a biblioteca,
 * `tipo: "proprio"` usa a extração direta (`src/services/anikoto.js`).
 *
 * @returns {Promise<Array<{nome: string, tipo: string, instance: object}>>}
 */
async function activeProviders() {
  const lista = [];

  for (const nome of ANIME_PROVIDERS) {
    const proprio = PROVIDERS_PROPIOS[nome];
    const fabrica = PROVIDER_FACTORIES[nome];

    if (!proprio && !fabrica) {
      errorLog(`[anime] provider desconhecido em ANIME_PROVIDERS: "${nome}"`);
      continue;
    }

    if (!instancias.has(nome)) {
      try {
        let instance;
        if (proprio) {
          instance = await proprio();
        } else {
          instance = fabrica(await requireConsumet());
          applyProviderClient(instance, nome);
        }
        instancias.set(nome, instance);
      } catch (error) {
        errorLog(`[anime] provider "${nome}" indisponível: ${error.message}`);
        continue;
      }
    }

    lista.push({
      nome,
      tipo: proprio ? "proprio" : "consumet",
      instance: instancias.get(nome),
    });
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

  for (const { nome: provider, tipo, instance } of providers) {
    try {
      if (tipo === "proprio") {
        const resultados = await withTimeout(
          instance.search(termo),
          ANIME_API_TIMEOUT_MS,
          `${provider}.search`,
        );
        const primeiro = resultados?.[0];

        if (!primeiro?.id) {
          falhas.push(`${provider}: sem resultados`);
          continue;
        }

        infoLog(`[anime] "${primeiro.title}" encontrado em ${provider}`);

        return {
          id: `${primeiro.id}:${primeiro.slug}`,
          provider,
          title: primeiro.title || termo,
          image: primeiro.image || null,
          releaseDate: null,
        };
      }

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
 * No provider próprio, o `id` chega como `"<numId>:<slug>"` e cada episódio
 * passa a carregar `"<slug>::<epId>::<dataIds>"`, porque a cadeia do anikoto
 * precisa do slug (Referer) e do `data-ids` em todos os passos seguintes.
 *
 * @param {string} id
 * @param {string} provider
 * @returns {Promise<{id: string, provider: string, title: string, episodes: Array<object>}>}
 */
export async function getAnimeInfo(id, provider) {
  const { tipo, instance } = await resolveProvider(provider);

  if (tipo === "proprio") {
    const [animeId, slug] = String(id).split(":");
    const lista = await withTimeout(
      instance.episodes(animeId, slug),
      ANIME_API_TIMEOUT_MS,
      `${provider}.episodes`,
    ).catch((error) => {
      errorLog(`[anime] ${provider} falhou em info: ${error.message}`);
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
      provider,
      // Vazio de propósito: o menu faz `info.title || anime.title` e o título
      // da pesquisa ("Naruto") é melhor do que o slug ("naruto-eybxz").
      title: "",
      episodes: lista.map((episode) => ({
        id: `${slug}::${episode.id}::${episode.ids}`,
        number: episode.number,
        title: "",
      })),
    };
  }

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
 * Temporadas de um anime, quando a fonte as agrupa.
 *
 * Devolve `[]` quando não há agrupamento (a maioria dos títulos) ou quando a
 * fonte não expõe temporadas — nesse caso o fluxo salta o passo e vai direto
 * para os episódios, como antes.
 *
 * @param {string} id
 * @param {string} provider
 * @returns {Promise<Array<{slug: string, title: string}>>}
 */
export async function getAnimeSeasons(id, provider) {
  const { tipo, instance } = await resolveProvider(provider);
  if (tipo !== "proprio" || typeof instance.seasons !== "function") return [];

  const [animeId, slug] = String(id).split(":");

  return withTimeout(
    instance.seasons(animeId, slug),
    ANIME_API_TIMEOUT_MS,
    `${provider}.seasons`,
  ).catch((error) => {
    // Temporadas são um extra: se falharem, o fluxo segue para os episódios
    // em vez de bloquear o pedido do utilizador.
    errorLog(`[anime] ${provider} falhou nas temporadas: ${error.message}`);
    return [];
  });
}

/**
 * Episódios de uma temporada específica (identificada pelo seu slug).
 *
 * @param {string} slug
 * @param {string} provider
 * @returns {Promise<Array<object>>}
 */
export async function getSeasonEpisodes(slug, provider) {
  const { tipo, instance } = await resolveProvider(provider);
  if (tipo !== "proprio" || typeof instance.seasonEpisodes !== "function") {
    throw new AnimeApiError("Esta fonte não suporta escolha de temporada.");
  }

  const lista = await withTimeout(
    instance.seasonEpisodes(slug),
    ANIME_API_TIMEOUT_MS,
    `${provider}.seasonEpisodes`,
  ).catch((error) => {
    errorLog(`[anime] ${provider} falhou na temporada "${slug}": ${error.message}`);
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
  }));
}

/**
 * Fontes de streaming de um episódio, já normalizadas por qualidade.
 *
 * @param {string} episodeId
 * @param {string} provider
 * @returns {Promise<Array<{url: string, label: string, isM3U8: boolean}>>}
 */
export async function getEpisodeSources(episodeId, provider) {
  const { tipo, instance } = await resolveProvider(provider);

  if (tipo === "proprio") {
    const [slug, epId, ids] = String(episodeId).split("::");
    const resolvido = await withTimeout(
      instance.sources({ id: epId, ids }, slug),
      ANIME_API_TIMEOUT_MS,
      `${provider}.sources`,
    ).catch((error) => {
      errorLog(`[anime] ${provider} falhou nas fontes: ${error.message}`);
      throw new AnimeApiError(
        "Não consegui obter o link de streaming deste episódio. Tente outro episódio ou qualidade.",
        { cause: error },
      );
    });

    // O provider pode devolver só o URL (HLS, caso do anikoto) ou um objeto com
    // o tipo de media (o animeheaven serve MP4 direto). Assumir sempre HLS
    // marcava o MP4 como stream e o rótulo de qualidade saía errado.
    const url = typeof resolvido === "string" ? resolvido : resolvido?.url;

    if (!url) {
      throw new AnimeApiError(
        "Nenhum link de streaming foi encontrado para este episódio.",
      );
    }

    return normalizeSources([
      {
        url,
        quality: typeof resolvido === "object" ? resolvido?.quality : undefined,
        resolution: typeof resolvido === "object" ? resolvido?.resolution : undefined,
        isM3U8: typeof resolvido === "object" ? Boolean(resolvido?.isM3U8) : true,
      },
    ]);
  }

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

  return encontrado;
}
