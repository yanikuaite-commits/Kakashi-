/**
 * Provider "anikoto": extrai o link de streaming direto do site, sem depender
 * de nenhuma API de terceiros.
 *
 * PORQUÊ: o `@consumet/extensions` corre dentro do bot, mas os providers dele
 * (AnimeUnity, AnimePahe, HiAnime) estão atrás de Cloudflare e/ou com domínio
 * morto, e a biblioteca não define `User-Agent` — o Cloudflare bloqueia o
 * agente `axios/1.x` vindo de IPs de datacenter como o do Render.
 *
 * COMO: `anikoto.cz` é um clone de HiAnime que responde a IPs de datacenter
 * (verificado) e expõe a cadeia clássica em JSON:
 *
 *   GET /filter?keyword=...            → lista de animes (data-tip = id)
 *   GET /ajax/episode/list/<id>        → episódios (data-id, data-ids)
 *   GET /ajax/server/list?servers=<ids> → servidores (data-link-id, data-sv-id)
 *   GET /ajax/server?get=<link>&sv=<sv> → página do player (megaplay.buzz)
 *   GET megaplay /stream/getSources?id= → fontes; o m3u8 vem no campo `enc`,
 *                                        cifrado em AES-256-CBC
 *
 * O m3u8 devolvido é um master.m3u8 normal, que o yt-dlp baixa (comprovado).
 * Os pedidos precisam do `Referer` da página de watch, senão o site responde
 * "bad request".
 *
 * @author Dev Gui
 */
import crypto from "node:crypto";
import { ANIME_API_TIMEOUT_MS, ANIME_USER_AGENT } from "../config.js";
import { errorLog } from "../utils/logger.js";
import { AnimeApiError } from "./anime.js";

const BASE = "https://anikoto.cz";
const MEGAPLAY = "https://megaplay.buzz";

/**
 * Chave e IV do player megaplay, fixos no JS do próprio site
 * (`newclient.min.js`, função `decryptToken`). Não são segredo nosso: são
 * constantes públicas do player e mudam quando o site muda de build.
 */
const MEGAPLAY_KEY = "i?LMTAx0Q6,:}50U";
const MEGAPLAY_IV = "W0;27ToaUpl_P%'c";

const REQUEST_TIMEOUT_MS = Math.min(ANIME_API_TIMEOUT_MS, 20 * 1000);

async function fetchText(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": ANIME_USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
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

const attribute = (tag, nome) =>
  tag.match(new RegExp(`${nome}="([^"]*)"`))?.[1] ?? null;

/**
 * Pesquisa animes e devolve os resultados com o id numérico de cada um.
 *
 * O `data-tip` (id usado nos endpoints seguintes) fica no MESMO bloco do
 * `<a href>` e do título, por isso o parsing é por bloco — não por posição.
 *
 * @param {string} termo
 * @returns {Promise<Array<{id: string, slug: string, title: string, image: string|null}>>}
 */
export async function search(termo) {
  const html = await fetchText(
    `${BASE}/filter?keyword=${encodeURIComponent(termo)}`,
    `${BASE}/`,
  );

  const resultados = [];

  for (const bloco of html.matchAll(
    /<div class="item\s*">[\s\S]{0,900}?<\/div>\s*<\/div>\s*<\/div>/g,
  )) {
    const id = attribute(bloco[0], "data-tip");
    const href = bloco[0].match(/href="([^"]*\/watch\/[^"]+)"/)?.[1];
    if (!id || !href) continue;

    resultados.push({
      id,
      slug: href.replace(`${BASE}/watch/`, "").replace(/\/ep-\d+$/, ""),
      title: attribute(bloco[0], "alt") || termo,
      image: bloco[0].match(/<img src="([^"]*)"/)?.[1] || null,
    });
  }

  return resultados;
}

/**
 * Episódios de um anime (id numérico + o `data-ids` que abre os servidores).
 *
 * @param {string} animeId
 * @param {string} slug
 * @returns {Promise<Array<{id: string, number: number, ids: string}>>}
 */
export async function episodes(animeId, slug) {
  const referer = `${BASE}/watch/${slug}/ep-1`;
  const corpo = JSON.parse(await fetchText(`${BASE}/ajax/episode/list/${animeId}`, referer));

  return [...String(corpo?.result ?? "").matchAll(/<a\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => attribute(tag, "data-ids"))
    .map((tag) => ({
      id: attribute(tag, "data-id"),
      number: Number(attribute(tag, "data-num")) || 0,
      ids: attribute(tag, "data-ids"),
    }));
}

/** Desencripta o campo `enc` do megaplay (AES-256-CBC, base64url). */
function decryptMegaplay(enc) {
  const key = Buffer.alloc(32);
  Buffer.from(MEGAPLAY_KEY).copy(key);
  const iv = Buffer.from(MEGAPLAY_IV).subarray(0, 16);
  const data = Buffer.from(enc.replace(/-/g, "+").replace(/_/g, "/"), "base64");

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");

  return JSON.parse(plain)?.file || null;
}

/**
 * Link de streaming (m3u8) de um episódio.
 *
 * Percorre os servidores por ordem: os primeiros costumam estar mortos (410) e
 * o `getSources` de um servidor morto não traz o campo `enc`.
 *
 * @param {{ids: string}} episodio
 * @param {string} slug
 * @returns {Promise<string|null>}
 */
export async function sources(episodio, slug) {
  const referer = `${BASE}/watch/${slug}/ep-1`;
  const lista = JSON.parse(
    await fetchText(
      `${BASE}/ajax/server/list?servers=${encodeURIComponent(episodio.ids)}`,
      referer,
    ),
  );

  const servidores = [...String(lista?.result ?? "").matchAll(/<li\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => attribute(tag, "data-link-id"))
    .map((tag) => ({
      sv: attribute(tag, "data-sv-id"),
      link: attribute(tag, "data-link-id"),
    }));

  for (const { sv, link } of servidores) {
    try {
      const resolvido = JSON.parse(
        await fetchText(
          `${BASE}/ajax/server?get=${encodeURIComponent(link)}&sv=${sv}`,
          referer,
        ),
      );
      const playerUrl = resolvido?.result?.url;
      if (!playerUrl) continue;

      const pagina = await fetchText(playerUrl, `${BASE}/`);
      const mediaId = pagina.match(/data-mediaid="(\d+)"/)?.[1];
      if (!mediaId) continue;

      const fontes = JSON.parse(
        await fetchText(`${MEGAPLAY}/stream/getSources?id=${mediaId}`, playerUrl),
      );
      if (!fontes?.enc) continue;

      const file = decryptMegaplay(fontes.enc);
      if (file) return file;
    } catch (error) {
      errorLog(`[anime] anikoto servidor ${sv} falhou: ${error.message}`);
    }
  }

  return null;
}

/**
 * Encontra o primeiro resultado que tenha episódios, devolvendo o par
 * (anime, episódio 1) pronto para o menu.
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
      errorLog(`[anime] anikoto "${anime.title}" sem episódios: ${error.message}`);
    }
  }

  throw new AnimeApiError(
    `Os resultados de "${termo}" não têm episódios disponíveis nesta fonte.`,
  );
}
