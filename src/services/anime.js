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
 * @author Dev Yanik
 */
import {
  ANIME_ACCEPT_LANGUAGE,
  ANIME_API_TIMEOUT_MS,
  ANIME_PREFER_DUBBED,
  ANIME_PROVIDERS,
  ANIME_PROXY_URL,
  ANIME_PT_DUB_PROVIDERS,
  ANIME_USER_AGENT,
  TRANSLATE_ENABLED,
} from "../config.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { translateToEnglish } from "./translate.js";
import {
  escolherEpisodio,
  correspondenciaExata,
  melhorResultado,
  normalizeSources,
  ordenarProvidersParaFaixa,
  tituloDeBusca,
} from "../utils/animeFormat.js";

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
  "(como o do host em nuvem) e mudam de domínio com frequência — ajuste ANIME_PROVIDERS " +
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
  animegg: () => import("./animegg.js"),
  anitube: () => import("./anitube.js"),
  animesonlinehd: () => import("./animesonlinehd.js"),
  meusanimes: () => import("./meusanimes.js"),
};

let consumetAnime = null;
const instancias = new Map();

/**
 * Aplica cabeçalhos de browser e proxy ao cliente HTTP de um provider.
 *
 * A biblioteca não define User-Agent, pelo que o axios envia "axios/1.x" e o
 * Cloudflare — à frente de todos estes sites — bloqueia esse agente em IPs de
 * datacenter. Sem isto, a pesquisa falha com "nenhuma fonte
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
 * Consulta os providers por um termo e devolve o primeiro que respondeu.
 *
 * Devolve `null` (e não lança) quando nenhum provider respondeu: quem chama
 * decide se continua para o termo seguinte.
 *
 * @param {string} termo
 * @param {Array<{nome: string, tipo: string, instance: object}>} providers
 * @param {string[]} falhas acumulador de motivos, para o log final
 * @returns {Promise<{provider: string, resultados: Array<object>}|null>}
 */
async function coletarResultados(termo, providers, falhas) {
  for (const { nome: provider, tipo, instance } of providers) {
    try {
      const bruto =
        tipo === "proprio"
          ? await withTimeout(
              instance.search(termo),
              ANIME_API_TIMEOUT_MS,
              `${provider}.search`,
            )
          : (
              await withTimeout(
                instance.search(termo),
                ANIME_API_TIMEOUT_MS,
                `${provider}.search`,
              )
            )?.results;

      const resultados = (Array.isArray(bruto) ? bruto : [])
        .map((item) => ({
          id:
            tipo === "proprio"
              ? `${item.id}:${item.slug}`
              : String(item?.id ?? ""),
          title: item?.title || "",
          image: item?.image || null,
          year: item?.year || item?.releaseDate || null,
        }))
        .filter((item) => item.id);

      if (!resultados.length) {
        falhas.push(`${provider}: sem resultados`);
        continue;
      }

      return { provider, resultados };
    } catch (error) {
      falhas.push(`${provider}: ${error.message}`);
      errorLog(`[anime] ${provider} falhou na pesquisa: ${error.message}`);
    }
  }

  return null;
}

/**
 * Pesquisa um anime pelo nome.
 *
 * O termo é pesquisado sem os sufixos que só um site usa: "Attack on Titan
 * Dublado" vira "Attack on Titan". Sem isso, só o anikoto (cujo motor de busca
 * separa as palavras) respondia a esses pedidos, e o anime caía sempre lá. Se a
 * pesquisa normalizada não der nada, o termo original é tentado como recurso,
 * para nunca perder um título que o site só indexe com o sufixo.
 *
 * Quando há correspondência exata, ela ganha ao primeiro resultado. Sem
 * correspondência exata, mantém-se o primeiro resultado (compatibilidade com o
 * comportamento histórico): quem quer desambiguar usa `searchAnimeCandidates`.
 *
 * @param {string} nome
 * @param {string} [audioVersion] faixa pedida; "dubbed" faz os providers de
 *   dublagem PT-BR serem procurados PRIMEIRO (ver `ANIME_PT_DUB_PROVIDERS`)
 * @returns {Promise<{id: string, provider: string, title: string, image: string|null, releaseDate: string|null}>}
 */
export async function searchAnime(nome, audioVersion = "") {
  const original = String(nome || "").trim();
  if (!original) throw new AnimeApiError("Envie o nome do anime.");

  const normalizado = tituloDeBusca(original);
  const termos = [...new Set([normalizado, original].filter(Boolean))];

  const providers = ordenarProvidersParaFaixa(
    await activeProviders(),
    audioVersion,
    ANIME_PT_DUB_PROVIDERS,
  );
  const falhas = [];

  const faixa = String(audioVersion || "").trim().toLowerCase();

  if (faixa === "dubbed" && providers.length) {
    infoLog(
      `[anime] faixa dublada: providers PT-BR primeiro (${providers
        .map((p) => p.nome)
        .join(" → ")})`,
    );
  }

  for (const termo of termos) {
    if (termo !== original) {
      infoLog(`[anime] pesquisa normalizada: "${original}" → "${termo}"`);
    }

    const achado = await coletarResultados(termo, providers, falhas);
    if (!achado) continue;

    const escolhido =
      correspondenciaExata(achado.resultados, termo) || achado.resultados[0];

    infoLog(`[anime] "${escolhido.title}" encontrado em ${achado.provider}`);

    return {
      id: escolhido.id,
      provider: achado.provider,
      title: escolhido.title || termo,
      image: escolhido.image || null,
      releaseDate: escolhido.year || null,
    };
  }

  errorLog(`[anime] nenhum provider respondeu: ${falhas.join(" | ")}`);
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
 * original falhar a correspondência exata: o catálogo dos sites está indexado
 * em inglês/romaji, e "Meu Hero Academia" só encontra "Boku no Hero Academia"
 * depois de traduzido. Tentar a tradução PRIMEIRO estragaria o que já funciona
 * — o `meusanimes` indexa aliases PT ("Ataque dos Titãs" → "Shingeki No
 * Kyojin") e a tradução desse termo ("Attack on Titan") até devolve resultados
 * piores.
 *
 * @param {string} nome
 * @param {string} [audioVersion]
 * @returns {Promise<{anime: object|null, candidatos: Array<object>, traduzidoDe: string|null, termoTraduzido: string|null}>}
 */
export async function searchAnimeCandidates(nome, audioVersion = "") {
  const original = String(nome || "").trim();
  if (!original) throw new AnimeApiError("Envie o nome do anime.");

  const providers = ordenarProvidersParaFaixa(
    await activeProviders(),
    audioVersion,
    ANIME_PT_DUB_PROVIDERS,
  );
  const falhas = [];

  const tentar = async (termo) => {
    const termos = [...new Set([tituloDeBusca(termo), termo].filter(Boolean))];

    for (const t of termos) {
      const achado = await coletarResultados(t, providers, falhas);
      if (!achado) continue;

      return { achado, exato: correspondenciaExata(achado.resultados, t) };
    }

    return null;
  };

  const comoAnime = (item, provider) => ({
    id: item.id,
    provider,
    title: item.title,
    image: item.image || null,
    releaseDate: item.year || null,
  });

  const primeiro = await tentar(original);

  if (primeiro?.exato) {
    infoLog(
      `[anime] "${primeiro.exato.title}" encontrado em ${primeiro.achado.provider} (exato)`,
    );
    return {
      anime: comoAnime(primeiro.exato, primeiro.achado.provider),
      candidatos: [],
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
      `[anime] "${segundo.exato.title}" encontrado em ${segundo.achado.provider} (exato após tradução)`,
    );
    return {
      anime: comoAnime(segundo.exato, segundo.achado.provider),
      candidatos: [],
      traduzidoDe: original,
      termoTraduzido,
    };
  }

  // A lista junta os dois conjuntos: o termo traduzido primeiro (foi a
  // tentativa mais provável para o catálogo) e o original a seguir, para não
  // perder resultados que o site já indexava em português.
  const candidatos = [];
  const vistos = new Set();

  for (const item of [...(segundo?.achado?.resultados || []), ...(primeiro?.achado?.resultados || [])]) {
    if (vistos.has(item.id)) continue;
    vistos.add(item.id);
    candidatos.push(item);
  }

  if (!candidatos.length) {
    errorLog(`[anime] nenhum provider respondeu: ${falhas.join(" | ")}`);
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
    provider: segundo?.achado?.provider || primeiro?.achado?.provider || "",
    traduzidoDe: termoTraduzido ? original : null,
    termoTraduzido,
  };
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
 * @param {string} [audioVersion] "subbed"/"dubbed" — só os providers com ids por
 *   faixa (animesonlinehd) o usam; os restantes ignoram-no
 * @returns {Promise<{id: string, provider: string, title: string, episodes: Array<object>}>}
 */
export async function getAnimeInfo(id, provider, audioVersion = "") {
  const { tipo, instance } = await resolveProvider(provider);

  if (tipo === "proprio") {
    const [animeId, slug] = String(id).split(":");
    const lista = await withTimeout(
      instance.episodes(animeId, slug, audioVersion),
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
        // Faixas publicadas ("subbed"/"dubbed"). Vazio quando a fonte não as
        // distingue — o menu então nem pergunta, como antes.
        versions: episode.versions || [],
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
 * @param {string} [audioVersion] "subbed"/"dubbed" — só os providers com
 *   entradas por faixa (meusanimes) o usam para escolher a página de onde ler as
 *   temporadas; os restantes ignoram-no
 * @returns {Promise<Array<{slug: string, title: string}>>}
 */
export async function getAnimeSeasons(id, provider, audioVersion = "") {
  const { tipo, instance } = await resolveProvider(provider);
  if (tipo !== "proprio" || typeof instance.seasons !== "function") return [];

  const [animeId, slug] = String(id).split(":");

  return withTimeout(
    instance.seasons(animeId, slug, audioVersion),
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
 * @param {string} [audioVersion] "subbed"/"dubbed" — escolhe o id da faixa nos
 *   providers que publicam ids distintos por faixa (animesonlinehd)
 * @returns {Promise<Array<object>>}
 */
export async function getSeasonEpisodes(slug, provider, audioVersion = "") {
  const { tipo, instance } = await resolveProvider(provider);
  if (tipo !== "proprio" || typeof instance.seasonEpisodes !== "function") {
    throw new AnimeApiError("Esta fonte não suporta escolha de temporada.");
  }

  const lista = await withTimeout(
    instance.seasonEpisodes(slug, audioVersion),
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
    versions: episode.versions || [],
  }));
}

/**
 * Fontes de streaming de um episódio, já normalizadas por qualidade.
 *
 * `audioVersion` ("subbed"/"dubbed") é a faixa pedida. Só os providers que
 * publicam as duas faixas a usam (AnimeGG); os restantes ignoram-no, pelo que o
 * parâmetro é opcional e sem ele o comportamento é o de sempre.
 *
 * @param {string} episodeId
 * @param {string} provider
 * @param {string} [audioVersion]
 * @returns {Promise<Array<{url: string, label: string, isM3U8: boolean}>>}
 */
export async function getEpisodeSources(episodeId, provider, audioVersion = "") {
  const { tipo, instance } = await resolveProvider(provider);

  if (tipo === "proprio") {
    const [slug, epId, ids] = String(episodeId).split("::");
    const resolvido = await withTimeout(
      instance.sources({ id: epId, ids }, slug, audioVersion),
      ANIME_API_TIMEOUT_MS,
      `${provider}.sources`,
    ).catch((error) => {
      errorLog(`[anime] ${provider} falhou nas fontes: ${error.message}`);
      throw new AnimeApiError(
        "Não consegui obter o link de streaming deste episódio. Tente outro episódio ou qualidade.",
        { cause: error },
      );
    });

    // O provider pode devolver só o URL (HLS, caso do anikoto), um objeto com o
    // tipo de media (o animeheaven serve MP4 direto) ou uma lista de degraus (o
    // animesonlinehd publica 360p e 720p no mesmo player).
    const sources = normalizarFontesDoProvider(resolvido);

    if (!sources.length) {
      throw new AnimeApiError(
        "Nenhum link de streaming foi encontrado para este episódio.",
      );
    }

    return sources;
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

/**
 * Normaliza o retorno de `sources()` de um provider próprio em fontes de menu.
 *
 * O contrato é permissivo de propósito, porque cada provider publica o vídeo de
 * uma forma: o anikoto devolve só o URL (HLS), o animeheaven um objeto (MP4
 * direto) e o animesonlinehd uma lista de degraus (360p e 720p no mesmo player).
 * Tratar só o caso do objeto descartava a lista e deixava o menu sem qualidades.
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
      // Sem indicação explícita assume HLS: era o comportamento anterior para o
      // anikoto, cujo retorno é só o URL.
      isM3U8: item.isM3U8 === undefined ? true : Boolean(item.isM3U8),
    })),
  );
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

/**
 * Resolve as fontes de um episódio num provider específico, por título + número.
 *
 * É o passo que o fallback repete em cada provider: o provider de origem não
 * conhece o id do episódio no provider seguinte (os ids são internos de cada
 * site), pelo que o episódio é reencontrado pela pesquisa do título e pelo
 * NÚMERO. Se o número não existir nessa fonte, devolve null em vez de arriscar
 * entregar o episódio errado.
 *
 * @param {{nome: string, tipo: string, instance: object}} entrada
 * @param {string} titulo
 * @param {number} numero
 * @param {string} [audioVersion]
 * @returns {Promise<{sources: Array<object>, episodeId: string}|null>}
 */
async function fontesDoProvider(entrada, titulo, numero, audioVersion = "") {
  const { nome, tipo, instance } = entrada;
  // O título vem do provider onde o episódio foi listado e pode trazer um
  // sufixo que só esse site usa ("Jujutsu Kaisen (TV)"). Pesquisá-lo literalmente
  // aqui devolve 0 resultados e o episódio cai sempre no último provider.
  const termo = tituloDeBusca(titulo) || titulo;

  if (tipo === "proprio") {
    const resultados = await withTimeout(
      instance.search(termo),
      ANIME_API_TIMEOUT_MS,
      `${nome}.search`,
    );

    for (const resultado of resultados || []) {
      if (!resultado?.id) continue;

      const lista = await withTimeout(
        instance.episodes(resultado.id, resultado.slug, audioVersion),
        ANIME_API_TIMEOUT_MS,
        `${nome}.episodes`,
      ).catch(() => null);

      // A faixa pedida faz parte da escolha do episódio: no AniTube o dublado é
      // um post DIFERENTE, pelo que procurar só pelo número traria o legendado.
      const candidatos = (lista || []).filter(
        (ep) => Number(ep.number) === Number(numero),
      );
      const episodio = escolherEpisodio(candidatos, audioVersion, ANIME_PREFER_DUBBED);

      if (!episodio) continue;

      const resolvido = await withTimeout(
        instance.sources({ id: episodio.id, ids: episodio.ids }, resultado.slug, audioVersion),
        ANIME_API_TIMEOUT_MS,
        `${nome}.sources`,
      );

      const sources = normalizarFontesDoProvider(resolvido);

      if (!sources.length) continue;

      return {
        sources,
        episodeId: `${resultado.slug}::${episodio.id}::${episodio.ids}`,
      };
    }

    return null;
  }

  const resultados = await withTimeout(
    instance.search(termo),
    ANIME_API_TIMEOUT_MS,
    `${nome}.search`,
  );

  for (const resultado of resultados?.results || []) {
    if (!resultado?.id) continue;

    const info = await withTimeout(
      instance.fetchAnimeInfo(String(resultado.id)),
      ANIME_API_TIMEOUT_MS,
      `${nome}.fetchAnimeInfo`,
    ).catch(() => null);

    const episodio = (info?.episodes || []).find(
      (ep) => Number(ep.number) === Number(numero),
    );
    if (!episodio?.id) continue;

    const data = await withTimeout(
      instance.fetchEpisodeSources(episodio.id),
      ANIME_API_TIMEOUT_MS,
      `${nome}.fetchEpisodeSources`,
    );

    const brutas = Array.isArray(data?.sources) ? data.sources : [];
    const hls = brutas.filter((source) => source?.isM3U8);
    const sources = normalizeSources(hls.length ? hls : brutas);

    if (!sources.length) continue;

    return { sources, episodeId: String(episodio.id) };
  }

  return null;
}

/**
 * Fontes de um episódio, com fallback pelos restantes providers.
 *
 * O AnimeGG falha ~1 em cada 8 episódios (`videoSources = []`) e essa falha é
 * persistente — repetir não resolve. Como o id do episódio só existe dentro do
 * provider que o listou, o fallback reencontra o mesmo episódio nos providers
 * seguintes pela pesquisa do título + número, na ordem de `ANIME_PROVIDERS` —
 * com a dublagem pedida, os providers PT-BR vêm primeiro (ver
 * `ordenarProvidersParaFaixa`).
 *
 * Devolve também o provider que venceu e o novo id, para o menu atualizar a
 * sessão: os argumentos do yt-dlp e a resolução máxima dependem do provider.
 *
 * @param {string} episodeId
 * @param {string} provider
 * @param {{titulo?: string, numero?: number, audioVersion?: string}} [contexto]
 * @returns {Promise<{sources: Array<object>, provider: string, episodeId: string}>}
 */
export async function getEpisodeSourcesWithFallback(episodeId, provider, contexto = {}) {
  const titulo = String(contexto.titulo || "").trim();
  const numero = Number(contexto.numero) || 0;
  const audioVersion = String(contexto.audioVersion || "").trim().toLowerCase();

  let erroOriginal;

  try {
    const sources = await getEpisodeSources(episodeId, provider, audioVersion);
    return { sources, provider, episodeId };
  } catch (error) {
    erroOriginal = error;
  }

  if (!titulo || !numero) throw erroOriginal;

  const entradaAtual = await resolveProvider(provider);
  const providers = ordenarProvidersParaFaixa(
    await activeProviders(),
    audioVersion,
    ANIME_PT_DUB_PROVIDERS,
  );
  const restantes = providers.filter((p) => p.nome !== entradaAtual.nome);

  for (const entrada of restantes) {
    try {
      const resolvido = await fontesDoProvider(entrada, titulo, numero, audioVersion);

      if (!resolvido) {
        infoLog(`[anime] fallback ${entrada.nome}: episódio ${numero} não existe`);
        continue;
      }

      infoLog(
        `[anime] fallback: episódio ${numero} de "${titulo}" resolvido em ${entrada.nome}`,
      );

      return {
        sources: resolvido.sources,
        provider: entrada.nome,
        episodeId: resolvido.episodeId,
      };
    } catch (error) {
      errorLog(`[anime] fallback ${entrada.nome} falhou: ${error.message}`);
    }
  }

  throw new AnimeApiError(
    "Nenhuma das fontes disponíveis tem este episódio. Tente outro episódio.",
    { cause: erroOriginal },
  );
}
