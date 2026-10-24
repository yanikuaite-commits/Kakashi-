import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANIME_TOKEN_PREFIXES,
  EPISODES_PER_PAGE,
  animeProviderLabel,
  animeQualityLabel,
  animeSessionKey,
  animeTokenIndex,
  audioVersionLabel,
  availableAudioVersions,
  buildAudioRows,
  buildEpisodeRows,
  buildNextPageRow,
  buildQualityRows,
  buildSeasonRows,
  episodePageCount,
  escolherEpisodio,
  identitiesOverlap,
  jidDigits,
  jidIdentities,
  melhorResultado,
  normalizeSources,
  tituloDeBusca,
} from "../utils/animeFormat.js";

test("animeSessionKey junta chat e autor", () => {
  assert.equal(animeSessionKey("grupo@g.us", "autor@lid"), "grupo@g.us:autor@lid");
});

test("animeProviderLabel usa o nome próprio de cada provider", () => {
  assert.equal(animeProviderLabel("animeheaven"), "AnimeHeaven");
  assert.equal(animeProviderLabel("anikoto"), "Anikoto");
  assert.equal(animeProviderLabel("AnimeHeaven"), "AnimeHeaven");
  assert.equal(animeProviderLabel(""), "Animes");
  assert.equal(animeProviderLabel(null), "Animes");
  // Desconhecido continua a capitalizar em vez de desaparecer.
  assert.equal(animeProviderLabel("novosite"), "Novosite");
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

test("buildNextPageRow mostra um só botão enquanto faltam episódios", () => {
  // Página única: sem botão.
  assert.deepEqual(buildNextPageRow(0, 1), []);

  // Primeira de 3: um só botão "ver mais", sem retroceder.
  const primeira = buildNextPageRow(0, 3);
  assert.equal(primeira.length, 1);
  assert.equal(primeira[0].id, "anm:pg:1");
  assert.match(primeira[0].title, /Ver mais/);
  assert.match(primeira[0].description, /2 de 3/);
  assert.match(primeira[0].description, /Mais episódios/);

  // Penúltima: o rótulo avisa que são os últimos.
  const penultima = buildNextPageRow(1, 3);
  assert.equal(penultima.length, 1);
  assert.equal(penultima[0].id, "anm:pg:2");
  assert.match(penultima[0].description, /Últimos episódios/);

  // Última: sem botão.
  assert.deepEqual(buildNextPageRow(2, 3), []);
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

test("os prefixos de token cobrem episódio, faixa, qualidade e página", () => {
  assert.deepEqual(ANIME_TOKEN_PREFIXES, [
    "anm:sea:",
    "anm:ep:",
    "anm:aud:",
    "anm:src:",
    "anm:pg:",
  ]);
});

test("availableAudioVersions devolve a UNIÃO das faixas da lista", () => {
  // Lista inteira com as duas → pergunta as duas.
  assert.deepEqual(
    availableAudioVersions([
      { versions: ["subbed", "dubbed"] },
      { versions: ["dubbed", "subbed"] },
    ]),
    ["subbed", "dubbed"],
  );

  // Caso REAL do Naruto (218 eps com as duas, 2 só legendado): exigir a
  // intersecção dava só "subbed" e o menu nunca perguntava.
  assert.deepEqual(
    availableAudioVersions([
      { versions: ["subbed", "dubbed"] },
      { versions: ["subbed"] },
    ]),
    ["subbed", "dubbed"],
  );

  // Caso REAL do One Piece (583 com as duas, 577 só legendado, 2 só dublado):
  // a intersecção era VAZIA e o menu não perguntava nada.
  assert.deepEqual(
    availableAudioVersions([
      { versions: ["subbed", "dubbed"] },
      { versions: ["subbed"] },
      { versions: ["dubbed"] },
    ]),
    ["subbed", "dubbed"],
  );

  // Sem informação de faixa (anikoto/animeheaven): o menu não pergunta nada.
  assert.deepEqual(availableAudioVersions([{ number: 1 }, { number: 2 }]), []);
  assert.deepEqual(availableAudioVersions([]), []);
  assert.deepEqual(availableAudioVersions([{ versions: [] }]), []);
  assert.deepEqual(availableAudioVersions([{ versions: ["subbed"] }]), ["subbed"]);
});

test("audioVersionLabel traduz as faixas e não inventa as desconhecidas", () => {
  assert.equal(audioVersionLabel("subbed"), "Legendado");
  assert.equal(audioVersionLabel("dubbed"), "Dublado");
  assert.equal(audioVersionLabel("SUBBED"), "Legendado");
  assert.equal(audioVersionLabel(""), "");
  assert.equal(audioVersionLabel("raw"), "raw");
});

test("buildAudioRows só cria linhas para as faixas oferecidas", () => {
  const ambas = buildAudioRows(["subbed", "dubbed"]);
  assert.deepEqual(
    ambas.map((r) => r.id),
    ["anm:aud:subbed", "anm:aud:dubbed"],
  );
  assert.equal(ambas[0].title, "Legendado");
  assert.equal(ambas[1].title, "Dublado");

  // Uma lista só com dublado não pode mostrar a linha do legendado.
  const soDub = buildAudioRows(["dubbed"]);
  assert.deepEqual(
    soDub.map((r) => r.id),
    ["anm:aud:dubbed"],
  );
  assert.deepEqual(buildAudioRows([]), []);
});

test("buildSeasonRows usa anm:sea:<i> e guarda o slug", () => {
  const rows = buildSeasonRows([
    { slug: "attack-on-titan-bgaoa", title: "Season 1" },
    { slug: "attack-on-titan-season-2-0rtbh", title: "Season 2" },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "anm:sea:0");
  assert.equal(rows[1].id, "anm:sea:1");
  assert.equal(rows[0].title, "Season 1");
  assert.equal(rows[1].slug, "attack-on-titan-season-2-0rtbh");
});

test("buildSeasonRows lida com lista vazia e título ausente", () => {
  assert.deepEqual(buildSeasonRows([]), []);
  const [row] = buildSeasonRows([{ slug: "x" }]);
  assert.equal(row.title, "Temporada 1");
});

test("animeTokenIndex lê o índice de temporada", () => {
  assert.equal(animeTokenIndex("anm:sea:3", "anm:sea:"), 3);
  assert.equal(animeTokenIndex("anm:sea:0", "anm:sea:"), 0);
  assert.equal(animeTokenIndex("anm:ep:1", "anm:sea:"), -1);
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

test("tituloDeBusca tira o sufixo que só um site usa", () => {
  assert.equal(tituloDeBusca("Jujutsu Kaisen (TV)"), "Jujutsu Kaisen");
  assert.equal(tituloDeBusca("Naruto Shippuden (Dublado)"), "Naruto Shippuden");
  assert.equal(tituloDeBusca("One Piece (Legendado)"), "One Piece");
  assert.equal(tituloDeBusca("Bleach - Dublado"), "Bleach");
  assert.equal(tituloDeBusca("Naruto Dublado"), "Naruto");
});

test("tituloDeBusca preserva o que faz parte do nome", () => {
  assert.equal(
    tituloDeBusca("Kaguya-sama: Love is War"),
    "Kaguya-sama: Love is War",
    "dois pontos no meio é do título, não um sufixo",
  );
  assert.equal(tituloDeBusca("Re:Zero"), "Re:Zero");
  assert.equal(tituloDeBusca("Steins;Gate"), "Steins;Gate");
  assert.equal(tituloDeBusca("Fate/stay night"), "Fate/stay night");
});

test("tituloDeBusca lida com entradas vazias", () => {
  assert.equal(tituloDeBusca(""), "");
  assert.equal(tituloDeBusca(null), "");
  assert.equal(tituloDeBusca("   Naruto   "), "Naruto");
});

test("escolherEpisodio exige a faixa pedida explicitamente", () => {
  const candidatos = [
    { id: "a", versions: ["subbed"] },
    { id: "b", versions: ["subbed", "dubbed"] },
  ];

  assert.equal(escolherEpisodio(candidatos, "dubbed").id, "b");
  assert.equal(escolherEpisodio(candidatos, "subbed").id, "a");
});

test("escolherEpisodio prefere o dublado sem escolha do utilizador", () => {
  const candidatos = [
    { id: "leg", versions: ["subbed"] },
    { id: "dub", versions: ["subbed", "dubbed"] },
  ];

  assert.equal(escolherEpisodio(candidatos).id, "dub");
  assert.equal(escolherEpisodio(candidatos, "", false).id, "leg");
});

test("escolherEpisodio não falha quando não há dublado", () => {
  const candidatos = [{ id: "leg", versions: ["subbed"] }];

  assert.equal(
    escolherEpisodio(candidatos).id,
    "leg",
    "sem dublagem o episódio não pode desaparecer",
  );
});

test("escolherEpisodio devolve null quando a faixa pedida não existe", () => {
  const candidatos = [{ id: "leg", versions: ["subbed"] }];

  assert.equal(
    escolherEpisodio(candidatos, "dubbed"),
    null,
    "servir outra faixa é o defeito que este fluxo corrige",
  );
  assert.equal(escolherEpisodio([], "dubbed"), null);
  assert.equal(escolherEpisodio(undefined), null);
});

test("melhorResultado prefere o título exato ao primeiro da lista", () => {
  const resultados = [
    { id: "1", title: "One Piece: Episode of Merry" },
    { id: "2", title: "One Piece" },
  ];

  assert.equal(
    melhorResultado(resultados, "one piece").id,
    "2",
    "o especial não pode esconder a série",
  );
});

test("melhorResultado mantém o primeiro quando nada corresponde", () => {
  const resultados = [{ id: "1", title: "Kaiju Girls" }];

  assert.equal(melhorResultado(resultados, "kaiju girls").id, "1");
  assert.equal(melhorResultado(resultados, "outro titulo").id, "1");
  assert.equal(melhorResultado([], "naruto"), null);
  assert.equal(melhorResultado(undefined, "naruto"), null);
});

test("melhorResultado compara ignorando os sufixos de site", () => {
  const resultados = [
    { id: "1", title: "Jujutsu Kaisen (TV)" },
    { id: "2", title: "Jujutsu Kaisen 0" },
  ];

  assert.equal(
    melhorResultado(resultados, "Jujutsu Kaisen").id,
    "1",
    "(TV) não impede a correspondência",
  );
});
