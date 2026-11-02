import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import webp from "node-webpmux";
import { STICKER_PACK_PUBLISHER, ASSETS_DIR } from "../config.js";
import { addStickerMetadata } from "../services/sticker.js";

const SAMPLE = path.join(ASSETS_DIR, "samples", "sample-sticker.webp");

/** Lê de volta o JSON do EXIF gravado no webp. */
async function lerExif(file) {
  const img = new webp.Image();
  await img.load(file);
  const exif = img.exif;
  assert.ok(exif, "o ficheiro tem EXIF");
  // O JSON começa depois do cabeçalho TIFF/APP1 (22 bytes).
  const inicio = exif.indexOf(0x7b); // "{"
  return JSON.parse(exif.slice(inicio).toString("utf8"));
}

test("a figurinha recebe o nome do autor e a assinatura do Dev Yanik", async () => {
  const media = fs.readFileSync(SAMPLE);
  const saida = await addStickerMetadata(media, {
    username: "Fulano",
    botName: STICKER_PACK_PUBLISHER,
  });

  try {
    const json = await lerExif(saida);
    assert.equal(json["sticker-pack-name"], "Fulano");
    assert.equal(json["sticker-pack-publisher"], STICKER_PACK_PUBLISHER);
    assert.match(json["sticker-pack-publisher"], /Dev Yanik/);
    assert.ok(json["sticker-pack-id"], "tem um id de pacote");
  } finally {
    await fs.promises.unlink(saida).catch(() => {});
  }
});

test("a assinatura padrão menciona o Dev Yanik", () => {
  assert.match(STICKER_PACK_PUBLISHER, /Dev Yanik/);
});
