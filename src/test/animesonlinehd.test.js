import assert from "node:assert/strict";
import { test } from "node:test";
import {
  degrausDoVideo,
  episodiosDaTemporada,
  extrairPayloadRsc,
  parseTemporadas,
  parseVideoUrl,
  variantesDeBusca,
} from "../services/animesonlinehd.js";

/**
 * Parsers do provider AnimesOnlineHD, testados com dados reais capturados do site.
 *
 * São puros (sem rede), por isso correm sempre: cobrem o que quebra na prática —
 * os escapes do payload RSC do Next.js e das entidades HTML da página do Blogger.
 */

// Trecho real de /anime/jujutsu-kaisen, com os escapes do RSC (\") preservados:
// é assim que o payload chega no HTML.
const PUSH_RSC =
  'self.__next_f.push([1,"{\\"audios\\":[\\"leg\\",\\"dub\\"],\\"temporadas\\":' +
  '[{\\"numero\\":1,\\"nome\\":\\"Jujutsu Kaisen\\",\\"eps\\":[' +
  '{\\"num\\":1,\\"leg\\":{\\"id\\":156586,\\"tempo\\":\\"23:48\\"},' +
  '\\"dub\\":{\\"id\\":158759,\\"tempo\\":\\"23:55\\"}},' +
  '{\\"num\\":2,\\"leg\\":{\\"id\\":156580},\\"dub\\":{\\"id\\":158753}},' +
  '{\\"num\\":3,\\"leg\\":{\\"id\\":156583},\\"dub\\":null}]},' +
  '{\\"numero\\":2,\\"nome\\":\\"Jujutsu Kaisen 2\\",\\"eps\\":[' +
  '{\\"num\\":1,\\"leg\\":{\\"id\\":156900},\\"dub\\":{\\"id\\":158900}}]}]}"])';

// Trecho real da página do Blogger: o URL vem com &quot; e os escapes unicode
// \u003d / \u0026 em vez de `=` e `&`.
const HTML_BLOGGER = `
<script>var x=[[[&quot;https://rr2---sn-aigzrnse.googlevideo.com/videoplayback?expire\\u003d1792808112\\u0026ei\\u003dMKTb\\u0026itag\\u003d18\\u0026source\\u003dblogger&quot;]]]</script>
`;

// O mesmo vídeo em 720p: tem de ser ignorado, porque passa o teto de 200 MB.
const HTML_BLOGGER_720P = `
<script>var x=[[[&quot;https://rr2---sn-aigzrnse.googlevideo.com/videoplayback?expire\\u003d1792808112\\u0026itag\\u003d22\\u0026source\\u003dblogger&quot;]]]</script>
`;

test("extrairPayloadRsc junta os pedaços e desescapa as aspas", () => {
  const payload = extrairPayloadRsc(PUSH_RSC);

  assert.match(payload, /"temporadas":\[/, "as aspas do RSC têm de ficar legíveis");
  assert.doesNotMatch(payload, /\\"/, "sem escapes \\\" sobra não há JSON válido");
});

test("parseTemporadas lê as temporadas e as duas faixas de cada episódio", () => {
  const temporadas = parseTemporadas(extrairPayloadRsc(PUSH_RSC));

  assert.equal(temporadas.length, 2);
  assert.equal(temporadas[0].nome, "Jujutsu Kaisen");
  assert.equal(temporadas[0].eps.length, 3);
  assert.equal(temporadas[0].eps[0].leg.id, 156586);
  assert.equal(temporadas[0].eps[0].dub.id, 158759);
});

test("parseTemporadas devolve vazio quando não há temporadas no payload", () => {
  assert.deepEqual(parseTemporadas("{\"outra\":1}"), []);
  assert.deepEqual(parseTemporadas(""), []);
});

test("parseTemporadas ignora o que vem depois do array de temporadas", () => {
  const payload = `${extrairPayloadRsc(PUSH_RSC)},"resto":{"a":[1,2,3]}`;

  assert.equal(parseTemporadas(payload).length, 2);
});

test("episodiosDaTemporada usa o id da faixa pedida", () => {
  const [temporada] = parseTemporadas(extrairPayloadRsc(PUSH_RSC));

  const dub = episodiosDaTemporada(temporada, "dubbed");
  const sub = episodiosDaTemporada(temporada, "subbed");

  assert.deepEqual(
    dub.map((ep) => ep.id),
    ["158759", "158753"],
    "o dublado tem ids próprios; usar o do legendado tocaria a faixa errada",
  );
  assert.deepEqual(
    sub.map((ep) => ep.id),
    ["156586", "156580", "156583"],
  );
});

test("episodiosDaTemporada descarta o episódio que não tem a faixa pedida", () => {
  const [temporada] = parseTemporadas(extrairPayloadRsc(PUSH_RSC));

  const dub = episodiosDaTemporada(temporada, "dubbed");

  assert.equal(
    dub.length,
    2,
    "o episódio 3 só tem legendado: servir o áudio errado é pior do que o omitir",
  );
  assert.deepEqual(
    dub.map((ep) => ep.number),
    [1, 2],
  );
  assert.equal(
    episodiosDaTemporada(temporada, "subbed").length,
    3,
    "o legendado tem os três episódios",
  );
});

test("episodiosDaTemporada marca as faixas que o episódio publica", () => {
  const [temporada] = parseTemporadas(extrairPayloadRsc(PUSH_RSC));

  assert.deepEqual(episodiosDaTemporada(temporada, "dubbed")[0].versions, [
    "subbed",
    "dubbed",
  ]);
  assert.deepEqual(
    episodiosDaTemporada(temporada, "subbed").find((ep) => ep.number === 3).versions,
    ["subbed"],
    "o episódio 3 só tem legendado e a lista tem de o dizer",
  );
});

test("episodiosDaTemporada prefere o dublado quando não há faixa pedida", () => {
  const [temporada] = parseTemporadas(extrairPayloadRsc(PUSH_RSC));

  assert.equal(
    episodiosDaTemporada(temporada)[0].id,
    "158759",
    "sem escolha do utilizador, o dublado é a faixa preferida",
  );
  assert.equal(
    episodiosDaTemporada(temporada)[0].versions.includes("dubbed"),
    true,
  );
});

test("parseVideoUrl desescapa as entidades e os escapes unicode", () => {
  const url = parseVideoUrl(HTML_BLOGGER);

  assert.ok(url, "o URL tem de ser encontrado no HTML do Blogger");
  assert.match(url, /itag=18/, "o `=` tem de vir de \\u003d desescapado");
  assert.match(url, /&source=blogger/, "o `&` tem de vir de \\u0026 desescapado");
  assert.doesNotMatch(url, /&quot;|\\u00/);
});

test("parseVideoUrl escolhe o degrau 360p por omissão", () => {
  assert.equal(
    parseVideoUrl(HTML_BLOGGER_720P),
    null,
    "sem itag explícito, o 720p não é o degrau servido por omissão",
  );
  assert.match(
    parseVideoUrl(HTML_BLOGGER_720P, "22"),
    /itag=22/,
    "o degrau tem de ser pedível quando se quer o 720p",
  );
});

test("degrausDoVideo devolve o 360p e o 720p quando a página traz os dois", () => {
  const html = HTML_BLOGGER + HTML_BLOGGER_720P;
  const degraus = degrausDoVideo(html);

  assert.deepEqual(
    degraus.map((degrau) => degrau.quality),
    ["360p", "720p"],
    "o menu tem de oferecer os dois degraus, não decidir pelo utilizador",
  );
  assert.match(degraus[0].url, /itag=18/);
  assert.match(degraus[1].url, /itag=22/);
  assert.equal(
    degraus.every((degrau) => degrau.isM3U8 === false),
    true,
    "o Blogger serve MP4 direto, não HLS",
  );
});

test("degrausDoVideo devolve só o degrau que a página publica", () => {
  const degraus = degrausDoVideo(HTML_BLOGGER);

  assert.deepEqual(
    degraus.map((degrau) => degrau.quality),
    ["360p"],
    "sem 720p na página, só o 360p pode ser oferecido",
  );
});

test("degrausDoVideo devolve vazio quando não há vídeo na página", () => {
  assert.deepEqual(degrausDoVideo("<html>sem video</html>"), []);
  assert.deepEqual(degrausDoVideo(""), []);
});

test("parseVideoUrl devolve null quando não há vídeo na página", () => {
  assert.equal(parseVideoUrl("<html>sem video</html>"), null);
  assert.equal(parseVideoUrl(""), null);
});

test("variantesDeBusca repete a pesquisa sem a palavra da faixa", () => {
  assert.deepEqual(
    variantesDeBusca("naruto dublado"),
    ["naruto dublado", "naruto"],
    "a pesquisa é literal e \"naruto dublado\" não devolve nada no site",
  );
  assert.deepEqual(variantesDeBusca("One Piece Legendado"), [
    "One Piece Legendado",
    "One Piece",
  ]);
});

test("variantesDeBusca não repete o termo quando não há faixa a tirar", () => {
  assert.deepEqual(variantesDeBusca("jujutsu kaisen"), ["jujutsu kaisen"]);
  assert.deepEqual(variantesDeBusca("  Naruto  "), ["Naruto"]);
  assert.deepEqual(variantesDeBusca(""), []);
});

test("variantesDeBusca não devolve um termo vazio ao tirar a faixa", () => {
  assert.deepEqual(
    variantesDeBusca("dublado"),
    ["dublado"],
    "sem o termo não sobra pesquisa nenhuma para repetir",
  );
});
