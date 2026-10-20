import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANIME_DOCUMENT_LIMIT_MB,
  WHATSAPP_VIDEO_LIMIT_MB,
  animeTooLargeMessage,
  decideAnimeSend,
  decideGeneralSend,
  decideYouTubeSend,
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

test("animes: cancelar acima de 350 MB", () => {
  assert.equal(decideAnimeSend(350 * MB + 1), "cancel");
  assert.equal(decideAnimeSend(400 * MB), "cancel");
  assert.match(animeTooLargeMessage(), /mais de 350MB/);
  assert.match(animeTooLargeMessage(), /qualidade mais baixa/);
});

test("animes: a regra do YouTube (documento acima de 100 MB) até 350 MB", () => {
  assert.equal(decideAnimeSend(50 * MB), "video");
  assert.equal(decideAnimeSend(100 * MB), "video");
  assert.equal(decideAnimeSend(100 * MB + 1), "document");
  assert.equal(decideAnimeSend(150 * MB), "document");
  assert.equal(decideAnimeSend(350 * MB), "document");
});

test("os limites batem com as constantes exportadas", () => {
  assert.equal(WHATSAPP_VIDEO_LIMIT_MB, 100);
  assert.equal(ANIME_DOCUMENT_LIMIT_MB, 350);
});
