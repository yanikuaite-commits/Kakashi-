import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  AUDIO_FORMAT_TTL_MS,
  handleAudioFormatReply,
  startAudioFormatMenu,
} from "../utils/audioFormatMenu.js";

test("menu de áudio respeita o autor e envia documento com nome e mimetype fixos", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-format-"));
  const filePath = path.join(tempDir, "audio.mp3");
  await fs.writeFile(filePath, "audio");

  const messages = [];
  const replies = [];
  const documents = [];
  const socket = {
    sendMessage: async (chatId, content) => {
      messages.push({ chatId, content });
    },
  };
  const common = {
    chatId: "grupo@g.us",
    socket,
    sendReply: async (text) => replies.push(text),
    sendAudioFromFile: async () => {},
    sendAudioDocumentFromFile: async (...args) => documents.push(args),
  };

  try {
    assert.equal(AUDIO_FORMAT_TTL_MS, 120_000);
    assert.equal(
      await startAudioFormatMenu({
        socket,
        chatId: common.chatId,
        ownerLid: "utilizador-a",
        ownerName: "Pessoa A",
        sendReply: common.sendReply,
        payload: {
          filePath,
          fileName: "original.mp3",
          title: "Música / teste",
          artist: "Artista",
          duration: 125,
          platform: "YouTube",
          mimetype: "audio/ogg",
        },
      }),
      true,
    );

    assert.match(messages[0].content.text, /👤 \*Pedido de:\* @Pessoa A/);
    assert.match(messages[0].content.text, /⏳ \*Duração:\* 2:05/);
    assert.match(messages[0].content.text, /🌐 \*Fonte:\* YouTube/);
    // A LISTA de formato vai direto (quick_reply é proibido): listMessage com
    // os 4 formatos.
    assert.equal(messages[0].content.sections[0].rows.length, 4);

    assert.equal(
      await handleAudioFormatReply({
        ...common,
        senderLid: "utilizador-b",
        senderName: "Pessoa B",
        text: "fmt:menu",
      }),
      true,
    );
    assert.match(replies[0], /só quem pediu/i);
    assert.equal(messages.length, 1);

    assert.equal(
      await handleAudioFormatReply({
        ...common,
        senderLid: "utilizador-a",
        text: "fmt:menu",
      }),
      true,
    );
    assert.equal(messages[1].content.sections[0].rows.length, 4);

    assert.equal(
      await handleAudioFormatReply({
        ...common,
        senderLid: "utilizador-a",
        text: "4",
      }),
      true,
    );
    assert.equal(documents.length, 1);
    assert.equal(documents[0][1], "Música - teste.mp3");
    assert.equal(documents[0][6], "audio/mpeg");
    await assert.rejects(fs.access(filePath));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});