import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chaveDaSerie,
  numeroDoEpisodio,
  parseVideoHls,
  versaoDoTitulo,
} from "../services/anitube.js";
import {
  extrairDegraus,
  extrairIframes,
  extrairTokenBlogger,
} from "../services/bloggerVideo.js";

/**
 * Parsers do provider AniTube, testados com HTML real capturado do site.
 *
 * São puros (sem rede), por isso correm sempre: cobrem o que quebra na prática —
 * o formato exato das páginas — sem depender de um site de terceiros estar no ar.
 *
 * O site serve o vídeo em dois formatos e ambos são cobertos: o HLS antigo
 * (`videohls.php`) e a cadeia do Blogger, que substituiu o HLS nos episódios
 * recentes e foi durante meses a causa de "Nenhum link de streaming encontrado".
 */

// Trecho real de /video/1006315/: o player é um iframe do anivideo e o parâmetro
// `d` já é o m3u8 do CDN.
const HTML_VIDEO = `
<iframe class="metaframe rptss no-lazy" src="https://api.anivideo.net/videohls.php?d=https://cdn-sv01.maximaimg.online/stream/n/naruto-shippuden-dublado/500.mp4/index.m3u8&nocache1792754713" frameborder="0" scrolling="no" allowfullscreen width="100%" height="100%"></iframe>
`;

// Trecho real de /video/942268/ (formato novo): o iframe aponta para o
// intermediário e já não há m3u8 nenhum na página.
const HTML_BLOGGER_NOVO = `
<iframe class="metaframe rptss no-lazy" src="https://www.anitube.zip/nUE0pUZ6Yl9lMJWipz5jn20hLzkiM3Ajo3DhL29gYmVjZwZiZQRiozSl" frameborder="0" scrolling="no" allowfullscreen width="100%" height="100%"></iframe>
`;

// Trecho real do intermediário api.anivideo.net/file/<token>.
const HTML_ANIVIDEO = `
<script>var player = {"token":"AD6v5dwO7kHINTehes2Q54Wh8Urmy1Xeou0tYvye","url":"https:\\/\\/www.blogger.com\\/video.g?token=AD6v5dwO7kHINTehes2Q54Wh8Urmy1Xeou0tYvye"};</script>
`;

// Trecho real de blogger.com/video.g: os dois degraus no mesmo HTML.
const HTML_BLOGGER = `
<script>var x=[[[&quot;https://rr2---sn-aigzrnse.googlevideo.com/videoplayback?expire\\u003d1792808112\\u0026itag\\u003d18\\u0026source\\u003dblogger&quot;]],[[&quot;https://rr2---sn-aigzrnse.googlevideo.com/videoplayback?expire\\u003d1792808112\\u0026itag\\u003d22\\u0026source\\u003dblogger&quot;]]]</script>
`;

test("parseVideoHls extrai o m3u8 do parâmetro `d`, não o URL do player", () => {
  const video = parseVideoHls(HTML_VIDEO);

  assert.equal(
    video.url,
    "https://cdn-sv01.maximaimg.online/stream/n/naruto-shippuden-dublado/500.mp4/index.m3u8",
    "o URL a descarregar é o do CDN; o do player devolve HTML e o yt-dlp falha",
  );
  assert.equal(video.isM3U8, true);
});

test("parseVideoHls aceita um m3u8 solto no HTML", () => {
  const video = parseVideoHls(
    `<video><source src="https://cdn.exemplo.online/a/b/index.m3u8"></video>`,
  );

  assert.equal(video.url, "https://cdn.exemplo.online/a/b/index.m3u8");
});

test("parseVideoHls devolve null sem m3u8", () => {
  assert.equal(parseVideoHls("<html><body>nada</body></html>"), null);
  assert.equal(parseVideoHls(""), null);
  assert.equal(parseVideoHls(null), null);
});

test("parseVideoHls devolve null na página do formato novo", () => {
  assert.equal(
    parseVideoHls(HTML_BLOGGER_NOVO),
    null,
    "sem m3u8 a extração tem de seguir pela cadeia do Blogger",
  );
});

test("extrairIframes lê o src do iframe e absolutiza o relativo", () => {
  assert.deepEqual(extrairIframes(HTML_BLOGGER_NOVO), [
    "https://www.anitube.zip/nUE0pUZ6Yl9lMJWipz5jn20hLzkiM3Ajo3DhL29gYmVjZwZiZQRiozSl",
  ]);
  assert.deepEqual(
    extrairIframes(`<iframe src="/file/abc"></iframe>`, "https://api.anivideo.net"),
    ["https://api.anivideo.net/file/abc"],
  );
  assert.deepEqual(extrairIframes(`<iframe src="//cdn.exemplo.net/x"></iframe>`), [
    "https://cdn.exemplo.net/x",
  ]);
  assert.deepEqual(extrairIframes("<p>sem iframe</p>"), []);
});

test("extrairTokenBlogger lê o token, mesmo escapado", () => {
  assert.equal(
    extrairTokenBlogger(HTML_ANIVIDEO),
    "AD6v5dwO7kHINTehes2Q54Wh8Urmy1Xeou0tYvye",
  );
  assert.equal(
    extrairTokenBlogger("https://www.blogger.com/video.g?token=abc&amp;x=1"),
    "abc",
    "o token não pode engolir a entidade HTML seguinte",
  );
  assert.equal(extrairTokenBlogger("<html>sem player</html>"), null);
});

test("extrairDegraus devolve o 360p e o 720p do Blogger", () => {
  const degraus = extrairDegraus(HTML_BLOGGER);

  assert.deepEqual(
    degraus.map((degrau) => degrau.quality),
    ["360p", "720p"],
    "o menu tem de oferecer os dois degraus, não decidir pelo utilizador",
  );
  assert.match(degraus[0].url, /itag=18/);
  assert.match(degraus[1].url, /itag=22/);
  assert.equal(
    degraus.every((degrau) => degrau.isM3U8 === false),
    true,
    "o Blogger serve MP4 direto, não HLS",
  );
  assert.doesNotMatch(degraus[0].url, /&quot;|\\u00/);
});

test("numeroDoEpisodio lê o número do título", () => {
  assert.equal(numeroDoEpisodio("Naruto Shippuden (Dublado) – Episódio 500"), 500);
  assert.equal(numeroDoEpisodio("Kaijuu 8-gou – Episódio 12"), 12);
  assert.equal(numeroDoEpisodio("Título sem número"), 0);
});

test("chaveDaSerie agrupa episódios do mesmo anime", () => {
  const a = chaveDaSerie("Naruto Shippuden (Dublado) – Episódio 500");
  const b = chaveDaSerie("Naruto Shippuden (Dublado) – Episódio 499");

  assert.equal(a, b, "episódios diferentes da mesma série têm a mesma chave");
  assert.equal(a, "naruto-shippuden-dublado");
});

test("chaveDaSerie distingue dublado de legendado", () => {
  assert.notEqual(
    chaveDaSerie("Naruto Shippuden (Dublado) – Episódio 1"),
    chaveDaSerie("Naruto Shippuden (Legendado) – Episódio 1"),
  );
});

test("versaoDoTitulo lê a faixa do título do post", () => {
  assert.equal(versaoDoTitulo("Naruto Shippuden (Dublado) – Episódio 500"), "dubbed");
  assert.equal(versaoDoTitulo("Naruto Shippuden Dublagem – Episódio 1"), "dubbed");
  assert.equal(versaoDoTitulo("Kaijuu 8-gou – Episódio 12"), "subbed");
  assert.equal(versaoDoTitulo("Naruto Shippuden (Legendado) – Episódio 1"), "subbed");
  // Um "Dubai" no título não pode passar por dublagem.
  assert.equal(versaoDoTitulo("Dubai no Anime – Episódio 3"), "subbed");
});
