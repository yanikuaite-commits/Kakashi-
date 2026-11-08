/**
 * Testes do parsing do catálogo de ANIMES do saimo.
 *
 * Cobre o formato `@Título` / `temporada  episódio  versão  urls`, a conversão
 * `dub|leg` no vocabulário do menu e a leitura dos degraus do `master.txt` HLS.
 * Sem rede: os parsers recebem texto.
 *
 * @author Dev Yanik
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { parseAnimes } from "../services/saimoAnime.js";

test("parseAnimes lê os blocos e converte a faixa", () => {
  const texto = [
    "@Naruto\t2002\t46260",
    "1\t1\tdub\thttps://x/hls/a/master.txt",
    "1\t2\tleg\thttps://x/hls/b/master.txt",
    "@Boku no Hero Academia\t2016\t31910",
    "1\t1\tdub\thttps://x/hls/c/master.txt",
  ].join("\n");

  const blocos = parseAnimes(texto);

  assert.equal(blocos.length, 2);
  assert.equal(blocos[0].titulo, "Naruto");
  assert.equal(blocos[0].ano, "2002");
  assert.equal(blocos[0].episodios.length, 2);
  assert.equal(blocos[0].episodios[0].faixa, "dubbed");
  assert.equal(blocos[0].episodios[1].faixa, "subbed");
  assert.equal(blocos[1].titulo, "Boku no Hero Academia");
});

test("parseAnimes descarta blocos sem episódios", () => {
  const texto = "@Título Vazio\t2020\t1\n@Com Episódio\t2021\t2\n1\t1\tdub\thttps://x/a.mp4\n";
  const blocos = parseAnimes(texto);

  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].titulo, "Com Episódio");
});

test("parseAnimes guarda o id do TMDB do bloco", () => {
  const texto = [
    "@Naruto\t2002\t46260",
    "1\t1\tdub\thttps://x/a.mp4",
    "@Sem Id\t2020",
    "1\t1\tdub\thttps://x/b.mp4",
  ].join("\n");

  const blocos = parseAnimes(texto);

  assert.equal(blocos[0].tmdbId, "46260");
  assert.equal(blocos[1].tmdbId, "", "bloco sem id não inventa um");
});

test("parseAnimes devolve lista vazia para texto vazio", () => {
  assert.deepEqual(parseAnimes(""), []);
  assert.deepEqual(parseAnimes(null), []);
});

test("search resolve a capa do anime pelo id do TMDB", async () => {
  process.env.SAIMO_CATALOG_BASE = "https://catalogo.saimo.test";

  const ANIMES = [
    "@Naruto\t2002\t46260",
    "1\t1\tdub\thttps://x/n.mp4",
    "@Naruto Sem Ficha\t1999\t999",
    "1\t1\tdub\thttps://x/s.mp4",
  ].join("\n");
  const FICHAS = [
    "capa: https://image.tmdb.org/t/p/w342",
    "# tipo\ttitulo\tid\tposter\tgeneros",
    "s\tNome Antigo do Naruto\t46260\t/naruto.jpg\tAção",
  ].join("\n");

  mock.method(globalThis, "fetch", async (url) => {
    const alvo = String(url);
    const r = (c) => ({ ok: true, status: 200, text: async () => c });
    if (alvo.includes("links-animes.txt")) return r(ANIMES);
    if (alvo.includes("fichas.txt")) return r(FICHAS);
    return { ok: false, status: 404, text: async () => "404" };
  });

  const { search, limparCacheAnimes } = await import("../services/saimoAnime.js");
  limparCacheAnimes();

  const resultados = await search("naruto");
  const naruto = resultados.find((x) => x.title === "Naruto");
  const semFicha = resultados.find((x) => x.title === "Naruto Sem Ficha");

  // O id ganha ao nome: a ficha tem um título antigo, e mesmo assim a capa
  // chega — é o casamento fiável (98% dos títulos, contra 93% pelo nome).
  assert.equal(
    naruto.image,
    "https://image.tmdb.org/t/p/w342/naruto.jpg",
    "a capa vem pelo id, mesmo com o título da ficha diferente",
  );
  assert.equal(semFicha.image, null, "sem ficha o resultado fica sem capa");
});

/**
 * O áudio do HLS vive numa rendition SEPARADA
 * (`#EXT-X-MEDIA:TYPE=AUDIO`), declarada apenas no `master.txt`. As variantes
 * do degrau (`/m3/...`) são só vídeo — baixá-las entregava um episódio mudo.
 * Por isso `sources` tem de apontar para o master e levar a altura de cada
 * degrau, que é o que o yt-dlp usa para escolher o vídeo e juntar o áudio.
 */
test("sources aponta para o master e leva a altura de cada degrau", async () => {
  const MASTER = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="und",NAME="Undefined",DEFAULT=NO,AUTOSELECT=YES,URI="/m3/audio.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=276000,RESOLUTION=640x360,NAME="360p",CODECS="avc1.4D4015,mp4a.40.2",AUDIO="audio"',
    "/m3/360.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=2048000,RESOLUTION=1280x720,NAME="720p",CODECS="avc1.4D401F,mp4a.40.2",AUDIO="audio"',
    "/m3/720.m3u8",
  ].join("\n");

  const MASTER_URL = "https://x/hls/abc/master.txt";

  mock.method(globalThis, "fetch", async (url) => {
    const alvo = String(url);
    if (alvo === MASTER_URL) {
      return { ok: true, status: 200, text: async () => MASTER };
    }
    return { ok: false, status: 404, text: async () => "404" };
  });

  const { sources, limparCacheAnimes } = await import("../services/saimoAnime.js");
  const { token } = await import("../services/saimo.js");
  limparCacheAnimes();

  const fontes = await sources({ id: "ep", ids: token({ u: [MASTER_URL], v: "dubbed" }) });

  assert.equal(fontes.length, 2, "um degrau por variante de vídeo");
  assert.deepEqual(
    fontes.map((f) => f.quality),
    ["360p", "720p"],
  );
  assert.deepEqual(
    fontes.map((f) => f.height),
    [360, 720],
    "a altura de cada degrau viaja para o download",
  );
  assert.ok(
    fontes.every((f) => f.url === MASTER_URL),
    "todas as fontes apontam para o master (o único que traz o áudio)",
  );
  assert.ok(
    fontes.every((f) => f.isM3U8),
    "os degraus são HLS",
  );
});

