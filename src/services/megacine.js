/**
 * Provider "Megacine": séries, doramas e animes episódicos, extraídos do site
 * sem depender de nenhuma API de terceiros.
 *
 * PORQUÊ: o catálogo do Megacine não é de animes — é de séries, com temporadas e
 * episódios, que o bot não tinha. Por isso é um comando próprio (`.megacine`) e
 * não um provider dentro do `.anime`: misturar as duas pesquisas confundiria
 * catálogos com regras diferentes.
 *
 * FILMES FICAM DE FORA. Um filme é um download único de duas horas, outro perfil
 * de uso; o comando serve conteúdo episódico. O site não separa os dois no URL
 * (ambos vivem em `/series/<slug>`), por isso a distinção é feita pelo que a
 * página do título declara: filmes mostram o botão "Assistir Filme" e séries
 * mostram "Assistir Agora". A lista de tipos excluídos vem de
 * `MEGACINE_TIPOS_EXCLUIDOS` (por omissão, `filmes`).
 *
 * COMO: a extração é mais simples do que a dos animes — não há tokens, nem
 * cifra, nem hashes. O site publica o caminho do stream no próprio HTML:
 *
 *   GET /search/?q=<termo>                      → resultados (article.card)
 *   GET /series/<slug>                          → temporadas e episódios
 *   GET /series/<slug>/temporada-NN/episodio-NN → página que declara o player
 *
 * A página do episódio traz um `urlConfig` com o domínio de dados (`base`), o
 * `tipo` (filmes/series/animes/doramas) e a temporada/episódio. O stream é
 * montado a partir dele:
 *
 *   <S>/<slug>/<NN>-temporada/<NN>/stream.m3u8
 *
 * (`<S>` é a primeira letra do slug em maiúscula.) O caminho é copiado da
 * função `construirStreamPath` do próprio site, para os dois lados não
 * divergirem quando o site mudar de build.
 *
 * IMPORTANTE — o domínio de dados tem dois lados e só um responde a IPs de
 * datacenter: o `ondemand.madfirebox.shop` (primário) devolve 403 do Cloudflare
 * ("you have been blocked"), enquanto o `forks-<tipo>.madfirebox.shop`
 * (fallback) serve o m3u8 normalmente. O site faz esse fallback sozinho em caso
 * de 403, e aqui usa-se o fallback direto — pedir o primário primeiro só
 * gastaria um pedido para receber um erro. Verificado: fallback 8/8, primário
 * 0/4.
 *
 * O m3u8 é uma playlist de mídia (segmentos `.ts`), não um master com degraus:
 * há UMA qualidade só. Por isso o fluxo não pede escolha de qualidade — o
 * download segue direto após a escolha do episódio.
 *
 * O CDN responde DEVAGAR (9–28 s só para o manifesto). O timeout curto das
 * páginas abortava a verificação de um stream que estava bom, por isso esse
 * passo usa `MEGACINE_PLAYLIST_TIMEOUT_MS`.
 *
 * @author Dev Gui
 */
import {
  MEGACINE_BASE_URL,
  MEGACINE_PLAYLIST_TIMEOUT_MS,
  MEGACINE_TIMEOUT_MS,
  MEGACINE_TIPOS_EXCLUIDOS,
  MEGACINE_USER_AGENT,
} from "../config.js";
import { errorLog } from "../utils/logger.js";

/** Domínios de dados por tipo. O `base` do urlConfig confirma qual usar. */
export const MEGACINE_FALLBACK_HOSTS = {
  filmes: "https://forks-filmes.madfirebox.shop",
  series: "https://forks-series.madfirebox.shop",
  animes: "https://forks-animes.madfirebox.shop",
  doramas: "https://forks-doramas.madfirebox.shop",
};

/** Erro de extração do Megacine (mensagem já pronta para o utilizador). */
export class MegacineError extends Error {
  constructor(message) {
    super(message);
    this.name = "MegacineError";
  }
}

const REQUEST_TIMEOUT_MS = MEGACINE_TIMEOUT_MS;

/**
 * Cabeçalhos de browser. O CDN do Megacine responde 403 a pedidos sem
 * User-Agent de browser, e o `Referer` do site é exigido nos pedidos ao m3u8.
 */
export function megacineHeaders(referer = `${MEGACINE_BASE_URL}/`) {
  return {
    "User-Agent": MEGACINE_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    Referer: referer,
  };
}

async function fetchText(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: megacineHeaders(referer),
    });

    if (!response.ok) throw new MegacineError(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Descodifica as entidades HTML usadas nos títulos do site. */
export function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Lê o tipo declarado no `card-meta` da busca (`"2026 • Filmes"` → `filmes`).
 *
 * O segundo campo do meta é o tipo do conteúdo, e é a única marca de tipo
 * disponível na listagem — o URL é `/series/<slug>` para tudo. Verificado em 9
 * títulos: o meta coincide sempre com o botão da página ("Assistir Filme" para
 * filmes, "Assistir Agora" para o resto).
 *
 * @param {string} meta
 * @returns {string} tipo em minúsculas, ou "" quando o meta não o traz
 */
export function tipoDoMeta(meta) {
  const partes = String(meta || "").split("•");
  return (partes[1] || "").trim().toLowerCase();
}

/**
 * Um filme mostra "Assistir Filme"; uma série mostra "Assistir Agora".
 *
 * É o que a própria página declara, por isso é a fonte de verdade — mais fiável
 * do que deduzir pelo número de temporadas, já que há séries de temporada única
 * (ex.: `duna-a-profecia-dublado`, 1 temporada e 6 episódios).
 *
 * @param {string} html página do título
 * @returns {boolean}
 */
export function isFilme(html) {
  const botao = String(html || "").match(
    /id="assistirplaybutton"[^>]*>([\s\S]{0,120}?)<\/a>/,
  );

  if (!botao) return false;
  return /assistir\s+filme/i.test(botao[1].replace(/<[^>]+>/g, ""));
}

/**
 * Extrai os resultados da página de busca.
 *
 * O parsing é por bloco `article.card`, não por posição: o título, a capa e o
 * link vivem no MESMO bloco. O slug sai do `href` (`/series/<slug>`), que é o
 * identificador usado em todos os passos seguintes. Resultados repetidos
 * (o mesmo título em dublado e legendado) são entradas DIFERENTES e ficam
 * ambos: são faixas de áudio distintas, não duplicados.
 *
 * Os tipos em `tiposExcluidos` (por omissão, filmes) são descartados aqui: o
 * comando serve conteúdo episódico, e anunciar um filme que depois seria
 * recusado só faria perder uma escolha ao utilizador. O filtro usa o tipo do
 * `card-meta`, que evita uma visita à página de cada resultado.
 *
 * @param {string} html
 * @param {{tiposExcluidos?: string[]}} [opcoes]
 * @returns {Array<{slug: string, title: string, image: string|null, year: string, tipo: string}>}
 */
export function parseSearch(html, { tiposExcluidos = MEGACINE_TIPOS_EXCLUIDOS } = {}) {
  const texto = String(html || "");
  const excluidos = new Set(
    (tiposExcluidos || []).map((tipo) => String(tipo).toLowerCase()),
  );
  const resultados = [];
  const vistos = new Set();

  for (const bloco of texto.matchAll(/<article class="card[\s\S]{0,1200}?<\/article>/g)) {
    const corpo = bloco[0];

    const href = corpo.match(/href="([^"]*\/series\/([a-z0-9-]+))"/i);
    if (!href) continue;

    const slug = href[2];
    if (!slug || vistos.has(slug)) continue;

    const meta = corpo.match(/<p class="card-meta">([^<]*)<\/p>/i)?.[1] || "";
    const tipo = tipoDoMeta(meta);

    if (tipo && excluidos.has(tipo)) continue;

    vistos.add(slug);

    const titulo =
      corpo.match(/<h3 class="card-title">([^<]*)<\/h3>/i)?.[1] ||
      corpo.match(/aria-label="Abrir ([^"]*)"/i)?.[1] ||
      slug;

    const imagem = corpo.match(/<img[^>]*src="([^"]+)"/i)?.[1] || null;
    const ano = meta.match(/(\d{4})/)?.[1] || "";

    resultados.push({
      slug,
      title: decodeEntities(titulo),
      image: imagem,
      year: ano,
      tipo,
    });
  }

  return resultados;
}

/**
 * Extrai as temporadas e os episódios de uma página de detalhe.
 *
 * A página declara as mesmas temporadas em TRÊS representações diferentes
 * (`episodes-modern-season-content`, `season-content` e `season-grid-content`).
 * Contar os `href` sem deduplicar dava 88 episódios numa temporada de 8 — o
 * parsing é por CONJUNTO de pares (temporada, episódio), e não por ocorrência.
 *
 * @param {string} html
 * @param {string} slug
 * @returns {Array<{number: number, episodes: Array<{number: number}>}>}
 */
export function parseSeasons(html, slug) {
  const texto = String(html || "");
  const alvo = String(slug || "").trim();
  if (!alvo) return [];

  const padrao = new RegExp(
    `/series/${alvo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/temporada-(\\d+)/episodio-(\\d+)`,
    "g",
  );

  const porTemporada = new Map();

  for (const achado of texto.matchAll(padrao)) {
    const temporada = Number(achado[1]);
    const episodio = Number(achado[2]);
    if (!temporada || !episodio) continue;

    if (!porTemporada.has(temporada)) porTemporada.set(temporada, new Set());
    porTemporada.get(temporada).add(episodio);
  }

  return [...porTemporada.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, episodios]) => ({
      number,
      episodes: [...episodios]
        .sort((a, b) => a - b)
        .map((numero) => ({ number: numero })),
    }));
}

/**
 * Extrai o `urlConfig` da página do episódio — a fonte de verdade do site.
 *
 * Ler a configuração do próprio player (em vez de deduzir o domínio e o tipo)
 * evita divergir quando o site mudar de build: o que o site usa é o que se usa.
 *
 * @param {string} html
 * @returns {{base: string, slug: string, tipo: string, temporada: number, episodio: number}|null}
 */
export function parsePlayerConfig(html) {
  const texto = String(html || "");
  const bloco = texto.match(/urlConfig\s*=\s*\{([\s\S]{0,400}?)\}/);
  if (!bloco) return null;

  const campo = (nome) => {
    const achado = bloco[1].match(
      new RegExp(`${nome}\\s*:\\s*"?([^",\\s]+)"?`),
    );
    return achado ? achado[1] : "";
  };

  const base = campo("base");
  const slug = campo("slug");
  const tipo = campo("tipo");
  if (!base || !slug || !tipo) return null;

  return {
    base,
    slug,
    tipo,
    temporada: Number(campo("temporada")) || 1,
    episodio: Number(campo("episodio")) || 1,
  };
}

/**
 * Monta o caminho do stream como o site o monta (`construirStreamPath`).
 *
 * Séries, animes e doramas são indexados por temporada e episódio. A primeira
 * letra do slug vai em maiúscula.
 *
 * Filmes usariam `<S>/<slug>/stream/stream.m3u8` (um stream único), mas não
 * chegam aqui: são filtrados na pesquisa e recusados em `getSeasons`, porque o
 * comando serve só conteúdo episódico.
 *
 * @param {{slug: string, temporada: number, episodio: number}} config
 * @returns {string}
 */
export function buildStreamPath({ slug, temporada, episodio }) {
  const primeira = String(slug).charAt(0).toUpperCase();
  const t = String(temporada).padStart(2, "0");
  const e = String(episodio).padStart(2, "0");

  return `${primeira}/${slug}/${t}-temporada/${e}/stream.m3u8`;
}

/** Pesquisa no catálogo. */
export async function search(termo) {
  const html = await fetchText(
    `${MEGACINE_BASE_URL}/search/?q=${encodeURIComponent(termo)}`,
    `${MEGACINE_BASE_URL}/`,
  );

  return parseSearch(html);
}

/**
 * Temporadas e episódios de um título.
 *
 * A página também diz se o título é um filme ("Assistir Filme"). A busca já
 * filtra filmes pelo `card-meta`, mas este passo é a rede de segurança: um meta
 * ausente ou com formato novo deixaria um filme passar, e a página é a fonte de
 * verdade. Detetado o filme, devolve `isFilme: true` para o fluxo recusar.
 *
 * @param {string} slug
 * @returns {Promise<{seasons: Array, isFilme: boolean}>}
 */
export async function getSeasons(slug) {
  const html = await fetchText(
    `${MEGACINE_BASE_URL}/series/${slug}`,
    `${MEGACINE_BASE_URL}/`,
  );

  return { seasons: parseSeasons(html, slug), isFilme: isFilme(html) };
}

/**
 * Resolve o URL do stream de um episódio.
 *
 * Lê a página do episódio, tira o `urlConfig` e monta o URL no domínio de
 * fallback. O `tipo` do urlConfig confirma qual é o domínio de dados.
 *
 * @param {string} slug
 * @param {number} [temporada]
 * @param {number} [episodio]
 * @returns {Promise<{url: string, tipo: string, referer: string}>}
 */
export async function getEpisodeStream(slug, temporada = 1, episodio = 1) {
  const t = String(temporada).padStart(2, "0");
  const e = String(episodio).padStart(2, "0");
  const pagina = `${MEGACINE_BASE_URL}/series/${slug}/temporada-${t}/episodio-${e}`;

  const html = await fetchText(pagina, `${MEGACINE_BASE_URL}/`);
  const config = parsePlayerConfig(html);

  if (!config) {
    throw new MegacineError(
      "Não encontrei o player deste título. A fonte pode ter mudado.",
    );
  }

  // O fallback é o lado que responde; o `base` do urlConfig confirma o tipo.
  const base =
    MEGACINE_FALLBACK_HOSTS[String(config.tipo).toLowerCase()] || config.base;

  const referer = `${MEGACINE_BASE_URL}/`;

  return {
    url: `${base}/${buildStreamPath(config)}`,
    tipo: config.tipo,
    referer,
  };
}

/**
 * Confirma que o URL é uma playlist HLS antes de gastar um download.
 *
 * Sem esta verificação, um bloqueio do CDN só aparecia depois de cobrar
 * créditos e de arrancar o yt-dlp, com uma mensagem técnica.
 *
 * Usa um timeout PRÓPRIO (`MEGACINE_PLAYLIST_TIMEOUT_MS`): o CDN serve o
 * manifesto em 9–28 s, e o teto curto das páginas abortava um stream que estava
 * bom — o utilizador via "a fonte não respondeu" num título que funcionava.
 *
 * @param {string} url
 * @param {string} [referer]
 * @returns {Promise<boolean>}
 */
export async function isPlaylistReachable(url, referer) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEGACINE_PLAYLIST_TIMEOUT_MS);
    timer.unref?.();

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: megacineHeaders(referer),
      });

      if (!response.ok) return false;

      const inicio = (await response.text()).slice(0, 32);
      return inicio.includes("#EXTM3U");
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    errorLog(`[megacine] verificação do stream falhou: ${error.message}`);
    return false;
  }
}

/** Argumentos do yt-dlp para o CDN do Megacine. */
export function megacineDownloadArgs(referer = `${MEGACINE_BASE_URL}/`) {
  return ["--referer", referer, "--user-agent", MEGACINE_USER_AGENT];
}
