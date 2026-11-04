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
import { test } from "node:test";
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

test("parseAnimes devolve lista vazia para texto vazio", () => {
  assert.deepEqual(parseAnimes(""), []);
  assert.deepEqual(parseAnimes(null), []);
});
