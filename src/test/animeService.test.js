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

/**
 * A dublagem PT-BR tem de ser procurada PRIMEIRO.
 *
 * A ordem configurada põe os sites não-PT-BR à frente, por isso a prova tem de
 * ser feita com essa ordem INVERTIDA — senão o teste passaria por acaso. Corre
 * num processo filho porque `ANIME_PROVIDERS` é lido no import do `config.js`;
 * a rede é substituída, pelo que nenhum site é tocado.
 */
test("com dublado pedido, o provider PT-BR é procurado antes do resto", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  const script = `
import assert from "node:assert/strict";

const pedidos = [];

globalThis.fetch = async (url) => {
  const alvo = String(url);
  pedidos.push(alvo);

  if (alvo.includes("animesonlinehd.vip/api/search")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ slug: "naruto-dub", title: "Naruto", audios: ["dub"] }],
      }),
      text: async () => "",
    };
  }

  if (alvo.includes("anikoto.cz/filter")) {
    return {
      ok: true,
      status: 200,
      text: async () => \`
        <div id="list-items" class="ani items">
          <div class="item "><div class="inner">
            <div class="ani poster tip" data-tip="958">
              <a href="https://anikoto.cz/watch/naruto-eybxz/ep-1">
                <img src="https://cdn.anipixcdn.co/thumbnail/71a3.jpg" alt="Naruto" />
              </a>
            </div>
          </div></div>
        </div>\`,
    };
  }

  throw new Error("pedido inesperado: " + alvo);
};

const { searchAnime } = await import("./services/anime.js");

const dublado = await searchAnime("naruto", "dubbed");
assert.equal(
  dublado.provider,
  "animesonlinehd",
  "o site de dublagem PT-BR tem de ganhar, mesmo estando depois na configuração",
);
assert.ok(
  !pedidos.some((alvo) => alvo.includes("anikoto.cz")),
  "o site não-PT-BR nem devia ter sido consultado",
);

pedidos.length = 0;
const neutro = await searchAnime("naruto");
assert.equal(
  neutro.provider,
  "anikoto",
  "sem faixa pedida, a ordem configurada é respeitada",
);
assert.ok(pedidos.some((alvo) => alvo.includes("anikoto.cz")));
`;

  await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        ANIME_PROVIDERS: "anikoto,animesonlinehd",
        ANIME_PT_DUB_PROVIDERS: "animesonlinehd",
      },
    },
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
const { search: anikotoSearch, episodes: anikotoEpisodes, parseSeasons } = await import(
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

test("anikoto: parseSeasons extrai slug e título de cada temporada", () => {
  // Amostra REAL de `api/seasons/1631` (Attack on Titan).
  const html = `
    <section id="w-seasons" class="swiper-container">
      <div class="seasons swiper-wrapper">
        <div class="swiper-slide season active">
          <a href="https://anikoto.cz/watch/attack-on-titan-bgaoa" style="background-image: url(https://s4.anilist.co/x.jpg);">
            <div class="name" style="color:#ffffff">Season 1</div>
          </a>
        </div>
        <div class="swiper-slide season ">
          <a href="https://anikoto.cz/watch/attack-on-titan-season-2-0rtbh" style="background-image: url(https://cdn.anipixcdn.co/y.jpg);">
            <div class="name" style="color:#ffffff">Season 2</div>
          </a>
        </div>
      </div>
    </section>`;

  assert.deepEqual(parseSeasons(html), [
    { slug: "attack-on-titan-bgaoa", title: "Season 1" },
    { slug: "attack-on-titan-season-2-0rtbh", title: "Season 2" },
  ]);
});

test("anikoto: parseSeasons devolve vazio quando não há agrupamento", () => {
  assert.deepEqual(parseSeasons(""), []);
  assert.deepEqual(parseSeasons(undefined), []);
  assert.deepEqual(parseSeasons('<section id="w-seasons"></section>'), []);
});

test("anikoto: parseSeasons não deixa um link sem nome apanhar o do seguinte", () => {
  // Regressão: um regex ganancioso entre href e class="name" atravessava o
  // </a> e atribuía o nome da temporada SEGUINTE a um link sem nome.
  const html = `
    <a href="https://anikoto.cz/watch/sem-nome"><div class="outra">x</div></a>
    <a href="https://anikoto.cz/watch/com-nome"><div class="name">Season 1</div></a>`;

  assert.deepEqual(parseSeasons(html), [{ slug: "com-nome", title: "Season 1" }]);
});

test("anikoto: parseSeasons não deixa o sufixo /ep-N no slug", () => {
  const html = `
    <a href="https://anikoto.cz/watch/naruto-eybxz/ep-1"><div class="name">Classic Series</div></a>`;

  assert.deepEqual(parseSeasons(html), [
    { slug: "naruto-eybxz", title: "Classic Series" },
  ]);
});

test("anikoto: seasonEpisodes lê o data-anime-id e devolve os episódios", async () => {
  const pagina = `<div class="ctrl watch2gether-create" data-anime-id="1385" title="Watch Together"></div>`;
  const lista = JSON.stringify({
    status: 200,
    result: `<div class="range">
      <a href="#" data-id="24265" data-num="1" data-ids="TOKEN1">1</a>
      <a href="#" data-id="24266" data-num="2" data-ids="TOKEN2">2</a>
    </div>`,
  });

  const pedidos = [];
  globalThis.fetch = async (url) => {
    pedidos.push(String(url));
    return {
      ok: true,
      status: 200,
      text: async () => (String(url).includes("/ajax/episode/list/") ? lista : pagina),
    };
  };

  try {
    const { seasonEpisodes } = await import("../services/anikoto.js");
    const eps = await seasonEpisodes("attack-on-titan-season-2-0rtbh");

    assert.deepEqual(eps, [
      { id: "24265", number: 1, ids: "TOKEN1" },
      { id: "24266", number: 2, ids: "TOKEN2" },
    ]);
    // O id numérico tem de ter sido lido da página de watch da temporada.
    assert.ok(
      pedidos.some((u) => u.includes("/ajax/episode/list/1385")),
      "o endpoint de episódios tem de receber o id da temporada",
    );
  } finally {
    delete globalThis.fetch;
  }
});
