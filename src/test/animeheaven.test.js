import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseEpisodes,
  parseSearch,
  parseSources,
} from "../services/animeheaven.js";

/**
 * Parsers do provider AnimeHeaven, testados com HTML real capturado do site.
 *
 * São puros (sem rede), por isso correm sempre: cobrem o que quebra na prática
 * — o formato exato das páginas — sem depender de um site de terceiros estar no
 * ar. Os testes de integração ficam no fim, atrás de `ANIME_TEST_NETWORK=1`.
 */

// Trecho real de /search.php?s=naruto
const HTML_PESQUISA = `
<a href='anime.php?t2py4' class='c'>Boruto: Naruto Next Generations</a>
<a href='anime.php?ukr6y' class='c'>Naruto</a>
<a href='anime.php?ukr6y' class='c'>Naruto</a>
<a href='anime.php?nc7bk' class='c'>Naruto Shippuden</a>
`;

// Trecho real de /anime.php?ukr6y (episódios 220, 219, ...)
const HTML_EPISODIOS = `
<div class='boldtext'> <div class='linetitle2 c2'><a class='c' id ="9afa9f35e6d3e9a8ace536a14ac2a266" onclick='gatea( "9afa9f35e6d3e9a8ace536a14ac2a266")' onmouseover='gateh( "9afa9f35e6d3e9a8ace536a14ac2a266")'    href= 'gate.php'
><div class='trackep0 watch bc2'><div class='trackep watchb bc'><div class='watch1 bc c'>Episode</div><div  class= ' watch2 bc '  >220</div><div class='watch1 bc c'>1222 d ago</div></div></div></a><a class='c' id ="f84dbf53ccbb425e1cfb8ed715bd2288" onclick='gatea( "f84dbf53ccbb425e1cfb8ed715bd2288")'    href= 'gate.php'
><div class='trackep0 watch bc2'><div class='trackep watchb bc'><div class='watch1 bc c'>Episode</div><div  class= ' watch2 bc '  >219</div><div class='watch1 bc c'>1222 d ago</div></div></div></a>
`;

// Trecho real de /gate.php (mirror ax = trailer de 88 KB; rx = episódio)
const HTML_GATE = `
<video id='vid' class='videodiv' controls autoplay playsinline crossOrigin='anonymous' onerror="xhr4()">
<source src='https://ax.animeheaven.me/video.mp4?2c523c8cd9cc129bd13fc7407fa81220&eed805517af9a226eed805517af9a226' type='video/mp4' onerror="xhr()">
<source src='https://rx.animeheaven.me/video.mp4?9afa9f35e6d3e9a8ace536a14ac2a266&87b5c9fdee99cbd0357bb69bab1c4f31' type='video/mp4' onerror="xhr()" onstalled="xhr3()">
<source src='https://ct.animeheaven.me/video.mp4?9afa9f35e6d3e9a8ace536a14ac2a266&87b5c9fdee99cbd0357bb69bab1c4f31&error' type='video/mp4' onerror="xhr()">
<source src='https://ck.animeheaven.me/video.mp4?9afa9f35e6d3e9a8ace536a14ac2a266&87b5c9fdee99cbd0357bb69bab1c4f31&error2' type='video/mp4' onerror="xhr2()">
</video>
`;

test("parseSearch extrai id e título, sem duplicados", () => {
  const resultados = parseSearch(HTML_PESQUISA);

  assert.deepEqual(
    resultados.map((r) => r.id),
    ["t2py4", "ukr6y", "nc7bk"],
    "o id repetido (ukr6y) deve aparecer uma só vez",
  );
  assert.equal(resultados[1].title, "Naruto");
});

test("parseSearch devolve [] sem resultados", () => {
  assert.deepEqual(parseSearch("<div>No results found</div>"), []);
  assert.deepEqual(parseSearch(""), []);
  assert.deepEqual(parseSearch(null), []);
});

test("parseEpisodes extrai hash e número, ordenados", () => {
  const episodios = parseEpisodes(HTML_EPISODIOS);

  assert.deepEqual(
    episodios.map((e) => e.number),
    [219, 220],
    "os episódios devem vir em ordem crescente",
  );
  assert.equal(episodios[1].hash, "9afa9f35e6d3e9a8ace536a14ac2a266");
});

test("parseEpisodes ignora blocos sem número", () => {
  const html = `<a id="9afa9f35e6d3e9a8ace536a14ac2a266" href='gate.php'>sem numero</a>`;

  assert.deepEqual(parseEpisodes(html), []);
});

test("parseSources extrai todos os mirrors com o host", () => {
  const fontes = parseSources(HTML_GATE);

  assert.deepEqual(
    fontes.map((f) => f.host),
    ["ax", "rx", "ct", "ck"],
    "cada <source> deve dar um mirror",
  );
  assert.match(fontes[1].url, /^https:\/\/rx\.animeheaven\.me\/video\.mp4\?/);
});

test("parseSources devolve [] sem <source>", () => {
  assert.deepEqual(parseSources("<video></video>"), []);
  assert.deepEqual(parseSources(null), []);
});

test("o trailer (ax) não é escolhido como episódio", async () => {
  const { escolherMirror } = await import("../services/animeheaven.js");
  const fontes = parseSources(HTML_GATE);

  // Simula o tamanho real: ax = 88566 B (trailer), rx = 117791824 B (episódio).
  const tamanhos = {
    ax: 88566,
    rx: 117791824,
    ct: 0,
    ck: 0,
  };
  const original = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const host = String(url).match(/https:\/\/([^.]+)\./)?.[1];
    const tamanho = tamanhos[host] ?? 0;

    return {
      ok: tamanho > 0,
      headers: new Headers({ "content-length": String(tamanho) }),
    };
  };

  try {
    const escolhido = await escolherMirror(fontes, "https://animeheaven.me/gate.php");

    assert.match(
      escolhido,
      /rx\.animeheaven\.me/,
      "deve escolher o mirror com o episódio, não o trailer",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("escolherMirror devolve null quando só há mirrors maus", async () => {
  const { escolherMirror } = await import("../services/animeheaven.js");
  const original = globalThis.fetch;
  let pedidos = 0;

  globalThis.fetch = async () => {
    pedidos += 1;
    return {
      ok: true,
      headers: new Headers({ "content-length": "88566" }),
    };
  };

  try {
    // O HTML real só traz ax/ct/ck/rx; ao tirar o rx ficam apenas os ignorados.
    const fontes = parseSources(HTML_GATE).filter((f) => f.host !== "rx");
    const escolhido = await escolherMirror(fontes, "https://x/");

    assert.equal(escolhido, null, "nenhum mirror serve o episódio");
    assert.equal(
      pedidos,
      0,
      "os mirrors maus (ax/ct/ck) devem ser descartados sem pedido de rede",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("escolherMirror ignora mirrors maus antes de pedir", async () => {
  const { escolherMirror } = await import("../services/animeheaven.js");
  const original = globalThis.fetch;
  const pedidos = [];

  globalThis.fetch = async (url) => {
    pedidos.push(String(url).match(/https:\/\/([^.]+)\./)?.[1]);
    return {
      ok: true,
      headers: new Headers({ "content-length": "117791824" }),
    };
  };

  try {
    const escolhido = await escolherMirror(parseSources(HTML_GATE), "https://x/");

    assert.match(escolhido, /rx\.animeheaven\.me/);
    assert.deepEqual(
      pedidos,
      ["rx"],
      "não deve gastar um HEAD nos mirrors ax/ct/ck",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("o provider animeheaven está registado e devolve MP4, não HLS", async () => {
  const { getEpisodeSources } = await import("../services/anime.js");
  const original = globalThis.fetch;

  // Responde como o site: pesquisa → episódio → gate.php com os mirrors reais.
  globalThis.fetch = async (url, opcoes = {}) => {
    const texto = String(url);
    const host = texto.match(/https:\/\/([^.]+)\./)?.[1];

    // O HEAD aos mirrors é que decide qual serve o episódio: `ax` é trailer.
    if (opcoes.method === "HEAD" || host === "ax" || host === "rx") {
      const tamanho = host === "ax" ? 88566 : 117791824;

      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(tamanho) }),
      };
    }

    const corpo = texto.includes("search.php")
      ? HTML_PESQUISA
      : texto.includes("anime.php")
        ? HTML_EPISODIOS
        : HTML_GATE;

    return { ok: true, status: 200, text: async () => corpo };
  };

  try {
    // `animeheaven` sozinho garante que o resultado vem deste provider.
    const sources = await getEpisodeSources(
      "ukr6y::9afa9f35e6d3e9a8ace536a14ac2a266::9afa9f35e6d3e9a8ace536a14ac2a266",
      "animeheaven",
    );

    assert.equal(sources.length, 1, "deve devolver uma fonte");
    assert.match(sources[0].url, /animeheaven\.me\/video\.mp4\?/);
    assert.equal(
      sources[0].isM3U8,
      false,
      "o AnimeHeaven serve MP4 direto; marcar como HLS faz o rótulo de qualidade sair errado",
    );
    assert.equal(sources[0].label, "720p");
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * Integração real com o site. Só corre com `ANIME_TEST_NETWORK=1`: bate num
 * site de terceiros, instável por natureza, e não deve bloquear o CI.
 */
const comRede = process.env.ANIME_TEST_NETWORK === "1";

test("integração: pesquisa → episódios → MP4 direto", { skip: !comRede }, async () => {
  const { search, episodes, sources } = await import("../services/animeheaven.js");
  const resultados = await search("naruto");

  assert.ok(resultados.length > 0, "a pesquisa deve devolver resultados");

  const lista = await episodes(resultados[0].id, resultados[0].slug);
  assert.ok(lista.length > 0, "o anime deve ter episódios");

  const fonte = await sources(lista[0], resultados[0].slug);

  assert.match(fonte.url, /^https:\/\/[a-z]+\.animeheaven\.me\/video\.mp4\?/);
  assert.equal(fonte.isM3U8, false, "o animeheaven serve MP4 direto, não HLS");
});
