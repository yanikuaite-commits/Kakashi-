import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnimeApiError,
  getAnimeInfo,
  getEpisodeSources,
  searchAnime,
  searchAnimeCandidates,
} from "../services/anime.js";

/**
 * Serviço de animes (fonte única: saimo).
 *
 * O parsing do provider vive nos testes do `saimoAnime.js`; aqui prova-se a
 * camada do serviço: normalização do id, timeout/erro claro e a desambiguação
 * com tradução, sem tocar na rede real.
 */

/**
 * Integração real (rede). Só corre quando `ANIME_TEST_NETWORK=1`, porque bate
 * no site de terceiros: instável por natureza e não serve para bloquear CI.
 */
const comRede = process.env.ANIME_TEST_NETWORK === "1";
const TERMO = process.env.ANIME_TEST_QUERY || "one piece";

test("searchAnime devolve um resultado com a fonte associada", { skip: !comRede }, async () => {
  const anime = await searchAnime(TERMO);

  assert.ok(anime.id, "o resultado deve ter id");
  assert.equal(anime.provider, "saimo", "a fonte única é o saimo");
  assert.ok(anime.title, "o resultado deve ter título");
});

test("o fluxo completo devolve um link de streaming", { skip: !comRede }, async () => {
  const anime = await searchAnime(TERMO);
  const info = await getAnimeInfo(anime.id, anime.provider);

  assert.ok(info.episodes.length > 0, "deve haver episódios");

  const sources = await getEpisodeSources(info.episodes[0].id, info.provider);

  assert.ok(sources.length > 0, "deve haver pelo menos uma fonte");
  assert.match(
    sources[0].url,
    /^https?:\/\//,
    "a fonte tem de ser um URL http(s) para o yt-dlp baixar",
  );
});

test("nome vazio é rejeitado sem ir à rede", async () => {
  await assert.rejects(() => searchAnime("   "), AnimeApiError);
});

/**
 * Um id de episódio sem o separador `::` não pode rebentar com um TypeError: a
 * sessão é largada e o erro chega como `AnimeApiError`.
 */
test("episódio com id malformado dá erro claro", async () => {
  await assert.rejects(
    () => getEpisodeSources("sem-separador", "saimo"),
    (error) => error instanceof AnimeApiError,
  );
});

/**
 * `searchAnimeCandidates` — a desambiguação. A rede é substituída pelo catálogo
 * do saimo (ficheiro `links-animes.txt`): nenhum site é tocado.
 *
 * O defeito que isto corrige: pesquisar "Meu Hero Academia" (português) e cair
 * no primeiro resultado sem aviso. Aqui o catálogo só tem o título em romaji
 * ("Boku no Hero Academia"), pelo que não há correspondência exata e o fluxo
 * devolve candidatos — em vez de escolher sozinho.
 */
const CATALOGO_ANIMES = [
  "@Boku no Hero Academia\t2016\t31910",
  "1\t1\tdub\thttps://embedplayer2.xyz/cdn/hls/aaa/master.txt",
  "@Naruto\t2002\t46260",
  "1\t1\tdub\thttps://embedplayer2.xyz/cdn/hls/ccc/master.txt",
].join("\n");

function stubFetch(respostas) {
  const pedidos = [];

  globalThis.fetch = async (url) => {
    const alvo = String(url);
    pedidos.push(alvo);

    const chave = Object.keys(respostas).find((k) =>
      alvo.toLowerCase().includes(k.toLowerCase()),
    );
    const corpo = respostas[chave] ?? "";
    return {
      ok: true,
      status: 200,
      text: async () => corpo,
      json: async () => JSON.parse(corpo || "null"),
    };
  };

  return pedidos;
}

test("sem correspondência exata, devolve candidatos e traduz o termo", async () => {
  const { limparCacheAnimes } = await import("../services/saimoAnime.js");
  limparCacheAnimes();

  const pedidos = stubFetch({
    "translate.googleapis.com": JSON.stringify([
      [["My Hero Academia", "Meu Hero Academia", null, null]],
      null,
      "pt",
    ]),
    "links-animes.txt": CATALOGO_ANIMES,
  });

  try {
    const resultado = await searchAnimeCandidates("Meu Hero Academia");

    assert.equal(
      resultado.anime,
      null,
      "sem correspondência exata NÃO pode escolher sozinho",
    );
    assert.ok(resultado.candidatos.length > 0, "tem de devolver a lista");
    assert.equal(resultado.candidatos[0].title, "Boku no Hero Academia");
    assert.equal(resultado.provider, "saimo");
    assert.equal(
      resultado.termoTraduzido,
      "My Hero Academia",
      "o termo foi traduzido",
    );
    assert.equal(resultado.traduzidoDe, "Meu Hero Academia");
    assert.ok(
      pedidos.some((alvo) => alvo.includes("translate.googleapis.com")),
      "sem correspondência exata, o termo é traduzido",
    );
  } finally {
    delete globalThis.fetch;
  }
});

test("com correspondência exata, nem lista nem tradução", async () => {
  const { limparCacheAnimes } = await import("../services/saimoAnime.js");
  limparCacheAnimes();

  const pedidos = stubFetch({
    "translate.googleapis.com": JSON.stringify([
      [["X", "Y", null, null]],
      null,
      "pt",
    ]),
    "links-animes.txt": CATALOGO_ANIMES,
  });

  try {
    const resultado = await searchAnimeCandidates("naruto");

    assert.ok(resultado.anime, "com correspondência exata segue direto");
    assert.equal(resultado.anime.title, "Naruto");
    assert.equal(resultado.anime.provider, "saimo");
    assert.deepEqual(resultado.candidatos, [], "sem ambiguidade não há lista");
    assert.equal(
      pedidos.some((alvo) => alvo.includes("translate.googleapis.com")),
      false,
      "não se traduz quando o catálogo já reconheceu o termo",
    );
  } finally {
    delete globalThis.fetch;
  }
});
