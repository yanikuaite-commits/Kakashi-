/**
 * Testes do parsing do catálogo de SÉRIES do saimo.
 *
 * Os parsers são puros (recebem texto, devolvem objetos), por isso não é preciso
 * rede: prova-se o formato TAB do site, a escolha de URL e a pesquisa com
 * recurso por tokens. O fluxo do menu é coberto em `megacineMenu.test.js`.
 *
 * @author Dev Yanik
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import {
  destoken,
  filtrarPorTermo,
  getEpisodeStream,
  letraArquivo,
  limparCacheSaimo,
  melhorUrl,
  normalizar,
  parseBusca,
  parseFichas,
  parseSeriesBlocos,
  parseSeriesIndice,
  posterDoTitulo,
  token,
  versaoParaFaixa,
} from "../services/saimo.js";

test.afterEach(() => {
  mock.restoreAll();
  limparCacheSaimo();
});

test("normalizar tira acentos, pontuação e caixa", () => {
  assert.equal(normalizar("Duna: A Profecia"), "duna a profecia");
  assert.equal(normalizar("Ação & Reação"), "acao reacao");
});

test("letraArquivo escapa a letra '#'", () => {
  assert.equal(letraArquivo("#"), "%23");
  assert.equal(letraArquivo("T"), "T");
});

test("token e destoken são inversos", () => {
  const ref = { l: "T", t: "The Boys", a: "2019" };
  assert.deepEqual(destoken(token(ref)), ref);
});

test("destoken devolve null para lixo em vez de rebentar", () => {
  assert.equal(destoken("!!!não-é-base64!!!"), null);
  assert.equal(destoken(""), null);
});

test("melhorUrl prefere o mp4 direto e, em HLS, o master", () => {
  assert.equal(
    melhorUrl(["https://x/proxy", "http://x/video.mp4"]),
    "http://x/video.mp4",
  );
  assert.equal(
    melhorUrl(["https://x/outro", "https://x/cdn/hls/abc/master.txt"], { hls: true }),
    "https://x/cdn/hls/abc/master.txt",
  );
  assert.equal(melhorUrl([]), null);
});

test("parseSeriesIndice lê título, ano, pedaço e episódios", () => {
  const indice = parseSeriesIndice("The Boys\t2019\t2\t8\nDuna\t2024\t0\t6\n");

  assert.deepEqual(indice[0], {
    titulo: "The Boys",
    ano: "2019",
    pedaco: 2,
    episodios: 8,
  });
  assert.equal(indice[1].pedaco, 0);
});

test("parseSeriesBlocos agrupa os episódios por título", () => {
  const texto = [
    "@The Boys\t2019",
    "1\t1\tdub\thttp://x/s01e01.mp4,https://saimo/api/stream?id=1",
    "1\t2\tdub\thttp://x/s01e02.mp4",
    "@Outra Série\t2020",
    "1\t1\tleg\thttp://x/outra.mp4",
  ].join("\n");

  const blocos = parseSeriesBlocos(texto);

  assert.equal(blocos.length, 2);
  assert.equal(blocos[0].titulo, "The Boys");
  assert.equal(blocos[0].ano, "2019");
  assert.equal(blocos[0].episodios.length, 2);
  assert.deepEqual(blocos[0].episodios[0], {
    temporada: 1,
    numero: 1,
    versao: "dub",
    urls: ["http://x/s01e01.mp4", "https://saimo/api/stream?id=1"],
  });
});

test("parseBusca lê título, tipo, letra e ano", () => {
  const busca = parseBusca("#Alive (2020)\tf\t#\nThe Boys\ts\tT\t2019\n");

  assert.deepEqual(busca[0], { titulo: "#Alive (2020)", tipo: "f", letra: "#", ano: "" });
  assert.deepEqual(busca[1], { titulo: "The Boys", tipo: "s", letra: "T", ano: "2019" });
});

test("parseFichas lê a base das capas e uma ficha por título", () => {
  const texto = [
    "# Ficha de cada título: id do TMDB, pôster e gêneros.",
    "capa: https://image.tmdb.org/t/p/w342",
    "# tipo  título  id  pôster  gêneros",
    "s\tThe Boys\t76479\t/in1R2dDc421JxsoRWaIIAqVI2KE.jpg\tAção,Drama",
    "f\tMatrix\t603\t/abc.jpg\tFicção",
  ].join("\n");

  const { baseCapa, fichas } = parseFichas(texto);

  assert.equal(baseCapa, "https://image.tmdb.org/t/p/w342");
  assert.equal(fichas.length, 2, "o cabeçalho e o comentário não viram fichas");
  assert.deepEqual(fichas[0], {
    tipo: "s",
    titulo: "The Boys",
    tmdbId: "76479",
    poster: "/in1R2dDc421JxsoRWaIIAqVI2KE.jpg",
    generos: "Ação,Drama",
  });
});

test("posterDoTitulo monta o URL e devolve null quando não há ficha", () => {
  const base = "https://image.tmdb.org/t/p/w342";
  const fichas = [{ titulo: "The Boys", poster: "/in1.jpg" }];

  assert.equal(posterDoTitulo(base, fichas, "The Boys"), `${base}/in1.jpg`);
  // A normalização faz o casamento apesar da caixa/acentos.
  assert.equal(posterDoTitulo(base, fichas, "the boys"), `${base}/in1.jpg`);
  assert.equal(posterDoTitulo(base, fichas, "Desconhecido"), null);
  assert.equal(posterDoTitulo("", fichas, "The Boys"), null);
});

test("versaoParaFaixa traduz dub/leg para o vocabulário do menu", () => {
  assert.equal(versaoParaFaixa("dub"), "dubbed");
  assert.equal(versaoParaFaixa("Dublado"), "dubbed");
  assert.equal(versaoParaFaixa("leg"), "subbed");
  assert.equal(versaoParaFaixa("sub"), "subbed");
  assert.equal(versaoParaFaixa(""), "");
});

test("filtrarPorTermo usa substring e cai para tokens", () => {
  const itens = [
    { titulo: "The Boys" },
    { titulo: "The Boys Apresenta: Diabólicos" },
    { titulo: "Duna A Profecia" },
  ];

  const substring = filtrarPorTermo(itens, "the boys");
  assert.equal(substring.length, 2, "substring encontra os dois 'The Boys'");

  // "boys diabólicos" não é substring de nenhum título, mas partilha 2 tokens
  // com o segundo — o recurso por tokens apanha-o.
  const porTokens = filtrarPorTermo(itens, "boys diabólicos");
  assert.equal(porTokens[0].titulo, "The Boys Apresenta: Diabólicos");
});

test("filtrarPorTermo ignora termos curtos", () => {
  assert.deepEqual(filtrarPorTermo([{ titulo: "The Boys" }], "t"), []);
});

test("getEpisodeStream serve a faixa pedida e cai para a que existe", async () => {
  process.env.SAIMO_CATALOG_BASE = "https://catalogo.saimo.test";

  mock.method(globalThis, "fetch", async (url) => {
    const alvo = String(url);
    const responder = (corpo) => ({ ok: true, status: 200, text: async () => corpo });

    if (alvo.endsWith("/busca.txt")) return responder("Dual Show\ts\tZ\t2020");
    if (alvo.endsWith("/fichas.txt")) return responder("capa: https://img/w342");
    if (alvo.endsWith("/series-Z.txt")) return responder("Dual Show\t2020\t0\t2");
    if (alvo.endsWith("/series-Z-0.txt")) {
      return responder(
        [
          "@Dual Show\t2020",
          "1\t1\tdub\thttp://x/s01e01-dub.mp4",
          "1\t1\tleg\thttp://x/s01e01-leg.mp4",
          "1\t2\tleg\thttp://x/s01e02-leg.mp4",
        ].join("\n"),
      );
    }
    return { ok: false, status: 404, text: async () => "404" };
  });

  const { search } = await import("../services/saimo.js");
  const [titulo] = await search("dual show");

  const dub = await getEpisodeStream(titulo.slug, 1, 1, "dubbed");
  assert.equal(dub.url, "http://x/s01e01-dub.mp4");
  assert.equal(dub.faixa, "dubbed");

  const leg = await getEpisodeStream(titulo.slug, 1, 1, "subbed");
  assert.equal(leg.url, "http://x/s01e01-leg.mp4");
  assert.equal(leg.faixa, "subbed");

  // O ep. 2 só tem legendado: pedir dublado cai para o legendado em vez de falhar.
  const fallback = await getEpisodeStream(titulo.slug, 1, 2, "dubbed");
  assert.equal(fallback.url, "http://x/s01e02-leg.mp4");
  assert.equal(fallback.faixa, "subbed", "a faixa servida é reportada");
});
