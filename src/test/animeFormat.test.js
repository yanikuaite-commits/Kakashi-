import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANIME_TOKEN_PREFIXES,
  EPISODES_PER_PAGE,
  animeQualityLabel,
  animeSessionKey,
  animeTokenIndex,
  buildEpisodePageRows,
  buildEpisodeRows,
  buildQualityRows,
  episodePageCount,
  identitiesOverlap,
  jidDigits,
  jidIdentities,
  normalizeSources,
} from "../utils/animeFormat.js";

test("animeSessionKey junta chat e autor", () => {
  assert.equal(animeSessionKey("grupo@g.us", "autor@lid"), "grupo@g.us:autor@lid");
});

test("animeQualityLabel deriva rótulos legíveis", () => {
  assert.equal(animeQualityLabel({ quality: "1080p" }), "1080p");
  assert.equal(animeQualityLabel({ quality: "720" }), "720p");
  assert.equal(animeQualityLabel({ resolution: "480p" }), "480p");
  assert.equal(animeQualityLabel({ height: 360 }), "360p");
  assert.equal(animeQualityLabel({ quality: "auto" }), "auto");
  assert.equal(animeQualityLabel({}), "auto");
});

test("buildEpisodeRows pagina com índices ABSOLUTOS estáveis", () => {
  const episodes = Array.from({ length: 25 }, (_, i) => ({
    id: `ep-${i}`,
    number: i + 1,
    title: `Episódio ${i + 1}`,
  }));

  const primeira = buildEpisodeRows(episodes, 0);
  assert.equal(primeira.length, EPISODES_PER_PAGE);
  assert.equal(primeira[0].id, "anm:ep:0");
  assert.equal(primeira[9].id, "anm:ep:9");
  assert.equal(primeira[0].episodeId, "ep-0");
  assert.match(primeira[0].title, /Episódio 1/);

  // Página 2: o índice tem de ser o absoluto (10..19), não a posição na página,
  // senão `session.episodes[i]` resolvia o episódio errado.
  const segunda = buildEpisodeRows(episodes, 1);
  assert.equal(segunda[0].id, "anm:ep:10");
  assert.equal(segunda[0].episodeId, "ep-10");
  assert.match(segunda[0].title, /Episódio 11/);

  // Última página parcial: 25 episódios → 5 linhas.
  const ultima = buildEpisodeRows(episodes, 2);
  assert.equal(ultima.length, 5);
  assert.equal(ultima.at(-1).id, "anm:ep:24");
});

test("episodePageCount cobre todos os episódios, com mínimo de 1", () => {
  assert.equal(episodePageCount([]), 1);
  assert.equal(episodePageCount(Array.from({ length: 10 })), 1);
  assert.equal(episodePageCount(Array.from({ length: 11 })), 2);
  assert.equal(episodePageCount(Array.from({ length: 220 })), 22);
  assert.equal(episodePageCount(Array.from({ length: 220 }), 25), 9);
});

test("buildEpisodePageRows só mostra navegação onde há página", () => {
  // Página única: sem navegação.
  assert.deepEqual(buildEpisodePageRows(0, 1), []);

  // Primeira de várias: só "seguinte".
  const primeira = buildEpisodePageRows(0, 3);
  assert.equal(primeira.length, 1);
  assert.equal(primeira[0].id, "anm:pg:1");
  assert.match(primeira[0].title, /seguinte/);
  assert.match(primeira[0].description, /2 de 3/);

  // Do meio: ambas.
  const meio = buildEpisodePageRows(1, 3);
  assert.deepEqual(
    meio.map((r) => r.id),
    ["anm:pg:0", "anm:pg:2"],
  );

  // Última: só "anterior".
  const ultima = buildEpisodePageRows(2, 3);
  assert.equal(ultima.length, 1);
  assert.equal(ultima[0].id, "anm:pg:1");
  assert.match(ultima[0].title, /anterior/);
});

test("normalizeSources filtra sem url e ordena da maior para a menor", () => {
  const sources = normalizeSources([
    { url: "https://a/480.m3u8", quality: "480p", isM3U8: true },
    { url: "https://a/1080.m3u8", quality: "1080p", isM3U8: true },
    { quality: "sem-url" },
    { url: "https://a/720.mp4", quality: "720p" },
  ]);

  assert.deepEqual(
    sources.map((s) => s.label),
    ["1080p", "720p", "480p"],
  );
  assert.equal(sources[0].isM3U8, true);
  assert.equal(sources[1].isM3U8, false);
});

test("buildQualityRows usa anm:src:<i> e mantém a url real fora do rowId", () => {
  const rows = buildQualityRows([
    { url: "https://long/assinada?token=abc", label: "1080p", isM3U8: true },
    { url: "https://x/720.mp4", label: "720p", isM3U8: false },
  ]);

  assert.equal(rows[0].id, "anm:src:0");
  assert.equal(rows[1].id, "anm:src:1");
  // O rowId é curto; a URL assinada fica no objeto (sessão), não no id.
  assert.ok(rows[0].id.length < 20);
  assert.equal(rows[0].url, "https://long/assinada?token=abc");
});

test("animeTokenIndex lê o índice do token", () => {
  assert.equal(animeTokenIndex("anm:ep:3", "anm:ep:"), 3);
  assert.equal(animeTokenIndex("anm:src:0", "anm:src:"), 0);
  assert.equal(animeTokenIndex("anm:pg:2", "anm:pg:"), 2);
  assert.equal(animeTokenIndex("anm:ep:x", "anm:ep:"), -1);
  assert.equal(animeTokenIndex("vfmt:720", "anm:ep:"), -1);
  assert.equal(animeTokenIndex("", "anm:ep:"), -1);
});

test("os prefixos de token cobrem episódio, qualidade e página", () => {
  assert.deepEqual(ANIME_TOKEN_PREFIXES, ["anm:ep:", "anm:src:", "anm:pg:"]);
});

test("jidDigits ignora o servidor e o sufixo de aparelho", () => {
  // A MESMA pessoa: só os dígitos contam.
  assert.equal(jidDigits("244991234567:12@lid"), jidDigits("244991234567@lid"));
  assert.equal(jidDigits("244991234567@lid"), jidDigits("244991234567@s.whatsapp.net"));
  assert.equal(jidDigits("244991234567:12@lid"), "244991234567");
  assert.equal(jidDigits(""), "");
  assert.equal(jidDigits(undefined), "");
});

test("jidIdentities recolhe as formas comparáveis e ignora vazios", () => {
  const ids = jidIdentities("244991234567:12@lid", "244991234567@s.whatsapp.net", "");
  assert.deepEqual([...ids], ["244991234567"]);
  assert.equal(jidIdentities().size, 0);
});

test("identitiesOverlap compara sem depender da ordem", () => {
  const autor = jidIdentities("244991234567:12@lid");
  const quem = jidIdentities("244991234567@s.whatsapp.net");
  const outro = jidIdentities("555555555555@lid");

  assert.equal(identitiesOverlap(autor, quem), true);
  assert.equal(identitiesOverlap(quem, autor), true);
  assert.equal(identitiesOverlap(autor, outro), false);
  assert.equal(identitiesOverlap(autor, new Set()), false);
  assert.equal(identitiesOverlap(null, quem), false);
});
