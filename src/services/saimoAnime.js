/**
 * Saimo TV — catálogo e fontes de ANIMES.
 *
 * Substitui o `meusanimes.js` no fluxo `.anime`, com a MESMA interface
 * (`search`, `episodes`, `seasons`, `seasonEpisodes`, `sources`), para o
 * `anime.js` continuar a ser a camada de serviço sem saber de quem são os
 * dados. O `meusanimes.js` continua no repositório, apenas deixou de ser
 * chamado.
 *
 * O catálogo de animes vive em `redeflix/links-animes.txt`, em blocos:
 *   @Título   ano   tmdbId
 *   temporada  episódio  versão(dub|leg)  url1,url2,...
 *
 * A maioria dos episódios é HLS (`master.txt`, com degraus 360p/720p); os
 * restantes são mp4 único. `sources()` lê o `master.txt` e devolve um item por
 * degrau, que é o que dá ao menu a escolha real de qualidade.
 *
 * @author Dev Yanik
 */
import { ANIME_API_TIMEOUT_MS, ANIME_USER_AGENT } from "../config.js";
import { errorLog } from "../utils/logger.js";
import { AUDIO_DUBBED, AUDIO_SUBBED } from "../utils/animeFormat.js";
import {
  SaimoError,
  destoken,
  filtrarPorTermo,
  melhorUrl,
  normalizar,
  parseFichas,
  token,
} from "./saimo.js";

const CATALOGO = process.env.SAIMO_CATALOG_BASE || "https://filmes-saimo.pages.dev";
const REFERER = `${CATALOGO}/`;

const cache = new Map();

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANIME_API_TIMEOUT_MS);
  timer.unref?.();

  try {
    const resposta = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": ANIME_USER_AGENT, referer: REFERER },
    });
    if (!resposta.ok) return null;
    return await resposta.text();
  } catch (error) {
    errorLog(`[saimo] falha ao ler ${url}: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function lerAnimes() {
  if (cache.has("animes")) return cache.get("animes");
  const texto = await fetchText(`${CATALOGO}/redeflix/links-animes.txt`);
  cache.set("animes", texto);
  return texto;
}

/**
 * Capas do `fichas.txt`, indexadas pelo id do TMDB.
 *
 * O `links-animes.txt` não traz pôster, mas o `fichas.txt` (o mesmo que o
 * catálogo de séries/filmes usa) tem o pôster de cada título e o id do TMDB —
 * e o bloco do anime traz esse id. O índice por id é o casamento fiável
 * (98% dos títulos, contra 93% pelo nome, que ainda leva com sufixos como
 * "Dublado" que o ficheiro de fichas não tem).
 *
 * @returns {Promise<{baseCapa: string, porTmdb: Map<string,string>, porTitulo: Map<string,string>}>}
 */
async function lerFichas() {
  if (cache.has("fichas")) return cache.get("fichas");

  const indice = { baseCapa: "", porTmdb: new Map(), porTitulo: new Map() };

  try {
    const { baseCapa, fichas } = parseFichas(
      await fetchText(`${CATALOGO}/fichas.txt`),
    );
    indice.baseCapa = baseCapa || "";

    for (const ficha of fichas) {
      if (!ficha.poster) continue;
      const caminho = ficha.poster.startsWith("/") ? ficha.poster : `/${ficha.poster}`;
      const url = baseCapa ? `${baseCapa.replace(/\/$/, "")}${caminho}` : "";

      if (ficha.tmdbId) indice.porTmdb.set(String(ficha.tmdbId).trim(), url);
      indice.porTitulo.set(normalizar(ficha.titulo), url);
    }
  } catch (error) {
    // Sem capas o menu continua a funcionar: a imagem é um extra.
    errorLog(`[saimo] fichas indisponíveis: ${error.message}`);
  }

  cache.set("fichas", indice);
  return indice;
}

/**
 * Capa de um anime: pelo id do TMDB primeiro, pelo título como recurso.
 *
 * @param {{titulo: string, tmdbId?: string}} bloco
 * @returns {Promise<string|null>}
 */
async function capaDoAnime(bloco) {
  const { porTmdb, porTitulo } = await lerFichas();

  const id = String(bloco?.tmdbId || "").trim();
  if (id && porTmdb.get(id)) return porTmdb.get(id);

  const alvo = normalizar(bloco?.titulo);
  if (alvo && porTitulo.get(alvo)) return porTitulo.get(alvo);

  // O catálogo rotula algumas entradas com o sufixo da faixa ("... Dublado"),
  // que não existe no ficheiro de fichas.
  const semSufixo = normalizar(String(bloco?.titulo || "").replace(/\s*(dublado|legendado)\s*$/i, ""));
  return porTitulo.get(semSufixo) || null;
}

/** Limpa a cache (usado pelos testes). */
export function limparCacheAnimes() {
  cache.clear();
}

/** Converte `dub`/`leg` do catálogo no vocabulário do menu. */
function versaoParaFaixa(versao) {
  const v = String(versao || "").trim().toLowerCase();
  if (v.startsWith("dub")) return AUDIO_DUBBED;
  if (v.startsWith("leg") || v.startsWith("sub")) return AUDIO_SUBBED;
  return "";
}

/**
 * Blocos de animes a partir do ficheiro do catálogo.
 *
 * @param {string} texto
 * @returns {Array<{titulo: string, ano: string, episodios: Array<{temporada:number, numero:number, faixa:string, urls:string[]}>}>}
 */
export function parseAnimes(texto) {
  const blocos = [];
  let atual = null;

  for (const bruto of String(texto || "").split("\n")) {
    const linha = bruto.trim();
    if (!linha) continue;

    if (linha.startsWith("@")) {
      const p = linha.slice(1).split("\t");
      atual = {
        titulo: (p[0] || "").trim(),
        ano: (p[1] || "").trim(),
        // O id do TMDB é o que casa com `fichas.txt` (98% dos títulos, contra
        // 93% pelo nome): é por ele que a capa é encontrada.
        tmdbId: (p[2] || "").trim(),
        episodios: [],
      };
      blocos.push(atual);
      continue;
    }

    if (!atual) continue;

    const p = linha.split("\t");
    if (p.length < 4) continue;

    const urls = (p[3] || "").split(",").map((u) => u.trim()).filter(Boolean);
    if (!urls.length) continue;

    atual.episodios.push({
      temporada: Number(p[0]) || 1,
      numero: Number(p[1]) || 0,
      faixa: versaoParaFaixa(p[2]),
      urls,
    });
  }

  return blocos.filter((b) => b.episodios.length);
}

/** Encontra o bloco do título a partir do token de referência. */
async function acharBloco(ref) {
  const blocos = parseAnimes(await lerAnimes());
  const alvoTitulo = normalizar(ref?.t);
  const alvoAno = String(ref?.a || "").trim();

  return (
    blocos.find(
      (b) =>
        normalizar(b.titulo) === alvoTitulo && (!alvoAno || !b.ano || b.ano === alvoAno),
    ) || null
  );
}

/**
 * Pesquisa animes pelo nome (interface do `meusanimes.search`).
 *
 * Cada resultado leva a CAPA quando o `fichas.txt` a tem, para o menu poder
 * distinguir remakes e temporadas homónimas (era o que faltava desde que a
 * fonte passou a ser o saimo).
 *
 * @param {string} termo
 * @returns {Promise<Array<{id: string, slug: string, title: string, image: string|null}>>}
 */
export async function search(termo) {
  const alvo = normalizar(termo);
  if (alvo.length < 2) return [];

  const blocos = parseAnimes(await lerAnimes());

  const out = [];
  const vistos = new Set();

  for (const bloco of filtrarPorTermo(blocos, alvo)) {
    if (vistos.has(bloco.titulo)) continue;
    vistos.add(bloco.titulo);

    const ref = token({ t: bloco.titulo, a: bloco.ano });

    out.push({
      id: ref,
      slug: ref,
      title: bloco.titulo,
      image: await capaDoAnime(bloco),
    });
  }

  return out;
}

/** Temporadas distintas presentes num bloco. */
function temporadasDoBloco(bloco) {
  return [...new Set(bloco.episodios.map((e) => e.temporada || 1))].sort((a, b) => a - b);
}

/**
 * Episódios de uma temporada, filtrados pela faixa pedida quando existe.
 *
 * A faixa é uma preferência: se o título só publicar a outra, devolve-se a que
 * existe (o menu avisa). Cada episódio leva a faixa real em `versions`, que é o
 * que alimenta o aviso de idioma.
 *
 * @param {object} bloco
 * @param {number} indiceTemporada
 * @param {string} [audioVersion]
 * @returns {Array<{id:string, number:number, ids:string, versions:string[]}>}
 */
function episodiosDaTemporada(bloco, indiceTemporada, audioVersion) {
  const temporada = temporadasDoBloco(bloco)[indiceTemporada];
  const doBloco = bloco.episodios.filter((e) => (e.temporada || 1) === temporada);

  const faixaPedida = versaoParaFaixa(audioVersion);
  const disponiveis = [...new Set(doBloco.map((e) => e.faixa).filter(Boolean))];

  const escolhida =
    faixaPedida && disponiveis.includes(faixaPedida) ? faixaPedida : disponiveis[0] || "";

  const porNumero = new Map();

  for (const ep of doBloco) {
    if (escolhida && ep.faixa && ep.faixa !== escolhida) continue;
    if (porNumero.has(ep.numero)) continue;

    const faixas = [...new Set(doBloco.filter((x) => x.numero === ep.numero).map((x) => x.faixa).filter(Boolean))];

    porNumero.set(ep.numero, {
      id: String(ep.numero),
      number: ep.numero,
      ids: token({ u: ep.urls, v: ep.faixa }),
      versions: faixas.length ? faixas : disponiveis,
    });
  }

  return [...porNumero.values()].sort((a, b) => a.number - b.number);
}

/**
 * Temporadas do anime (interface do `meusanimes.seasons`).
 *
 * Devolve `[]` quando só há uma: uma escolha de um item só seria ruído.
 *
 * O slug de cada temporada é um TOKEN próprio (`{t, a, i}`) e não
 * `"<slug>::<i>"`: o `anime.js` monta o id do episódio como
 * `"<slug>::<epId>::<ids>"` e o divide em exatamente TRÊS partes. Um `::` extra
 * no slug da temporada deslocava o `ids` e o link saía errado.
 *
 * @param {string} animeId
 * @param {string} slug
 * @param {string} [audioVersion]
 * @returns {Promise<Array<{slug: string, title: string}>>}
 */
export async function seasons(animeId, slug, audioVersion = "") {
  const ref = destoken(String(slug || animeId));
  if (!ref?.t) return [];

  const bloco = await acharBloco(ref);
  if (!bloco) return [];

  const temporadas = temporadasDoBloco(bloco);
  if (temporadas.length < 2) return [];

  return temporadas.map((numero, indice) => ({
    slug: token({ t: bloco.titulo, a: bloco.ano, i: indice }),
    title: `Temporada ${numero}`,
  }));
}

/**
 * Episódios de uma temporada — interface do `meusanimes.seasonEpisodes`.
 *
 * @param {string} entrada token da temporada
 * @param {string} [audioVersion]
 * @returns {Promise<Array<object>>}
 */
export async function seasonEpisodes(entrada, audioVersion = "") {
  const ref = destoken(entrada);
  if (!ref?.t) throw new SaimoError("Temporada inválida. Envia .menu para recomeçar.");

  const bloco = await acharBloco(ref);
  if (!bloco) throw new SaimoError("Este anime não tem episódios disponíveis na fonte.");

  const lista = episodiosDaTemporada(bloco, Number(ref.i) || 0, audioVersion);
  if (!lista.length) throw new SaimoError("Esta temporada não tem episódios disponíveis.");

  return lista;
}

/**
 * Episódios do anime inteiro (a primeira temporada, ou a única) — interface do
 * `meusanimes.episodes`.
 *
 * @param {string} animeId
 * @param {string} slug
 * @param {string} [audioVersion]
 * @returns {Promise<Array<object>>}
 */
export async function episodes(animeId, slug, audioVersion = "") {
  const ref = destoken(String(slug || animeId));
  if (!ref?.t) throw new SaimoError("Anime inválido. Envia .menu para recomeçar.");

  const bloco = await acharBloco(ref);
  if (!bloco) throw new SaimoError("Este anime não tem episódios disponíveis na fonte.");

  const lista = episodiosDaTemporada(bloco, 0, audioVersion);
  if (!lista.length) throw new SaimoError("Este anime não tem episódios disponíveis na fonte.");

  return lista;
}

/**
 * Degraus de um `master.txt` HLS.
 *
 * Devolve um item por variante (`360p`, `720p`). É isto que dá ao menu a
 * escolha de qualidade real; um mp4 único devolve um só item.
 *
 * @param {string} masterUrl
 * @returns {Promise<Array<{url: string, quality: string, isM3U8: boolean}>>}
 */
async function degrausHls(masterUrl) {
  const texto = await fetchText(masterUrl);
  if (!texto) return [];

  const linhas = texto.split("\n");
  const out = [];

  for (let i = 0; i < linhas.length; i += 1) {
    if (!linhas[i].startsWith("#EXT-X-STREAM-INF")) continue;

    const uri = (linhas[i + 1] || "").trim();
    if (!uri) continue;

    const altura = (linhas[i].match(/RESOLUTION=(\d+)x(\d+)/) || [])[2];
    const nome = (linhas[i].match(/NAME="([^"]+)"/) || [])[1];

    out.push({
      // O URL é o MASTER, não a variante do degrau. A variante (`/m3/...`) é
      // SÓ VÍDEO: o áudio vive numa rendition separada
      // (`#EXT-X-MEDIA:TYPE=AUDIO`) que apenas o master declara. Baixar a
      // variante direta entregava um episódio mudo. Com o master e a altura,
      // o yt-dlp escolhe o degrau e junta a faixa de áudio.
      url: masterUrl,
      height: altura ? Number(altura) : undefined,
      quality: nome || (altura ? `${altura}p` : "auto"),
      isM3U8: true,
    });
  }

  return out;
}

/**
 * Fontes de um episódio (interface do `meusanimes.sources`).
 *
 * O `ids` é um token com os URLs do catálogo; para HLS lê-se o `master.txt` e
 * devolve-se um item por degrau, para o menu oferecer 360p/720p.
 *
 * @param {{id: string, ids: string}} episodio
 * @returns {Promise<Array<{url: string, quality: string, isM3U8: boolean}>>}
 */
export async function sources(episodio) {
  const dados = destoken(episodio?.ids);
  const urls = Array.isArray(dados?.u) ? dados.u : [];

  if (!urls.length) {
    throw new SaimoError("Este episódio não tem um link válido na fonte.");
  }

  const hls = urls.find((u) => String(u).includes("master.txt"));

  if (hls) {
    const degraus = await degrausHls(hls);
    if (degraus.length) return degraus;

    // Sem degraus legíveis, serve-se a playlist como está.
    return [{ url: hls, quality: "auto", isM3U8: true }];
  }

  const mp4 = melhorUrl(urls);
  if (!mp4) throw new SaimoError("A fonte não devolveu o vídeo deste episódio.");

  return [{ url: mp4, quality: "auto", isM3U8: false }];
}
