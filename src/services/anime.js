/**
 * Cliente da API Consumet (provider HiAnime, antigo Zoro).
 *
 * ATENÇÃO — a instância pública `api.consumet.org` foi DESATIVADA: responde
 * HTTP 451 e o próprio projeto Consumet passou a exigir auto-hospedagem. O
 * base URL é lido de `ANIME_API_BASE_URL`; sem uma instância própria as
 * chamadas falham com uma mensagem clara em vez de silêncio.
 *
 * Endpoints usados:
 *   GET /anime/hianime/:query        → pesquisa (results[0].id)
 *   GET /anime/hianime/info?id=...   → episódios
 *   GET /anime/hianime/watch/:id     → sources (links de streaming)
 *
 * @author Dev Gui
 */
import axios from "axios";
import { ANIME_API_BASE_URL, ANIME_API_TIMEOUT_MS } from "../config.js";
import { errorLog } from "../utils/logger.js";
import { normalizeSources } from "../utils/animeFormat.js";

const client = axios.create({
  baseURL: ANIME_API_BASE_URL,
  timeout: ANIME_API_TIMEOUT_MS,
  headers: { Accept: "application/json" },
});

/** Erro de configuração/indisponibilidade da API (não do anime escolhido). */
export class AnimeApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnimeApiError";
  }
}

const API_OFFLINE_HINT =
  "A API de animes não respondeu. A instância pública `api.consumet.org` foi " +
  "desativada — configure ANIME_API_BASE_URL com uma instância Consumet sua " +
  "(ex: https://a-sua-instancia.onrender.com).";

/**
 * Traduz a falha do axios numa mensagem acionável.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function friendlyAnimeError(error) {
  const status = Number(error?.response?.status) || 0;

  if (status === 451 || status === 403) {
    return API_OFFLINE_HINT;
  }

  if (status === 404) {
    return "A API de animes respondeu que este recurso não existe. Verifique o nome do anime.";
  }

  if (status >= 500) {
    return `A API de animes está com problema no servidor (HTTP ${status}). Tente novamente em instantes.`;
  }

  if (error?.code === "ECONNABORTED" || /timeout/i.test(error?.message || "")) {
    return "A API de animes demorou demais para responder. Tente novamente em instantes.";
  }

  if (!status) {
    return API_OFFLINE_HINT;
  }

  return `A API de animes falhou (HTTP ${status}).`;
}

async function request(path, config = {}) {
  try {
    const { data } = await client.get(path, config);
    return data;
  } catch (error) {
    errorLog(`[anime] falha em ${path}: ${error.message}`);
    throw new AnimeApiError(friendlyAnimeError(error), { cause: error });
  }
}

/**
 * Pesquisa um anime e devolve o primeiro resultado.
 *
 * @param {string} nome
 * @returns {Promise<{id: string, title: string, image?: string, releaseDate?: string}>}
 */
export async function searchAnime(nome) {
  const termo = String(nome || "").trim();
  if (!termo) {
    throw new AnimeApiError("Envie o nome do anime.");
  }

  const data = await request(`/anime/hianime/${encodeURIComponent(termo)}`);
  const primeiro = data?.results?.[0];

  if (!primeiro?.id) {
    throw new AnimeApiError(
      `Nenhum anime encontrado para "${termo}". Confira o nome e tente novamente.`,
    );
  }

  return {
    id: String(primeiro.id),
    title: primeiro.title || termo,
    image: primeiro.image || null,
    releaseDate: primeiro.releaseDate || null,
  };
}

/**
 * Informações do anime, incluindo a lista de episódios.
 *
 * @param {string} id
 * @returns {Promise<{id: string, title: string, episodes: Array<object>}>}
 */
export async function getAnimeInfo(id) {
  const data = await request("/anime/hianime/info", { params: { id } });
  const episodes = Array.isArray(data?.episodes) ? data.episodes : [];

  if (!episodes.length) {
    throw new AnimeApiError("Este anime não tem episódios disponíveis na API.");
  }

  return {
    id: String(id),
    title: data?.title || "Anime",
    episodes,
  };
}

/**
 * Fontes de streaming de um episódio, já normalizadas por qualidade.
 *
 * @param {string} episodeId
 * @returns {Promise<Array<{url: string, label: string, isM3U8: boolean}>>}
 */
export async function getEpisodeSources(episodeId) {
  const data = await request(`/anime/hianime/watch/${encodeURIComponent(episodeId)}`);
  const sources = normalizeSources(data?.sources);

  if (!sources.length) {
    throw new AnimeApiError(
      "Nenhum link de streaming foi encontrado para este episódio.",
    );
  }

  return sources;
}
