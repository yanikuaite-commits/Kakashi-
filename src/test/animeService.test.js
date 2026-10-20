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
