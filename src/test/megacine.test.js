/**
 * Parsers do provider Megacine, testados com HTML real capturado do site.
 *
 * São puros (sem rede), por isso correm sempre: cobrem o que quebra na prática
 * — o formato exato das páginas — sem depender de um site de terceiros estar no
 * ar. Os testes de integração ficam no fim, atrás de `MEGACINE_TEST_NETWORK=1`.
 *
 * @author Dev Gui
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStreamPath,
  decodeEntities,
  getEpisodeStream,
  getSeasons,
  isFilme,
  megacineDownloadArgs,
  parsePlayerConfig,
  parseSearch,
  parseSeasons,
  search,
  tipoDoMeta,
} from "../services/megacine.js";

// Trecho real de /search/?q=the%20boys (dois cards, um deles legendado).
const HTML_BUSCA = `
<section class="container"><div class="card-grid"><article class="card filtered-visible"><a href="https://www.megacine.online/series/the-boys-legendado" class="card-link" aria-label="Abrir The Boys (Legendado)"><div class="poster-wrapper"><img class="poster-img" src="https://cdn.megacine.online/imagens/76479_T1_tv_size.webp" alt="The Boys (Legendado)" width="298" height="448" loading="lazy"></div><div class="card-body"><h3 class="card-title">The Boys (Legendado)</h3><p class="card-meta">2026 • Ação</p></div></a></article><article class="card filtered-visible"><a href="https://www.megacine.online/series/the-boys" class="card-link" aria-label="Abrir The Boys"><div class="poster-wrapper"><img class="poster-img" src="https://cdn.megacine.online/imagens/76479_T1_tv_size.webp" alt="The Boys" width="298" height="448" loading="lazy"></div><div class="card-body"><h3 class="card-title">The Boys</h3><p class="card-meta">2026 • Ação</p></div></a></article></div></section>
`;

// Trecho real de /series/the-boys: as MESMAS temporadas aparecem em três
// representações (modern, season-content e season-grid). O trecho reproduz essa
// repetição — é o caso que produzia 88 episódios numa temporada de 8.
const HTML_DETALHE = `
<div class="episodes-modern-list-container"><div class="episodes-modern-list episodes-modern-season-content active" data-season="1" id="modernSeason1">
<div class="episodes-modern-item" data-episode-num="01" data-episode-title="episódio 01"><a href="https://www.megacine.online/series/the-boys/temporada-01/episodio-01"></a></div>
<div class="episodes-modern-item" data-episode-num="02" data-episode-title="episódio 02"><a href="https://www.megacine.online/series/the-boys/temporada-01/episodio-02"></a></div>
</div><div class="episodes-modern-list episodes-modern-season-content " data-season="2" id="modernSeason2">
<div class="episodes-modern-item" data-episode-num="01"><a href="https://www.megacine.online/series/the-boys/temporada-02/episodio-01"></a></div>
<div class="episodes-modern-item" data-episode-num="02"><a href="https://www.megacine.online/series/the-boys/temporada-02/episodio-02"></a></div>
</div></div>
<div class="season-content active" data-season="1"><article class="card"><a href="https://www.megacine.online/series/the-boys/temporada-01/episodio-01"></a><a href="https://www.megacine.online/series/the-boys/temporada-01/episodio-02"></a></article></div>
<div class="season-content " data-season="2"><article class="card"><a href="https://www.megacine.online/series/the-boys/temporada-02/episodio-01"></a><a href="https://www.megacine.online/series/the-boys/temporada-02/episodio-02"></a></article></div>
<div class="season-grid-content" data-season="1" style=""><a href="https://www.megacine.online/series/the-boys/temporada-01/episodio-01"></a><a href="https://www.megacine.online/series/the-boys/temporada-01/episodio-02"></a></div>
<div class="season-grid-content" data-season="2" style="display: none;"><a href="https://www.megacine.online/series/the-boys/temporada-02/episodio-01"></a><a href="https://www.megacine.online/series/the-boys/temporada-02/episodio-02"></a></div>
`;

// Trecho real de /series/the-boys/temporada-02/episodio-03.
const HTML_EPISODIO = `
<script>
    var urlConfig = {
            base: "https://forks-series.madfirebox.shop",
            slug: "the-boys",
            tipo: "series",
            temporada: 2,
            episodio: 3    };

    const PRIMARY_URL = "https://ondemand.madfirebox.shop";
    const FALLBACK_URL = "https://forks-series.madfirebox.shop";
</script>
`;

// Trecho real de /series/matrix-1-1999/temporada-01/episodio-01 (um filme).
const HTML_FILME = `
<script>
    var urlConfig = {
            base: "https://forks-filmes.madfirebox.shop",
            slug: "matrix-1-1999",
            tipo: "filmes",
            temporada: 1,
            episodio: 1    };
</script>
`;

test("parseSearch extrai slug, título, capa e ano", () => {
  const resultados = parseSearch(HTML_BUSCA);

  assert.equal(resultados.length, 2);
  assert.deepEqual(
    resultados.map((r) => r.slug),
    ["the-boys-legendado", "the-boys"],
    "dublado e legendado são entradas diferentes, ambas ficam",
  );
  assert.equal(resultados[1].title, "The Boys");
  assert.equal(resultados[0].year, "2026");
  assert.match(resultados[0].image, /^https:\/\/cdn\.megacine\.online\//);
});

test("parseSearch devolve [] sem resultados", () => {
  assert.deepEqual(parseSearch("<div>Nada encontrado</div>"), []);
  assert.deepEqual(parseSearch(""), []);
  assert.deepEqual(parseSearch(null), []);
});

test("parseSearch descarta o mesmo slug repetido", () => {
  const html = HTML_BUSCA + HTML_BUSCA;
  assert.equal(parseSearch(html).length, 2);
});

test("parseSeasons deduplica as três representações da página", () => {
  const temporadas = parseSeasons(HTML_DETALHE, "the-boys");

  assert.deepEqual(
    temporadas.map((t) => t.number),
    [1, 2],
  );
  assert.deepEqual(
    temporadas[0].episodes.map((e) => e.number),
    [1, 2],
    "cada episódio aparece uma só vez, apesar de estar em 3 blocos",
  );
});

test("parseSeasons não confunde títulos diferentes", () => {
  const temporadas = parseSeasons(HTML_DETALHE, "outra-serie");
  assert.deepEqual(temporadas, [], "o slug tem de bater certo");
});

test("parseSeasons devolve [] sem entrada", () => {
  assert.deepEqual(parseSeasons("", "the-boys"), []);
  assert.deepEqual(parseSeasons(HTML_DETALHE, ""), []);
});

test("parseSeasons aceita slug com carateres especiais", () => {
  const html = `<a href="https://www.megacine.online/series/a-b.c/temporada-01/episodio-01"></a>`;
  const temporadas = parseSeasons(html, "a-b.c");
  assert.equal(temporadas.length, 1, "o ponto não deve virar wildcard");
});

test("parsePlayerConfig lê base, tipo, temporada e episódio", () => {
  const config = parsePlayerConfig(HTML_EPISODIO);

  assert.deepEqual(config, {
    base: "https://forks-series.madfirebox.shop",
    slug: "the-boys",
    tipo: "series",
    temporada: 2,
    episodio: 3,
  });
});

test("parsePlayerConfig distingue um filme de uma série", () => {
  const config = parsePlayerConfig(HTML_FILME);
  assert.equal(config.tipo, "filmes");
  assert.equal(config.slug, "matrix-1-1999");
});

test("parsePlayerConfig devolve null sem urlConfig", () => {
  assert.equal(parsePlayerConfig("<html></html>"), null);
  assert.equal(parsePlayerConfig(""), null);
  assert.equal(parsePlayerConfig(null), null);
});

test("buildStreamPath usa temporada/episódio nas séries", () => {
  const caminho = buildStreamPath({
    slug: "the-boys",
    temporada: 2,
    episodio: 3,
  });

  assert.equal(caminho, "T/the-boys/02-temporada/03/stream.m3u8");
});

test("buildStreamPath preenche temporada e episódio com zero", () => {
  const caminho = buildStreamPath({
    slug: "naruto",
    temporada: 1,
    episodio: 9,
  });

  assert.equal(caminho, "N/naruto/01-temporada/09/stream.m3u8");
});

test("buildStreamPath capitaliza a primeira letra do slug", () => {
  assert.equal(
    buildStreamPath({ slug: "duna-a-profecia-dublado", temporada: 1, episodio: 1 }),
    "D/duna-a-profecia-dublado/01-temporada/01/stream.m3u8",
  );
});

test("tipoDoMeta lê o tipo do card-meta da busca", () => {
  assert.equal(tipoDoMeta("2026 • Filmes"), "filmes");
  assert.equal(tipoDoMeta("2026 • Ação"), "ação");
  assert.equal(tipoDoMeta("1999 • Filmes"), "filmes");
  assert.equal(tipoDoMeta(""), "");
  assert.equal(tipoDoMeta("2026"), "");
});

test("isFilme distingue pelo botão que a página declara", () => {
  // "Assistir Filme" (filme) vs "Assistir Agora" (série).
  const filme = `<a href="#" id="assistirplaybutton" class="play-btn"><i class="fas fa-play"></i> Assistir Filme</a>`;
  const serie = `<a href="#" id="assistirplaybutton" class="play-btn"><i class="fas fa-play"></i> Assistir Agora</a>`;

  assert.equal(isFilme(filme), true);
  assert.equal(isFilme(serie), false);
  assert.equal(isFilme(""), false);
  // Sem o botão não há prova de filme: não se recusa por dúvida.
  assert.equal(isFilme("<html>sem botao</html>"), false);
});

test("a pesquisa descarta filmes pelo card-meta", () => {
  const html = `
<article class="card"><a href="https://www.megacine.online/series/the-boys"><h3 class="card-title">The Boys</h3><p class="card-meta">2026 • Ação</p></a></article>
<article class="card"><a href="https://www.megacine.online/series/matrix-1-1999"><h3 class="card-title">Matrix</h3><p class="card-meta">1999 • Filmes</p></a></article>
<article class="card"><a href="https://www.megacine.online/series/meu-amor"><h3 class="card-title">Meu Amor</h3><p class="card-meta">2026 • Dorama</p></a></article>
<article class="card"><a href="https://www.megacine.online/series/naruto"><h3 class="card-title">Naruto</h3><p class="card-meta">2026 • Animes</p></a></article>`;

  const slugs = parseSearch(html).map((r) => r.slug);

  assert.deepEqual(slugs, ["the-boys", "meu-amor", "naruto"]);
  assert.ok(!slugs.includes("matrix-1-1999"), "o filme fica de fora");
});

test("o filtro de tipos é configurável", () => {
  const html = `<article class="card"><a href="https://www.megacine.online/series/meu-amor"><h3 class="card-title">Meu Amor</h3><p class="card-meta">2026 • Dorama</p></a></article>`;

  assert.equal(parseSearch(html).length, 1);
  assert.equal(parseSearch(html, { tiposExcluidos: ["dorama"] }).length, 0);
  assert.equal(parseSearch(html, { tiposExcluidos: [] }).length, 1);
});

test("um resultado sem card-meta não é descartado por engano", () => {
  // Sem meta não há tipo para filtrar; recusar aqui esconderia títulos válidos.
  const html = `<article class="card"><a href="https://www.megacine.online/series/sem-meta"><h3 class="card-title">Sem Meta</h3></a></article>`;

  const resultados = parseSearch(html);
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].tipo, "");
});

test("decodeEntities limpa as entidades usadas nos títulos", () => {
  assert.equal(decodeEntities("Aladdin &amp; os 40 Ladrões"), "Aladdin & os 40 Ladrões");
  assert.equal(decodeEntities("&#039;Teste&#039;"), "'Teste'");
  assert.equal(decodeEntities(""), "");
});

test("megacineDownloadArgs leva o Referer do site", () => {
  const args = megacineDownloadArgs("https://www.megacine.online/");
  assert.ok(args.includes("--referer"));
  assert.ok(args.includes("--user-agent"));
  assert.ok(args.includes("https://www.megacine.online/"));
});

// ── Integração (rede) ───────────────────────────────────────────────────────
// Só corre com MEGACINE_TEST_NETWORK=1: depende de um site de terceiros estar no
// ar, por isso não pode fazer parte da suite normal.
test(
  "integração: pesquisa e resolve o stream de um episódio",
  { skip: process.env.MEGACINE_TEST_NETWORK !== "1" },
  async () => {
    const resultados = await search("the boys");
    assert.ok(resultados.length > 0, "a pesquisa deve devolver resultados");
    assert.ok(
      resultados.every((r) => r.tipo !== "filmes"),
      "a pesquisa não deve devolver filmes",
    );

    const { seasons, isFilme: filme } = await getSeasons(resultados[0].slug);
    assert.equal(filme, false, "uma série não é um filme");
    assert.ok(seasons.length > 0, "deve haver temporadas");

    const primeira = seasons[0];
    const stream = await getEpisodeStream(
      resultados[0].slug,
      primeira.number,
      primeira.episodes[0].number,
    );

    assert.match(stream.url, /\.m3u8$/);
    assert.match(stream.url, /forks-/);
  },
);
