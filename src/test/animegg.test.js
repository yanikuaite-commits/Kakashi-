import assert from "node:assert/strict";
import { test } from "node:test";
import {
  escolherEmbed,
  ordenarPorPreferencia,
  parseEpisodes,
  parseEpisodeVersions,
  parseSearch,
  parseVideoSources,
} from "../services/animegg.js";

/**
 * Parsers do provider AnimeGG, testados com HTML real capturado do site.
 *
 * São puros (sem rede), por isso correm sempre: cobrem o que quebra na prática —
 * o formato exato das páginas — sem depender de um site de terceiros estar no ar.
 */

// Trecho real de /search/?q=kaijuu+girls
const HTML_PESQUISA = `
<div class="media searchre">
  <a href="/series/kaijuu-girls-ultra-kaijuu-gijinka-keikaku" class="mse">
    <img src="https://vidcache.net:8161/static/e6278fe44c7b55b22b9dfcfa231e7a9676c01293/jpeg" class="media-object">
    <div class="media-body"><div class="first"><h2>Kaijuu Girls: Ultra Kaijuu Gijinka Keikaku</h2></div></div>
  </a>
</div>
<div class="media searchre">
  <a href="/series/kaijuu-girls-ultra-kaijuu-gijinka-keikaku-2nd-season" class="mse">
    <img src="https://vidcache.net:8161/static/a0e31870eea4f5765ccc64d4304c39d032131628/jpeg" class="media-object">
    <div class="media-body"><div class="first"><h2>Kaijuu Girls: Ultra Kaijuu Gijinka Keikaku 2nd Season</h2></div></div>
  </a>
</div>
`;

// Trecho real de /series/<slug>: cada episódio é um <a> para /<slug>-episode-<n>
const HTML_SERIE = `
<a href="/kaijuu-girls-ultra-kaijuu-gijinka-keikaku-episode-1" class="anmep">1</a>
<a href="/kaijuu-girls-ultra-kaijuu-gijinka-keikaku-episode-2" class="anmep">2</a>
<a href="/kaijuu-girls-ultra-kaijuu-gijinka-keikaku-episode-12" class="anmep">12</a>
<a href="/kaijuu-girls-ultra-kaijuu-gijinka-keikaku-episode-1" class="anmep">1</a>
`;

// Trecho real de /embed/<id>: os degraus vêm no `var videoSources`
const HTML_EMBED = `
<script type="text/javascript">
  var videoSources = [{file: "/play/53160/video.mp4?for=101792753927807", label: "360p", bk: "", isBk: false },{file: "/play/213007/video.mp4?for=101792753927807", label: "480p", bk: "aHR0cHMlM0ElMkYlMkZtcDR1cGxvYWQ=", isBk: false },{file: "/play/196195/video.mp4?for=101792753927807", label: "720p", bk: "", isBk: false }];
  var isMobile = false;
</script>
`;

// O modo de falha conhecido (~1 em 8 episódios): lista vazia, sem fonte nenhuma.
const HTML_EMBED_VAZIO = `
<script type="text/javascript">
  var videoSources = [];       var httpProtocol = (('https:' == document.location.protocol) ? 'https:' : 'http:');
</script>
`;

test("parseSearch extrai slug, título e capa", () => {
  const resultados = parseSearch(HTML_PESQUISA);

  assert.equal(resultados.length, 2);
  assert.equal(resultados[0].slug, "kaijuu-girls-ultra-kaijuu-gijinka-keikaku");
  assert.equal(resultados[0].title, "Kaijuu Girls: Ultra Kaijuu Gijinka Keikaku");
  assert.match(resultados[0].image, /^https:\/\//);
  assert.equal(
    resultados[1].slug,
    "kaijuu-girls-ultra-kaijuu-gijinka-keikaku-2nd-season",
  );
});

test("parseSearch devolve [] sem resultados", () => {
  assert.deepEqual(parseSearch("<div>No results</div>"), []);
  assert.deepEqual(parseSearch(""), []);
  assert.deepEqual(parseSearch(null), []);
});

// Trecho real de /<slug>-episode-1: as duas abas, com o `subbed` PRIMEIRO.
const HTML_EPISODIO_DUAS_FAIXAS = `
<ul id="videos" class="nav nav-tabs">
  <li><a href="#subbed-Animegg" data-toggle="tab" data-id='27657' data-mirror="Animegg" data-version="subbed"><span class="btn-xs btn-subbed">SUBBED</span></a></li>
  <li><a href="#dubbed-Animegg" data-toggle="tab" data-id='27658' data-mirror="Animegg" data-version="dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a></li>
</ul>
<div class="tab-content">
  <div id="subbed-Animegg" class="tab-pane"><iframe src="/embed/27657" class="video"></iframe></div>
  <div id="dubbed-Animegg" class="tab-pane"><iframe src="/embed/27658" class="video"></iframe></div>
</div>
`;

// Trecho real de /<slug>-episode-1156: só dublado.
const HTML_EPISODIO_SO_DUB = `
<ul id="videos" class="nav nav-tabs">
  <li><a href="#dubbed-Animegg" data-toggle="tab" data-id='147620' data-mirror="Animegg" data-version="dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a></li>
</ul>
<div class="tab-content">
  <div id="dubbed-Animegg" class="tab-pane"><iframe src="/embed/147620" class="video"></iframe></div>
</div>
`;

// Trecho real de /series/<slug>: cada faixa é um link próprio com fragmento.
const HTML_SERIE_FAIXAS = `
<a href="/naruto-episode-220" class="anm_det_pop"><strong>Naruto 220</strong></a><a href="/naruto-episode-220#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a>
<a href="/one-piece-episode-1156" class="anm_det_pop"><strong>One Piece 1156</strong></a><a href="/one-piece-episode-1156#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>
<a href="/one-piece-episode-1" class="anm_det_pop"><strong>One Piece 1</strong></a><a href="/one-piece-episode-1#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a><a href="/one-piece-episode-1#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>
`;

test("escolherEmbed distingue dublado de legendado (o bug: era sempre o 1º)", () => {
  // O `subbed` vem primeiro no HTML; pedir dublado tem de dar o OUTRO embed.
  assert.equal(escolherEmbed(HTML_EPISODIO_DUAS_FAIXAS, "subbed"), "27657");
  assert.equal(escolherEmbed(HTML_EPISODIO_DUAS_FAIXAS, "dubbed"), "27658");

  // Só dublado: pedir legendado não pode devolver o embed do dublado.
  assert.equal(escolherEmbed(HTML_EPISODIO_SO_DUB, "dubbed"), "147620");
  assert.equal(escolherEmbed(HTML_EPISODIO_SO_DUB, "subbed"), null);
});

test("escolherEmbed sem faixa mantém o primeiro embed (compatibilidade)", () => {
  assert.equal(escolherEmbed(HTML_EPISODIO_DUAS_FAIXAS, ""), "27657");
  assert.equal(escolherEmbed(HTML_EPISODIO_SO_DUB, ""), "147620");
  assert.equal(escolherEmbed("<html></html>", "dubbed"), null);
});

test("escolherEmbed ignora faixas desconhecidas (não injeta no regex)", () => {
  // Um valor forjado não pode escapar da whitelist nem rebentar o regex.
  assert.equal(escolherEmbed(HTML_EPISODIO_DUAS_FAIXAS, 'x"|.*'), "27657");
  assert.equal(escolherEmbed(HTML_EPISODIO_DUAS_FAIXAS, "raw"), "27657");
  assert.equal(escolherEmbed(HTML_EPISODIO_SO_DUB, "SUBBED"), null);
});

test("parseEpisodeVersions lê as faixas de cada episódio", () => {
  const faixas = parseEpisodeVersions(HTML_SERIE_FAIXAS, "one-piece");

  assert.deepEqual(faixas.get(1), ["subbed", "dubbed"]);
  assert.deepEqual(faixas.get(1156), ["dubbed"]);
  // O 220 é de OUTRA série (naruto) e não pode aparecer na lista do one-piece.
  assert.equal(faixas.has(220), false);
  assert.deepEqual(parseEpisodeVersions("<html></html>", "one-piece").size, 0);
});

test("parseEpisodes extrai números, sem duplicados e ordenados", () => {
  assert.deepEqual(
    parseEpisodes(HTML_SERIE, "kaijuu-girls-ultra-kaijuu-gijinka-keikaku"),
    [1, 2, 12],
  );
});

test("parseEpisodes ignora episódios de outra série", () => {
  const html = `<a href="/outra-serie-episode-5">5</a>`;

  assert.deepEqual(parseEpisodes(html, "kaijuu-girls-ultra-kaijuu-gijinka-keikaku"), []);
});

test("parseVideoSources extrai ficheiro, rótulo e altura", () => {
  const fontes = parseVideoSources(HTML_EMBED);

  assert.deepEqual(
    fontes.map((f) => f.label),
    ["360p", "480p", "720p"],
  );
  assert.deepEqual(
    fontes.map((f) => f.height),
    [360, 480, 720],
  );
  assert.equal(fontes[1].file, "/play/213007/video.mp4?for=101792753927807");
});

test("parseVideoSources devolve [] no modo de falha (videoSources = [])", () => {
  assert.deepEqual(parseVideoSources(HTML_EMBED_VAZIO), []);
  assert.deepEqual(parseVideoSources("<html></html>"), []);
});

test("ordenarPorPreferencia põe o 480p à frente do 360p e do 720p", () => {
  const fontes = parseVideoSources(HTML_EMBED);
  const ordenadas = ordenarPorPreferencia(fontes, 480);

  assert.deepEqual(
    ordenadas.map((f) => f.label),
    ["480p", "360p", "720p"],
    "abaixo do preferido vem antes de acima (acima arrisca passar os 200 MB)",
  );
});

test("ordenarPorPreferencia usa 480p como preferido por padrão", () => {
  const fontes = parseVideoSources(HTML_EMBED);

  assert.equal(ordenarPorPreferencia(fontes)[0].label, "480p");
});
