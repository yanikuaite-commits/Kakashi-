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
  avisoIdiomaDublagem,
  buildAudioRows,
  buildCandidateRows,
  buildEpisodeRows,
  buildNextPageRow,
  buildQualityRows,
  buildSeasonRows,
  capaEmTamanhoGrande,
  correspondenciaExata,
  episodePageCount,
  identitiesOverlap,
  isPortugueseDubProvider,
  jidDigits,
  jidIdentities,
  normalizeSources,
  tituloDeBusca,
  audioTrackLabel,
} from "../utils/animeFormat.js";

test("animeSessionKey junta chat e autor", () => {
  assert.equal(animeSessionKey("grupo@g.us", "autor@lid"), "grupo@g.us:autor@lid");
});

test("animeProviderLabel usa o nome próprio de cada provider", () => {
  assert.equal(animeProviderLabel("meusanimes"), "Meus Animes");
  assert.equal(animeProviderLabel("MeusAnimes"), "Meus Animes");
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

test("os prefixos de token cobrem candidato, episódio, faixa, qualidade e página", () => {
  assert.deepEqual(ANIME_TOKEN_PREFIXES, [
    "anm:an:",
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

  // Sem informação de faixa: o menu não pergunta nada.
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

/* ═══════════ DUBLAGEM PT-BR PRIMEIRO ═══════════ */

const PT = ["meusanimes"];

test("isPortugueseDubProvider só reconhece os sites de dublagem PT-BR", () => {
  assert.equal(isPortugueseDubProvider("meusanimes", PT), true);
  assert.equal(
    isPortugueseDubProvider("outrafonte", PT),
    false,
    "uma fonte que não está na lista PT-BR não é reconhecida",
  );
  assert.equal(isPortugueseDubProvider("", PT), false);
  assert.equal(isPortugueseDubProvider(undefined, PT), false);
  assert.equal(
    isPortugueseDubProvider("MeusAnimes", PT),
    true,
    "a comparação ignora a caixa",
  );
});

test("audioTrackLabel só afirma PT-BR quando o site dubla em português", () => {
  assert.equal(audioTrackLabel("dubbed", "meusanimes", PT), "Dublado (PT-BR)");
  assert.equal(
    audioTrackLabel("dubbed", "outrafonte", PT),
    "Dublado",
    "não pode prometer português numa fonte fora da lista PT-BR",
  );
  assert.equal(
    audioTrackLabel("subbed", "meusanimes", PT),
    "Legendado",
    "o idioma só qualifica a dublagem",
  );
  assert.equal(audioTrackLabel("", "meusanimes", PT), "");
});

test("avisoIdiomaDublagem avisa só quando a dublagem não é PT-BR", () => {
  assert.equal(
    avisoIdiomaDublagem("dubbed", "meusanimes", PT),
    "",
    "dublagem PT-BR não tem nada a avisar",
  );

  const ingles = avisoIdiomaDublagem("dubbed", "outrafonte", PT);
  assert.match(ingles, /inglês/i);
  assert.match(ingles, /PT-BR/i, "diz o que vai tentar fazer a seguir");

  assert.equal(
    avisoIdiomaDublagem("subbed", "outrafonte", PT),
    "",
    "o idioma só é uma questão na dublagem",
  );
  assert.equal(avisoIdiomaDublagem("", "outrafonte", PT), "");
});


test("correspondenciaExata distingue 'o site reconheceu' de 'calhou'", () => {
  const resultados = [
    { title: "Eiyuu Kyoushitsu" },
    { title: "Boku no Hero Academia" },
  ];

  assert.equal(
    correspondenciaExata(resultados, "Boku no Hero Academia").title,
    "Boku no Hero Academia",
    "o título pedido tem de ganhar, mesmo não sendo o primeiro",
  );
  assert.equal(
    correspondenciaExata(resultados, "Meu Hero Academia"),
    null,
    "sem correspondência exata devolve null (e NÃO o primeiro resultado)",
  );
  assert.equal(correspondenciaExata([], "naruto"), null);
  assert.equal(correspondenciaExata(resultados, "   "), null);
});

test("correspondenciaExata ignora os sufixos que só o site usa", () => {
  const resultados = [{ title: "Black Clover Dublado" }];

  assert.ok(
    correspondenciaExata(resultados, "Black Clover"),
    "'Black Clover' corresponde a 'Black Clover Dublado'",
  );
});

test("capaEmTamanhoGrande tira o sufixo de miniatura do WordPress", () => {
  assert.equal(
    capaEmTamanhoGrande(
      "https://meusanimes.blog/wp-content/uploads/2025/04/capa-150x150.jpg",
    ),
    "https://meusanimes.blog/wp-content/uploads/2025/04/capa.jpg",
  );
  assert.equal(
    capaEmTamanhoGrande("https://cdn.exemplo/capa-300x450.png"),
    "https://cdn.exemplo/capa.png",
  );
  assert.equal(
    capaEmTamanhoGrande("https://cdn.exemplo/capa.jpg"),
    "https://cdn.exemplo/capa.jpg",
    "um URL já em tamanho grande não é alterado",
  );
  assert.equal(capaEmTamanhoGrande(""), "");
  assert.equal(capaEmTamanhoGrande(null), "");
});

test("buildCandidateRows usa índices e mostra o ano", () => {
  const rows = buildCandidateRows([
    { title: "Boku no Hero Academia", year: "2016" },
    { title: "Boku no Hero Academia 2", year: null },
  ]);

  assert.deepEqual(
    rows.map((r) => r.id),
    ["anm:an:0", "anm:an:1"],
    "o rowId guarda só o índice (o slug fica na sessão)",
  );
  assert.equal(rows[0].title, "Boku no Hero Academia");
  assert.match(rows[0].description, /2016/);
  assert.equal(
    rows[1].description,
    "Escolher este título",
    "sem ano não inventa um",
  );
  assert.deepEqual(buildCandidateRows([]), []);
});

test("buildCandidateRows não deixa um título enorme rebentar a linha", () => {
  const rows = buildCandidateRows([{ title: "x".repeat(200) }]);

  assert.equal(rows[0].title.length, 60, "o título é cortado a 60 caracteres");
});
