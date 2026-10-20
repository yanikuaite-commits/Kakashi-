import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnimeApiError,
  getAnimeInfo,
  getEpisodeSources,
  searchAnime,
} from "../services/anime.js";

/**
 * Integração real com `@consumet/extensions` (rede). Prova que o serviço
 * devolve um link de streaming que o yt-dlp consegue consumir, que era o
 * objetivo da migração: o cliente HTTP morto (`api.consumet.org`) foi trocado
 * por extração em processo, sem auto-hospedar um servidor Consumet.
 *
 * Só corre quando `ANIME_TEST_NETWORK=1`, porque bate em sites de terceiros:
 * instável por natureza e não serve para bloquear CI.
 */
const comRede = process.env.ANIME_TEST_NETWORK === "1";
const TERMO = process.env.ANIME_TEST_QUERY || "one piece";

test("searchAnime devolve um resultado com provider associado", { skip: !comRede }, async () => {
  const anime = await searchAnime(TERMO);

  assert.ok(anime.id, "o resultado deve ter id");
  assert.ok(anime.provider, "o resultado deve dizer de que provider veio");
  assert.ok(anime.title, "o resultado deve ter título");
});

test("o fluxo completo devolve um link de streaming", { skip: !comRede }, async () => {
  const anime = await searchAnime(TERMO);
  const info = await getAnimeInfo(anime.id, anime.provider);

  assert.ok(info.episodes.length > 0, "deve haver episódios");
  assert.equal(info.provider, anime.provider, "o provider tem de ser o mesmo");

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

test("provider inexistente dá erro claro em vez de rebentar", async () => {
  await assert.rejects(
    () => getAnimeInfo("qualquer", "provider-que-nao-existe"),
    (error) => error instanceof AnimeApiError && /ANIME_PROVIDERS/.test(error.message),
  );
});

test("os providers recebem User-Agent de browser", async () => {
  // Regressão do erro "nenhuma fonte respondeu" no Render: a biblioteca não
  // define User-Agent, o axios envia "axios/1.x" e o Cloudflare bloqueia isso
  // em IPs de datacenter. O cliente tem de sair com cara de browser.
  const { ANIME } = await import("@consumet/extensions");
  const instance = new ANIME.AnimeUnity();

  // Aplica exatamente a mesma afinação usada pelo serviço.
  const { applyProviderClient } = await import("../services/anime.js");
  applyProviderClient(instance, "animeunity");

  const ua = instance.client.defaults.headers.common["User-Agent"];
  assert.match(ua, /Mozilla\/5\.0/, "tem de ter User-Agent de browser");
  assert.doesNotMatch(ua, /axios/i, "não pode ficar o default do axios");
  assert.ok(
    instance.client.defaults.headers.common["Accept-Language"],
    "tem de ter Accept-Language",
  );
});

/**
 * Parsing do provider próprio (`anikoto`), sem rede: as amostras abaixo são
 * cópias fiéis do HTML/JSON que o site devolve. É aqui que se prova a
 * fragilidade real do provider — o parsing depende da forma do markup, não de
 * uma API estável.
 */
const { search: anikotoSearch, episodes: anikotoEpisodes } = await import(
  "../services/anikoto.js"
);

test("anikoto: a pesquisa extrai id, slug, título e capa por bloco", async () => {
  const html = `
    <div id="list-items" class="ani items">
      <div class="item ">
        <div class="inner">
          <div class="ani poster tip" data-tip="958">
            <a href="https://anikoto.cz/watch/naruto-eybxz/ep-1">
              <img src="https://cdn.anipixcdn.co/thumbnail/71a3.jpg" alt="Naruto" />
            </a>
          </div>
        </div>
      </div>
      <div class="item ">
        <div class="inner">
          <div class="ani poster tip" data-tip="1962">
            <a href="https://anikoto.cz/watch/naruto-x-ut-hg8ns/ep-1">
              <img src="https://cdn.anipixcdn.co/thumbnail/900a.jpg" alt="Naruto x UT" />
            </a>
          </div>
        </div>
      </div>
    </div>`;

  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => html });

  try {
    const resultados = await anikotoSearch("naruto");

    assert.equal(resultados.length, 2);
    assert.deepEqual(resultados[0], {
      id: "958",
      slug: "naruto-eybxz",
      title: "Naruto",
      image: "https://cdn.anipixcdn.co/thumbnail/71a3.jpg",
    });
    assert.equal(resultados[1].slug, "naruto-x-ut-hg8ns");
  } finally {
    delete globalThis.fetch;
  }
});

test("anikoto: a pesquisa ignora blocos sem data-tip ou sem link", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => `
      <div class="item "><div class="inner"><a href="https://anikoto.cz/watch/x/ep-1">só link</a></div></div>
      <div class="item "><div class="inner"><span data-tip="7"></span>só id</div></div>`,
  });

  try {
    assert.deepEqual(await anikotoSearch("x"), []);
  } finally {
    delete globalThis.fetch;
  }
});

test("anikoto: os episódios trazem id, número e data-ids", async () => {
  const corpo = JSON.stringify({
    status: 200,
    result: `
      <div class="range">
        <a href="#" data-id="16638" data-num="1" data-slug="1" data-ids="TOKEN1" class="active">1</a>
        <a href="#" data-num="2" data-id="16639" data-ids="TOKEN2">2</a>
      </div>`,
  });

  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => corpo });

  try {
    const eps = await anikotoEpisodes("958", "naruto-eybxz");

    assert.equal(eps.length, 2);
    assert.deepEqual(eps[0], { id: "16638", number: 1, ids: "TOKEN1" });
    assert.deepEqual(eps[1], { id: "16639", number: 2, ids: "TOKEN2" });
  } finally {
    delete globalThis.fetch;
  }
});

test("anikoto: 'bad request' (resultado não-HTML) devolve lista vazia", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ status: 400, result: "bad request " }),
  });

  try {
    assert.deepEqual(await anikotoEpisodes("958", "naruto-eybxz"), []);
  } finally {
    delete globalThis.fetch;
  }
});
