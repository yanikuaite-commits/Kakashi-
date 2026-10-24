import assert from "node:assert/strict";
import { test } from "node:test";
import {
  candidatosDeSlug,
  extrairFaixa,
  extrairReferenciaDoPlayer,
  extrairResultados,
  extrairTemporadas,
  slugBase,
} from "../services/meusanimes.js";

/**
 * Parsers do provider Meus Animes, testados com dados reais capturados do site.
 *
 * São puros (sem rede), por isso correm sempre: cobrem o que quebra na prática —
 * o HTML do WordPress na busca e na página do anime, o iframe da SPA do player e
 * a marca de áudio da página do episódio.
 */

// Trecho real de /?s=black+clover: dois <article>, cada um com link, título,
// capa e ano. O título é a única marca de áudio fiável na busca.
const BUSCA = `
<div class="result-item"><article><div class="image"><div class="thumbnail animation-2"> <a href="https://meusanimes.blog/a/black-clover-dublado/"> <img src="https://meusanimes.blog/wp-content/uploads/2025/04/yLZS-150x150.jpg" alt="Black Clover Dublado" /> <span class="tvshows"> TV </span> </a></div></div><div class="details"><div class="title"> <a href="https://meusanimes.blog/a/black-clover-dublado/">Black Clover Dublado</a></div><div class="meta"> <span class="year">2017</span></div><div class="contenido"><p>Assistir Black Clover Dublado, Num mundo onde magia é tudo...</p></div></div></article></div>
<div class="result-item"><article><div class="image"><div class="thumbnail animation-2"> <a href="https://meusanimes.blog/a/black-clover/"> <img src="https://meusanimes.blog/wp-content/uploads/2025/04/yLZS-150x150.jpg" alt="Black Clover" /> <span class="tvshows"> TV </span> </a></div></div><div class="details"><div class="title"> <a href="https://meusanimes.blog/a/black-clover/">Black Clover</a></div><div class="meta"> <span class="year">2017</span></div><div class="contenido"><p>Assistir Black Clover...</p></div></div></article></div>
`;

// Título com as entidades que o WordPress publica no HTML (o "–" do separador).
const BUSCA_ENTIDADES = `
<article><div class="details"><div class="title"> <a href="https://meusanimes.blog/a/demon-slayer/">Demon Slayer: Kimetsu no Yaiba &#8211; Hashira Geiko-hen Dublado</a></div></div></article>
`;

// Trecho real de /a/shingeki-no-kyojin/: um <div class='se-c'> por temporada,
// com o título e a lista de episódios. O número sai do texto do link.
const TEMPORADAS = `
<div id='seasons'><div class='se-c'><div class='se-q'><span class='se-t se-o'>1</span><span class='title'>Temporada 1 <i></i></span></div><div class='se-a' style="display:block"><ul class='episodios'><li class='mark-1'><div class='imagen'><img src='https://x/a.jpg'></div><div class='numerando'>1 - 1</div><div class='episodiotitle'><a href='https://meusanimes.blog/e/attack-on-titan-1-episodio-1/'>Episódio 1</a> <span class='date'>Apr. 07, 2013</span></div></li><li class='mark-2'><div class='episodiotitle'><a href='https://meusanimes.blog/e/attack-on-titan-1-episodio-2/'>Episódio 2</a></div></li></ul></div></div><div class='se-c'><div class='se-q'><span class='se-t'>2</span><span class='title'>Temporada 2 <i></i></span></div><div class='se-a'><ul class='episodios'><li class='mark-1'><div class='episodiotitle'><a href='https://meusanimes.blog/e/attack-on-titan-2-episodio-1/'>Episódio 1</a></div></li></ul></div></div></div>
`;

// Iframe real da SPA do player: a tripla que a API precisa viaja aqui.
const EPISODIO = `<div id="option-2" class="play-box-iframe fixidtab"> <iframe src="https://serv01.meusdoramas.club/#/video/46260/1/1/" frameborder="0" scrolling="no" allowfullscreen> </iframe></div> <span class="qualidade"><i class='fas fa-arrow-alt-circle-right'></i> Dublado</span>`;

test("extrairResultados lê slug, título, capa e ano de cada <article>", () => {
  const resultados = extrairResultados(BUSCA);

  assert.equal(resultados.length, 2);
  assert.deepEqual(
    resultados.map((r) => r.slug),
    ["black-clover-dublado", "black-clover"],
  );
  assert.equal(resultados[0].title, "Black Clover Dublado");
  assert.match(resultados[0].image, /^https:\/\//);
  assert.equal(resultados[0].year, "2017");
});

test("extrairResultados desescapa as entidades do WordPress", () => {
  const [resultado] = extrairResultados(BUSCA_ENTIDADES);

  assert.equal(
    resultado.title,
    "Demon Slayer: Kimetsu no Yaiba – Hashira Geiko-hen Dublado",
    "sem desescapar, o título sai com &#8211; e não corresponde ao termo",
  );
});

test("extrairResultados não repete o mesmo slug", () => {
  assert.equal(extrairResultados(BUSCA + BUSCA).length, 2);
});

test("extrairResultados devolve vazio sem resultados", () => {
  assert.deepEqual(extrairResultados("<html><body>nada</body></html>"), []);
  assert.deepEqual(extrairResultados(""), []);
});

test("extrairTemporadas separa as temporadas e numera os episódios", () => {
  const temporadas = extrairTemporadas(TEMPORADAS);

  assert.equal(temporadas.length, 2);
  assert.equal(temporadas[0].title, "Temporada 1");
  assert.deepEqual(
    temporadas[0].episodes.map((ep) => ep.number),
    [1, 2],
  );
  assert.deepEqual(
    temporadas[1].episodes.map((ep) => ep.slug),
    ["attack-on-titan-2-episodio-1"],
  );
});

test("extrairTemporadas devolve vazio quando a página não tem o bloco", () => {
  assert.deepEqual(extrairTemporadas("<html></html>"), []);
});

test("extrairReferenciaDoPlayer lê tmdb, temporada e episódio do iframe", () => {
  assert.deepEqual(extrairReferenciaDoPlayer(EPISODIO), {
    tmdb: "46260",
    season: "1",
    episode: "1",
  });
});

test("extrairReferenciaDoPlayer devolve null sem iframe do player", () => {
  assert.equal(extrairReferenciaDoPlayer("<html></html>"), null);
});

// A página do episódio marca o áudio REAL; o slug pode mentir (o
// `naruto-shippuden` serve dublado sem o sufixo `-dublado`).
test("extrairFaixa lê o áudio marcado na página do episódio", () => {
  assert.equal(extrairFaixa(EPISODIO), "dubbed");
  assert.equal(
    extrairFaixa(`<span class='qualidade'><i class='x'></i> Legendado</span>`),
    "subbed",
  );
});

test("extrairFaixa devolve null quando a página não marca o áudio", () => {
  assert.equal(extrairFaixa("<div>nada</div>"), null);
  assert.equal(extrairFaixa(""), null);
});

test("slugBase remove o sufixo de faixa que o site acrescenta", () => {
  assert.equal(slugBase("black-clover-dublado"), "black-clover");
  assert.equal(slugBase("black-clover-legendado"), "black-clover");
  assert.equal(slugBase("black-clover"), "black-clover");
});

test("candidatosDeSlug põe a entrada da faixa pedida à frente", () => {
  assert.deepEqual(candidatosDeSlug("black-clover", "dubbed"), [
    "black-clover-dublado",
    "black-clover",
  ]);
  assert.deepEqual(candidatosDeSlug("black-clover", "subbed"), [
    "black-clover",
    "black-clover-dublado",
  ]);
});

test("candidatosDeSlug não repete a base quando o slug já traz o sufixo", () => {
  assert.deepEqual(candidatosDeSlug("black-clover-dublado", "subbed"), [
    "black-clover",
    "black-clover-dublado",
  ]);
});
