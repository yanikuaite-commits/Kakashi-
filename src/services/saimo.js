/**
 * Saimo TV — catálogo e fontes de SÉRIES/doramas (o lado episódico).
 *
 * Substitui o `megacine.js` no fluxo `.megacine`, com a MESMA interface
 * (`search`, `getSeasons`, `getEpisodeStream`, `isPlaylistReachable`,
 * `megacineDownloadArgs`), para o menu continuar a funcionar sem saber de quem
 * são os dados. O `megacine.js` continua no repositório, apenas deixou de ser
 * chamado.
 *
 * O site (Cloudflare Pages SPA) publica o catálogo em ficheiros `.txt`:
 *   - `busca.txt`            → índice geral (título, tipo, letra, ano)
 *   - `series-<L>.txt`       → títulos da letra (título, ano, pedaço, eps)
 *   - `series-<L>-<P>.txt`   → episódios do pedaço, em blocos `@Título`
 *   - `filmes-<L>.txt`       → filmes da letra (título, `dub=`, `leg=`)
 *   - `redeflix/links-animes.txt` → o catálogo de animes (ver `saimoAnime.js`)
 *
 * O separador é TAB (o site divide por TAB no build minificado); linhas antigas
 * de 5 espaços também são aceites.
 *
 * FILMES: entram na pesquisa (tipo `f`), ao contrário do Megacine antigo, que os
 * excluía. Um filme é um download único (não episódico), por isso não passa por
 * temporadas — o menu deteta o token `f` e segue para a faixa/qualidade. O
 * tamanho é o problema real: medidos 0,5 a 5,5 GB por ficheiro, acima do teto de
 * envio, por isso o fluxo comprime antes de enviar (ver `mediaPrepare.js`).
 *
 * @author Dev Yanik
 */
import { ANIME_USER_AGENT, MEGACINE_TIPOS_EXCLUIDOS } from "../config.js";
import { AUDIO_DUBBED, AUDIO_SUBBED } from "../utils/animeFormat.js";
import { errorLog } from "../utils/logger.js";

/** Erro do provedor (catálogo indisponível ou título sem episódios). */
export class SaimoError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "SaimoError";
  }
}

const CATALOGO = process.env.SAIMO_CATALOG_BASE || "https://filmes-saimo.pages.dev";
const TIMEOUT_MS = Number(process.env.SAIMO_TIMEOUT_MS || 30000);
const MAX_PEDACO = Number(process.env.SAIMO_MAX_PEDACO || 30);
const REFERER = `${CATALOGO}/`;

/** Divide uma linha em campos: TAB quando existe, senão 5+ espaços. */
function campos(linha) {
  const texto = String(linha || "");
  return texto.includes("\t") ? texto.split("\t") : texto.split(/\s{5,}/);
}

/**
 * Normaliza um título para comparação (sem acentos, minúsculas, sem pontuação).
 * A mesma normalização que o site usa, para a correspondência bater certo.
 *
 * @param {string} texto
 * @returns {string}
 */
export function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A letra `#` vira `%23` no nome do ficheiro, como o site faz. */
export function letraArquivo(letra) {
  const valor = String(letra || "").trim();
  return valor === "#" ? "%23" : valor;
}

/** Codifica um objeto num token seguro para `rowId`/ids (sem `:` nem `::`). */
export function token(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

/** Descodifica um token; devolve `null` em vez de rebentar com lixo. */
export function destoken(valor) {
  try {
    const obj = JSON.parse(Buffer.from(String(valor || ""), "base64url").toString("utf8"));
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Escolhe o melhor URL de uma lista.
 *
 * As linhas trazem várias fontes para o MESMO conteúdo (CDN, proxy do site),
 * não qualidades. Para HLS prefere-se o `master.txt` (que tem degraus); para
 * mp4 prefere-se o `.mp4` direto.
 *
 * @param {string[]} urls
 * @param {{hls?: boolean}} [opcoes]
 * @returns {string|null}
 */
export function melhorUrl(urls, { hls = false } = {}) {
  const lista = (urls || []).map((u) => String(u || "").trim()).filter(Boolean);
  if (!lista.length) return null;
  if (hls) return lista.find((u) => u.includes("master.txt")) || lista[0];
  return lista.find((u) => u.endsWith(".mp4")) || lista[0];
}

/**
 * Os candidatos de UMA faixa por ordem de preferência: o `melhorUrl` primeiro,
 * depois as restantes. A fonte publica o mesmo filme em vários CDNs e alguns
 * respondem `404`/`503` isoladamente, por isso uma falha do primeiro não deve
 * condenar o filme — quem chama tenta os seguintes.
 *
 * @param {string[]} urls
 * @returns {string[]}
 */
export function candidatosUrl(urls) {
  const lista = (urls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const melhor = melhorUrl(lista);
  if (!melhor) return [];
  return [melhor, ...lista.filter((u) => u !== melhor)];
}

/** Índice de séries: `título  ano  pedaço  episódios` (um por linha). */
export function parseSeriesIndice(texto) {
  const out = [];
  for (const linha of String(texto || "").split("\n")) {
    const p = campos(linha.trim());
    if (p.length < 4 || !p[0].trim()) continue;
    out.push({
      titulo: p[0].trim(),
      ano: (p[1] || "").trim(),
      pedaco: Number(p[2]) || 0,
      episodios: Number(p[3]) || 0,
    });
  }
  return out;
}

/**
 * Blocos de episódios (`@Título` seguido de `temporada  episódio  versão  urls`).
 *
 * @param {string} texto
 * @returns {Array<{titulo: string, ano: string, episodios: Array<{temporada:number, numero:number, versao:string, urls:string[]}>}>}
 */
export function parseSeriesBlocos(texto) {
  const blocos = [];
  let atual = null;

  for (const bruto of String(texto || "").split("\n")) {
    const linha = bruto.trim();
    if (!linha) continue;

    if (linha.startsWith("@")) {
      const p = campos(linha.slice(1));
      atual = { titulo: (p[0] || "").trim(), ano: (p[1] || "").trim(), episodios: [] };
      blocos.push(atual);
      continue;
    }

    if (!atual) continue;

    const p = campos(linha);
    if (p.length < 4) continue;

    const urls = (p[3] || "").split(",").map((u) => u.trim()).filter(Boolean);
    if (!urls.length) continue;

    atual.episodios.push({
      temporada: Number(p[0]) || 0,
      numero: Number(p[1]) || 0,
      versao: (p[2] || "").trim(),
      urls,
    });
  }

  return blocos;
}

/**
 * Linha de filme: `título  dub=<urls>  leg=<urls>`.
 *
 * As duas faixas são opcionais e independentes (medido: 4053 só `dub=`, 2045 só
 * `leg=`, 1566 com ambas). Cada `=` traz uma lista de URLs separada por vírgula:
 * são ESPELHOS do mesmo conteúdo (CDN direto e proxy do site), não qualidades —
 * a escolha entre eles é `melhorUrl`.
 *
 * @param {string} texto
 * @returns {Array<{titulo:string, dub:string[], leg:string[]}>}
 */
export function parseFilmes(texto) {
  const out = [];

  for (const bruto of String(texto || "").split("\n")) {
    const linha = bruto.trim();
    if (!linha || linha.startsWith("#")) continue;

    const p = campos(linha);
    const titulo = (p[0] || "").trim();
    if (!titulo) continue;

    const faixas = { titulo, dub: [], leg: [] };

    for (const campo of p.slice(1)) {
      const casamento = String(campo).match(/^(dub|leg)\s*=\s*(.+)$/i);
      if (!casamento) continue;

      faixas[casamento[1].toLowerCase()] = casamento[2]
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean);
    }

    // Um título sem URL nenhum não serve para nada.
    if (!faixas.dub.length && !faixas.leg.length) continue;
    out.push(faixas);
  }

  return out;
}

/** Índice geral: `título  tipo(f|s)  letra  ano`. */
export function parseBusca(texto) {
  const out = [];
  for (const linha of String(texto || "").split("\n")) {
    const p = campos(linha.trim());
    if (p.length < 3 || !p[0].trim()) continue;
    out.push({
      titulo: p[0].trim(),
      tipo: (p[1] || "").trim(),
      letra: (p[2] || "").trim(),
      ano: (p[3] || "").trim(),
    });
  }
  return out;
}

/**
 * Fichas de cada título: `tipo  título  tmdbId  pôster  gêneros`.
 *
 * A primeira linha é o cabeçalho (`capa: https://image.tmdb.org/t/p/w342`) e
 * define o prefixo das imagens; as restantes são os títulos. O pôster vem em
 * caminho relativo (`/abc.jpg`), por isso a base do cabeçalho é necessária.
 *
 * @param {string} texto
 * @returns {{baseCapa: string, fichas: Array<{tipo:string, titulo:string, tmdbId:string, poster:string, generos:string}>}}
 */
export function parseFichas(texto) {
  let baseCapa = "";
  const fichas = [];

  for (const bruto of String(texto || "").split("\n")) {
    const linha = bruto.trim();
    if (!linha) continue;

    const cabecalho = linha.match(/^capa:\s*(\S+)/i);
    if (cabecalho) {
      baseCapa = cabecalho[1];
      continue;
    }
    if (linha.startsWith("#")) continue;

    const p = campos(linha);
    if (p.length < 4) continue;

    fichas.push({
      tipo: (p[0] || "").trim(),
      titulo: (p[1] || "").trim(),
      tmdbId: (p[2] || "").trim(),
      poster: (p[3] || "").trim(),
      generos: (p[4] || "").trim(),
    });
  }

  return { baseCapa, fichas };
}

/**
 * URL completa do pôster de um título, ou `null`.
 *
 * O casamento é por título normalizado: a ficha e a pesquisa usam o MESMO
 * título do catálogo, por isso a chave bate. Um título sem ficha fica sem capa
 * em vez de rebentar — a imagem é um extra, nunca um requisito.
 *
 * @param {string} baseCapa
 * @param {Array<object>} fichas
 * @param {string} titulo
 * @returns {string|null}
 */
export function posterDoTitulo(baseCapa, fichas, titulo) {
  if (!baseCapa) return null;
  const alvo = normalizar(titulo);
  if (!alvo) return null;

  const ficha = fichas.find((f) => normalizar(f.titulo) === alvo);
  if (!ficha?.poster) return null;

  const caminho = ficha.poster.startsWith("/") ? ficha.poster : `/${ficha.poster}`;
  return `${baseCapa.replace(/\/$/, "")}${caminho}`;
}

/**
 * Escolhe os títulos que correspondem ao termo.
 *
 * Primeiro a correspondência por SUBSTRING (o caso comum: "naruto" →
 * "Naruto Shippuden"). Se nada bater, cai para uma correspondência por TOKENS:
 * o site antigo pesquisava de forma difusa, e uma pesquisa por sinónimo ou
 * tradução ("My Hero Academia" num catálogo que só tem "Boku no Hero Academia")
 * ficava sem resultado nenhum. O recurso exige pelo menos metade dos tokens do
 * termo, para não devolver o catálogo inteiro numa pesquisa curta.
 *
 * @param {Array<{titulo: string}>} itens
 * @param {string} alvo termo já normalizado
 * @param {number} [limite]
 * @returns {Array<object>}
 */
export function filtrarPorTermo(itens, alvo, limite = 20) {
  const termo = normalizar(alvo);
  if (termo.length < 2) return [];

  const estritos = itens.filter((item) => normalizar(item.titulo).includes(termo));
  if (estritos.length) return estritos.slice(0, limite);

  const tokens = termo.split(" ").filter(Boolean);
  const minimo = Math.max(1, Math.ceil(tokens.length / 2));

  return itens
    .map((item) => {
      const titulo = normalizar(item.titulo);
      return { item, score: tokens.filter((t) => titulo.includes(t)).length };
    })
    .filter(({ score }) => score >= minimo)
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)
    .map(({ item }) => item);
}

/** GET de texto do catálogo, com timeout e User-Agent de browser. */
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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

/** Lê um ficheiro do catálogo, com cache em memória (o processo dura). */
const cache = new Map();

async function lerArquivo(nome) {
  if (cache.has(nome)) return cache.get(nome);
  const texto = await fetchText(`${CATALOGO}/${nome}`);
  cache.set(nome, texto);
  return texto;
}

/** Limpa a cache do catálogo (usado pelos testes). */
export function limparCacheSaimo() {
  cache.clear();
}

/**
 * Encontra o bloco de episódios de um título a partir do token de pesquisa.
 *
 * Usa o índice da letra (`series-<L>.txt`) para saber o pedaço; se o índice
 * falhar, varre os pedaços até encontrar o bloco — a rede de segurança para um
 * título que o índice não liste.
 *
 * @param {{l: string, t: string, a?: string}} ref
 * @returns {Promise<Array<object>>}
 */
async function acharEpisodios(ref) {
  const alvoTitulo = normalizar(ref.t);
  const alvoAno = String(ref.a || "").trim();

  const indice = parseSeriesIndice(await lerArquivo(`series-${letraArquivo(ref.l)}.txt`));
  const entrada = indice.find(
    (item) =>
      normalizar(item.titulo) === alvoTitulo && (!alvoAno || !item.ano || item.ano === alvoAno),
  );

  const pedacos = entrada
    ? [entrada.pedaco]
    : Array.from({ length: MAX_PEDACO + 1 }, (_, i) => i);

  for (const pedaco of pedacos) {
    const texto = await lerArquivo(`series-${letraArquivo(ref.l)}-${pedaco}.txt`);
    const bloco = parseSeriesBlocos(texto).find(
      (b) =>
        normalizar(b.titulo) === alvoTitulo && (!alvoAno || !b.ano || b.ano === alvoAno),
    );
    if (bloco?.episodios?.length) return bloco.episodios;
  }

  return [];
}

/**
 * Pesquisa séries pelo nome (interface do `megacine.search`).
 *
 * Cada resultado leva a CAPA (pôster TMDB de `fichas.txt`) para o menu poder
 * mostrar de que título se trata antes de o utilizador escolher.
 *
 * @param {string} termo
 * @param {number} [limite]
 * @returns {Promise<Array<{slug: string, title: string, image: string|null, year: string, tipo: string}>>}
 */
export async function search(termo, limite = 20) {
  const alvo = normalizar(termo);
  if (alvo.length < 2) return [];

  const indice = parseBusca(await lerArquivo("busca.txt"));
  // Filmes entram por omissão; o dono pode voltar a excluí-los com
  // `MEGACINE_TIPOS_EXCLUIDOS=filmes`.
  const tipos = MEGACINE_TIPOS_EXCLUIDOS.includes("filmes") ? ["s"] : ["s", "f"];
  const itens = indice.filter((item) => tipos.includes(item.tipo));
  const { baseCapa, fichas } = parseFichas(await lerArquivo("fichas.txt"));

  const out = [];
  const vistos = new Set();

  for (const item of filtrarPorTermo(itens, alvo, limite)) {
    // O tipo entra na chave: um filme e uma série podem partilhar o título.
    const chave = `${item.tipo}|${normalizar(item.titulo)}|${item.ano}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    out.push({
      slug: token({ k: item.tipo, l: item.letra, t: item.titulo, a: item.ano }),
      title: item.titulo,
      image: posterDoTitulo(baseCapa, fichas, item.titulo),
      year: item.ano,
      tipo: item.tipo === "f" ? "filme" : "série",
    });
  }

  return out;
}

/**
 * Converte `dub`/`leg` do catálogo no vocabulário do menu de animes
 * (`AUDIO_DUBBED`/`AUDIO_SUBBED`), para o menu reutilizar `availableAudioVersions`.
 *
 * @param {string} versao
 * @returns {string} faixa, ou "" quando a fonte não a distingue
 */
export function versaoParaFaixa(versao) {
  const v = String(versao || "").trim().toLowerCase();
  if (v.startsWith("dub")) return AUDIO_DUBBED;
  if (v.startsWith("leg") || v.startsWith("sub")) return AUDIO_SUBBED;
  return "";
}

/**
 * Temporadas e episódios de um título (interface do `megacine.getSeasons`).
 *
 * Agrupa os episódios por temporada. Cada episódio guarda as FAIXAS que publica
 * (`versions`) e o URL de cada uma (`urls`), para o menu poder oferecer
 * dublado/legendado e cair para a que existe. Filmes não entram (o catálogo de
 * séries é episódico), por isso `isFilme` é sempre falso.
 *
 * @param {string} slug token da pesquisa
 * @returns {Promise<{seasons: Array<{number:number, episodes:Array<{number:number, url:string, versions:string[], urls:Object}>}>, isFilme: boolean}>}
 */
export async function getSeasons(slug) {
  const ref = destoken(slug);
  if (!ref?.t) throw new SaimoError("Título inválido. Envia .menu para recomeçar.");

  const episodios = await acharEpisodios(ref);
  if (!episodios.length) return { seasons: [], isFilme: false };

  const porTemporada = new Map();
  for (const ep of episodios) {
    const temporada = ep.temporada || 1;
    if (!porTemporada.has(temporada)) porTemporada.set(temporada, new Map());

    const mapa = porTemporada.get(temporada);
    // O mesmo episódio pode vir em dub e leg: junta as DUAS faixas no mesmo
    // episódio, em vez de deitar uma fora.
    if (!mapa.has(ep.numero)) {
      mapa.set(ep.numero, { number: ep.numero, urls: {}, versions: [] });
    }

    const alvo = mapa.get(ep.numero);
    const faixa = versaoParaFaixa(ep.versao);
    const url = melhorUrl(ep.urls);

    if (faixa && url && !alvo.urls[faixa]) {
      alvo.urls[faixa] = url;
      alvo.versions.push(faixa);
    } else if (!faixa && url && !alvo.url) {
      // Episódio sem faixa declarada: guarda o URL para não ficar sem download.
      alvo.url = url;
    }
  }

  const seasons = [...porTemporada.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, mapa]) => ({
      number,
      episodes: [...mapa.values()]
        .map((ep) => ({ ...ep, url: ep.url || melhorUrl(Object.values(ep.urls)) }))
        .sort((a, b) => a.number - b.number),
    }));

  return { seasons, isFilme: false };
}

/**
 * URL do stream de um episódio (interface do `megacine.getEpisodeStream`).
 *
 * Com uma `faixa` pedida, serve essa; se o episódio não a tiver, serve a que
 * existe em vez de falhar. Sem faixa, serve o melhor URL disponível.
 *
 * @param {string} slug token do título
 * @param {number} [temporada]
 * @param {number} [episodio]
 * @param {string} [faixa] `AUDIO_DUBBED` / `AUDIO_SUBBED`
 * @returns {Promise<{url: string, tipo: string, referer: string, faixa: string}>}
 */
export async function getEpisodeStream(slug, temporada = 1, episodio = 1, faixa = "") {
  const ref = destoken(slug);
  if (!ref?.t) throw new SaimoError("Título inválido. Envia .menu para recomeçar.");

  const episodios = await acharEpisodios(ref);
  const ep = episodios.find(
    (e) => (e.temporada || 1) === Number(temporada) && e.numero === Number(episodio),
  );

  if (!ep) throw new SaimoError("Este episódio não está disponível na fonte.");

  const pedida = String(faixa || "").trim().toLowerCase();
  const candidatos = episodios.filter(
    (e) => (e.temporada || 1) === Number(temporada) && e.numero === Number(episodio),
  );

  let escolhido = null;
  let escolhidoUrls = [];
  let faixaServida = "";

  if (pedida) {
    const exato = candidatos.find((e) => versaoParaFaixa(e.versao) === pedida);
    if (exato) {
      escolhido = melhorUrl(exato.urls);
      escolhidoUrls = exato.urls;
      faixaServida = pedida;
    }
  }

  if (!escolhido) {
    const comFaixa = candidatos.find((e) => versaoParaFaixa(e.versao));
    if (comFaixa) {
      escolhido = melhorUrl(comFaixa.urls);
      escolhidoUrls = comFaixa.urls;
      faixaServida = versaoParaFaixa(comFaixa.versao);
    }
  }

  const url = escolhido || melhorUrl(ep.urls);
  if (!url) throw new SaimoError("A fonte não devolveu o vídeo deste episódio.");

  // Vários CDNs servem o mesmo episódio; se o preferido responder 404/503 o
  // menu tenta os seguintes em vez de dar o episódio por indisponível.
  const urlsPreferidas = escolhido ? escolhidoUrls : ep.urls;
  const outros = candidatos
    .filter((e) => e.urls !== urlsPreferidas)
    .flatMap((e) => candidatosUrl(e.urls));
  const listaCandidatos = [...candidatosUrl(urlsPreferidas), ...outros].filter(
    (u, i, l) => l.indexOf(u) === i,
  );

  return {
    url,
    candidatos: listaCandidatos.length ? listaCandidatos : [url],
    tipo: "series",
    referer: REFERER,
    faixa: faixaServida,
  };
}

/**
 * Faixas disponíveis de um filme, no vocabulário do menu
 * (`AUDIO_DUBBED`/`AUDIO_SUBBED`).
 *
 * @param {{dub?: string[], leg?: string[]}} filme
 * @returns {string[]}
 */
export function faixasDoFilme(filme) {
  const faixas = [];
  if (filme?.dub?.length) faixas.push(AUDIO_DUBBED);
  if (filme?.leg?.length) faixas.push(AUDIO_SUBBED);
  return faixas;
}

/**
 * Encontra a linha de um filme no ficheiro da letra.
 *
 * Sem `series-<L>` equivalente: o ficheiro `filmes-<L>.txt` já traz os filmes
 * todos da letra numa só página (medido: ~4,5k linhas), por isso não há índice
 * nem pedaços.
 *
 * @param {{l: string, t: string}} ref
 * @returns {Promise<object|null>}
 */
async function acharFilme(ref) {
  const alvo = normalizar(ref.t);
  const filmes = parseFilmes(await lerArquivo(`filmes-${letraArquivo(ref.l)}.txt`));

  return filmes.find((f) => normalizar(f.titulo) === alvo) || null;
}

/**
 * Faixas publicadas de um filme, para o menu perguntar antes de baixar.
 *
 * @param {string} slug token da pesquisa
 * @returns {Promise<{title: string, faixas: string[]}>}
 */
export async function getFilmeInfo(slug) {
  const ref = destoken(slug);
  if (!ref?.t) throw new SaimoError("Título inválido. Envia .menu para recomeçar.");

  const filme = await acharFilme(ref);
  if (!filme) throw new SaimoError("Este filme não está disponível na fonte.");

  return { title: filme.titulo, faixas: faixasDoFilme(filme) };
}

/**
 * URL do stream de um filme (interface do `getEpisodeStream`).
 *
 * Sem faixa pedida serve dublado quando existe (a faixa preferida do público
 * PT/BR); com faixa, serve a pedida e cai para a outra quando o filme só publica
 * uma, devolvendo a faixa REAL em `faixa` para o menu poder avisar.
 *
 * @param {string} slug token da pesquisa
 * @param {string} [faixa] `AUDIO_DUBBED` / `AUDIO_SUBBED`
 * @returns {Promise<{url: string, tipo: string, referer: string, faixa: string, title: string}>}
 */
export async function getFilmeStream(slug, faixa = "") {
  const ref = destoken(slug);
  if (!ref?.t) throw new SaimoError("Título inválido. Envia .menu para recomeçar.");

  const filme = await acharFilme(ref);
  if (!filme) throw new SaimoError("Este filme não está disponível na fonte.");

  const disponiveis = faixasDoFilme(filme);
  const pedida = String(faixa || "").trim().toLowerCase();

  // A ordem de preferência: a pedida (se existir) → dublado → legendado.
  const escolhida =
    (pedida && disponiveis.includes(pedida) ? pedida : "") ||
    (disponiveis.includes(AUDIO_DUBBED) ? AUDIO_DUBBED : "") ||
    disponiveis[0] ||
    "";

  const urls = escolhida === AUDIO_SUBBED ? filme.leg : filme.dub;
  const url = melhorUrl(urls);
  if (!url) throw new SaimoError("A fonte não devolveu o vídeo deste filme.");

  // A faixa pedida manda, mas se ela não responder o menu pode cair na outra.
  // Os candidatos das DUAS faixas ficam disponíveis, na ordem de preferência.
  const candidatos = [
    ...candidatosUrl(urls),
    ...candidatosUrl(escolhida === AUDIO_SUBBED ? filme.dub : filme.leg),
  ].filter((u, i, l) => l.indexOf(u) === i);

  return {
    url,
    candidatos,
    tipo: "filme",
    referer: REFERER,
    faixa: escolhida,
    title: filme.titulo,
  };
}

/**
 * Confirma que a fonte responde antes de cobrar créditos.
 *
 * @param {string} url
 * @param {string} [referer] o `Referer` que o CDN exige (por omissão o do site)
 * @returns {Promise<boolean>}
 */
export async function isPlaylistReachable(url, referer = REFERER) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref?.();

  try {
    const resposta = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": ANIME_USER_AGENT, referer, range: "bytes=0-0" },
    });
    return resposta.ok;
  } catch (error) {
    errorLog(`[saimo] verificação do stream falhou: ${error.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Devolve o primeiro candidato que responde, tentando por ordem. Um CDN pode
 * responder `404`/`503` isolado enquanto outro serve o mesmo filme, por isso a
 * falha do primeiro não deve condenar o título.
 *
 * @param {string[]} candidatos
 * @param {string} [referer]
 * @returns {Promise<string|null>}
 */
export async function primeiroAlcancavel(candidatos, referer = REFERER) {
  for (const url of candidatos || []) {
    if (await isPlaylistReachable(url, referer)) return url;
  }
  return null;
}

/**
 * Argumentos do yt-dlp. O CDN do Saimo responde sem Referer; o User-Agent de
 * browser é o que evita alguns 403.
 *
 * @returns {string[]}
 */
export function megacineDownloadArgs() {
  return ["--user-agent", ANIME_USER_AGENT];
}
