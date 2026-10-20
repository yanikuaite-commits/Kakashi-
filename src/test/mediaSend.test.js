import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANIME_DOCUMENT_LIMIT_MB,
  WHATSAPP_VIDEO_LIMIT_MB,
  animeTooLargeMessage,
  decideAnimeSend,
  decideGeneralSend,
  decideYouTubeSend,
  mediaUploadFromFile,
  toMegabytes,
} from "../utils/mediaSend.js";

const MB = 1024 * 1024;

test("toMegabytes converte bytes em MB (base 1024)", () => {
  assert.equal(toMegabytes(0), 0);
  assert.equal(toMegabytes(MB), 1);
  assert.equal(toMegabytes(2.5 * MB), 2.5);
  assert.equal(toMegabytes(undefined), 0);
});

test("plataformas gerais enviam SEMPRE como vídeo", () => {
  assert.equal(decideGeneralSend(), "video");
  assert.equal(decideGeneralSend(500 * MB), "video");
});

test("YouTube: documento acima de 100 MB, vídeo até 100 MB", () => {
  assert.equal(decideYouTubeSend(50 * MB), "video");
  assert.equal(decideYouTubeSend(100 * MB), "video");
  assert.equal(decideYouTubeSend(100 * MB + 1), "document");
  assert.equal(decideYouTubeSend(300 * MB), "document");
});

test("animes: cancelar acima de 200 MB", () => {
  assert.equal(decideAnimeSend(200 * MB + 1), "cancel");
  assert.equal(decideAnimeSend(350 * MB), "cancel");
  assert.match(animeTooLargeMessage(), /mais de 200MB/);
  assert.match(animeTooLargeMessage(), /qualidade mais baixa/);
});

test("animes: a regra do YouTube (documento acima de 100 MB) até 200 MB", () => {
  assert.equal(decideAnimeSend(50 * MB), "video");
  assert.equal(decideAnimeSend(100 * MB), "video");
  assert.equal(decideAnimeSend(100 * MB + 1), "document");
  assert.equal(decideAnimeSend(150 * MB), "document");
  assert.equal(decideAnimeSend(200 * MB), "document");
});

test("os limites batem com as constantes exportadas", () => {
  assert.equal(WHATSAPP_VIDEO_LIMIT_MB, 100);
  assert.equal(ANIME_DOCUMENT_LIMIT_MB, 200);
});

test("mediaUploadFromFile devolve um stream, não um Buffer carregado", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");

  const dir = await mkdtemp(path.join(tmpdir(), "media-stream-"));
  const file = path.join(dir, "video.mp4");
  // 20 MB: se fosse buffer, o RSS subia isso tudo.
  await writeFile(file, Buffer.alloc(20 * MB, 1));

  const base = process.memoryUsage().rss;
  const payload = mediaUploadFromFile(file);
  const delta = process.memoryUsage().rss - base;

  assert.ok(payload.stream, "tem de devolver { stream }");
  assert.equal(typeof payload.stream.pipe, "function");
  assert.ok(!Buffer.isBuffer(payload), "não pode ser um Buffer");
  // Um stream não lê o ficheiro ao ser criado: o custo fica muito abaixo dos 20 MB.
  assert.ok(delta < 5 * MB, `criar o stream não deve carregar o ficheiro (delta ${(delta / MB).toFixed(1)} MB)`);

  payload.stream.destroy();
  await rm(dir, { recursive: true, force: true });
});
