import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chaveDaSerie,
  numeroDoEpisodio,
  parseVideo,
} from "../services/anitube.js";

/**
 * Parsers do provider AniTube, testados com HTML real capturado do site.
 *
 * São puros (sem rede), por isso correm sempre: cobrem o que quebra na prática —
 * o formato exato das páginas — sem depender de um site de terceiros estar no ar.
 */

// Trecho real de /video/1006315/: o player é um iframe do anivideo e o parâmetro
// `d` já é o m3u8 do CDN.
const HTML_VIDEO = `
<iframe class="metaframe rptss no-lazy" src="https://api.anivideo.net/videohls.php?d=https://cdn-sv01.maximaimg.online/stream/n/naruto-shippuden-dublado/500.mp4/index.m3u8&nocache1792754713" frameborder="0" scrolling="no" allowfullscreen width="100%" height="100%"></iframe>
`;

test("parseVideo extrai o m3u8 do parâmetro `d`, não o URL do player", () => {
  const video = parseVideo(HTML_VIDEO);

  assert.equal(
    video.url,
    "https://cdn-sv01.maximaimg.online/stream/n/naruto-shippuden-dublado/500.mp4/index.m3u8",
    "o URL a descarregar é o do CDN; o do player devolve HTML e o yt-dlp falha",
  );
  assert.equal(video.isM3U8, true);
});

test("parseVideo aceita um m3u8 solto no HTML", () => {
  const video = parseVideo(
    `<video><source src="https://cdn.exemplo.online/a/b/index.m3u8"></video>`,
  );

  assert.equal(video.url, "https://cdn.exemplo.online/a/b/index.m3u8");
});

test("parseVideo devolve null sem m3u8", () => {
  assert.equal(parseVideo("<html><body>nada</body></html>"), null);
  assert.equal(parseVideo(""), null);
  assert.equal(parseVideo(null), null);
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
