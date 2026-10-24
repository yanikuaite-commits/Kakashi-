/**
 * Leitura do player "Google Blogger" (`blogger.com/video.g`), partilhada por
 * vários providers PT-BR.
 *
 * PORQUÊ: o animesonlinehd e o anitube servem o episódio pelo mesmo player, e o
 * anitube migrou do HLS antigo para ele. O `playerUrl` é um link do Blogger cuja
 * página traz o `videoplayback` do Google Video no HTML. O extractor `blogger`
 * do yt-dlp falha neste formato ("Unable to extract JSON data"), por isso o URL
 * é lido aqui e o yt-dlp recebe o googlevideo direto. Esse CDN exige `Referer`
 * do Blogger E um User-Agent de browser: sem o User-Agent responde 403 mesmo
 * com o Referer certo.
 *
 * Estas funções são puras (sem rede) para poderem ser testadas com HTML real
 * capturado dos sites.
 *
 * @author Dev Gui
 */

/** Degraus do Blogger: 18 = 360p, 22 = 720p. */
export const DEGRAUS_BLOGGER = [
  { itag: "18", quality: "360p" },
  { itag: "22", quality: "720p" },
];

/**
 * Extrai os `src` dos iframes da página do episódio, já absolutos.
 *
 * A página do player é um iframe que aponta para o intermediário do site
 * (`api.anivideo.net`), cujo HTML traz o token do Blogger. Devolvem-se TODOS os
 * iframes porque a ordem não é garantida entre sites: quem consome tenta cada um
 * até um render o token, em vez de confiar no primeiro.
 *
 * @param {string} html
 * @param {string} [base] URL do site, para resolver `src` relativo
 * @returns {string[]}
 */
export function extrairIframes(html, base = "") {
  const conteudo = String(html ?? "");

  const srcs = [
    ...conteudo.matchAll(/<iframe[^>]*\bsrc=["']([^"']+)["']/gi),
  ].map(([, src]) => src.trim()).filter(Boolean);

  return [...new Set(srcs)].map((src) => {
    if (/^https?:\/\//i.test(src)) return src;
    if (src.startsWith("//")) return `https:${src}`;
    if (src.startsWith("/")) return base ? `${base.replace(/\/+$/, "")}${src}` : src;
    return base ? `${base.replace(/\/+$/, "")}/${src}` : src;
  });
}

/**
 * Extrai o token do player do Blogger a partir do HTML que o contém.
 *
 * O token vem como parâmetro `token` do URL `blogger.com/video.g`, que pode
 * aparecer escapado (`\u003d`, `&amp;`) conforme o site o injete.
 *
 * @param {string} html
 * @returns {string|null}
 */
export function extrairTokenBlogger(html) {
  const conteudo = String(html ?? "")
    .replace(/&amp;/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/");

  return (
    conteudo.match(/blogger\.com\/video\.g\?token=([^"&'\s\\]+)/i)?.[1] || null
  );
}

/**
 * Extrai o URL do `videoplayback` do Google Video a partir da página do Blogger.
 *
 * Puro (sem rede). O URL vem com as entidades HTML e os escapes do JSON
 * (`&quot;`, `\u003d`, `\u0026`, `\/`), pelo que é preciso desescapá-lo antes de
 * o ler. O itag é escolhido explicitamente; sem ele vale o 360p.
 *
 * @param {string} html
 * @param {string} [itag]
 * @returns {string|null}
 */
export function parseVideoUrl(html, itag = DEGRAUS_BLOGGER[0].itag) {
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
 * Todos os degraus publicados na página do Blogger, prontos para o menu.
 *
 * Puro (sem rede). A página traz o 360p e o 720p no mesmo HTML; devolver os dois
 * deixa o utilizador escolher em vez de o provider decidir. A ordem é a de
 * `degraus` (360p primeiro, que é o que cabe no teto sem esperar).
 *
 * @param {string} html
 * @param {Array<{itag: string, quality: string}>} [degraus]
 * @returns {Array<{url: string, quality: string, isM3U8: boolean}>}
 */
export function extrairDegraus(html, degraus = DEGRAUS_BLOGGER) {
  return degraus
    .map(({ itag, quality }) => ({
      url: parseVideoUrl(html, itag),
      quality,
      isM3U8: false,
    }))
    .filter((degrau) => Boolean(degrau.url));
}
