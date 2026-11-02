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
 * Serviço de animes (fonte única: meusanimes).
 *
 * Os testes de parsing do provider vivem em `meusanimes.test.js`; aqui prova-se
 * a camada do serviço: normalização do id, timeout/erro claro e a
 * desambiguação com tradução, sem tocar na rede real.
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
  assert.equal(anime.provider, "meusanimes", "a fonte única é o meusanimes");
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
    () => getEpisodeSources("sem-separador", "meusanimes"),
    (error) => error instanceof AnimeApiError,
  );
});

/**
 * `searchAnimeCandidates` — a desambiguação. A rede é substituída pelo HTML do
 * meusanimes: nenhum site é tocado.
 *
 * O defeito que isto corrige: pesquisar "Meu Hero Academia" (português) devolvia
 * "Eiyuu Kyoushitsu" (outro anime) sem aviso, porque a pesquisa caía no primeiro
 * resultado quando não havia correspondência exata.
 */
const BUSCA_EIYUU = `
  <div class="result-item"><article><div class="image"><div class="thumbnail animation-2"> <a href="https://meusanimes.blog/a/eiyuu-kyoushitsu/"> <img src="https://meusanimes.blog/wp-content/uploads/2025/04/yLZS-150x150.jpg" alt="Eiyuu Kyoushitsu" /> <span class="tvshows"> TV </span> </a></div></div><div class="details"><div class="title"> <a href="https://meusanimes.blog/a/eiyuu-kyoushitsu/">Eiyuu Kyoushitsu</a></div><div class="meta"> <span class="year">2023</span></div><div class="contenido"><p>Assistir Eiyuu Kyoushitsu...</p></div></div></article></div>
`;

const BUSCA_NARUTO = `
  <div class="result-item"><article><div class="image"><div class="thumbnail animation-2"> <a href="https://meusanimes.blog/a/naruto/"> <img src="https://meusanimes.blog/wp-content/uploads/2025/04/yLZS-150x150.jpg" alt="Naruto" /> <span class="tvshows"> TV </span> </a></div></div><div class="details"><div class="title"> <a href="https://meusanimes.blog/a/naruto/">Naruto</a></div><div class="meta"> <span class="year">2002</span></div><div class="contenido"><p>Assistir Naruto...</p></div></div></article></div>
`;

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
  const pedidos = stubFetch({
    "translate.googleapis.com": JSON.stringify([
      [["My Hero Academia", "Meu Hero Academia", null, null]],
      null,
      "pt",
    ]),
    "/?s=meu%20hero%20academia": BUSCA_EIYUU,
    "/?s=my%20hero%20academia": BUSCA_EIYUU,
  });

  try {
    const resultado = await searchAnimeCandidates("Meu Hero Academia");

    assert.equal(
      resultado.anime,
      null,
      "sem correspondência exata NÃO pode escolher sozinho",
    );
    assert.ok(resultado.candidatos.length > 0, "tem de devolver a lista");
    assert.equal(resultado.candidatos[0].title, "Eiyuu Kyoushitsu");
    assert.equal(resultado.provider, "meusanimes");
    assert.equal(
      resultado.termoTraduzido,
      "My Hero Academia",
      "o termo foi traduzido",
    );
    assert.equal(resultado.traduzidoDe, "Meu Hero Academia");
    assert.ok(
      pedidos.some((alvo) =>
        alvo.toLowerCase().includes("my%20hero%20academia"),
      ),
      "o termo TRADUZIDO também tem de ser pesquisado",
    );
  } finally {
    delete globalThis.fetch;
  }
});

test("com correspondência exata, nem lista nem tradução", async () => {
  const pedidos = stubFetch({
    "translate.googleapis.com": JSON.stringify([
      [["X", "Y", null, null]],
      null,
      "pt",
    ]),
    "/?s=naruto": BUSCA_NARUTO,
  });

  try {
    const resultado = await searchAnimeCandidates("naruto");

    assert.ok(resultado.anime, "com correspondência exata segue direto");
    assert.equal(resultado.anime.title, "Naruto");
    assert.equal(resultado.anime.provider, "meusanimes");
    assert.deepEqual(resultado.candidatos, [], "sem ambiguidade não há lista");
    assert.equal(
      pedidos.some((alvo) => alvo.includes("translate.googleapis.com")),
      false,
      "não se traduz quando o site já reconheceu o termo",
    );
  } finally {
    delete globalThis.fetch;
  }
});
