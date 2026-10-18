import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";
import {
  VIDEO_FORMAT_TTL_MS,
  handleVideoFormatReply,
  startVideoFormatMenu,
} from "../utils/videoFormatMenu.js";

async function makeTempVideo() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-format-"));
  const filePath = path.join(tempDir, "video.mp4");
  await fs.writeFile(filePath, "video");
  return { tempDir, filePath };
}

test("menu de vídeo respeita o autor, abre a lista e baixa na qualidade escolhida", async () => {
  const { tempDir, filePath } = await makeTempVideo();

  const messages = [];
  const replies = [];
  const videos = [];
  const socket = {
    sendMessage: async (chatId, content) => {
      messages.push({ chatId, content });
    },
  };
  const common = {
    chatId: "grupo@g.us",
    socket,
    sendReply: async (text) => replies.push(text),
    sendVideoFromFile: async (file, caption) => videos.push({ file, caption }),
  };

  try {
    assert.equal(VIDEO_FORMAT_TTL_MS, 120_000);
    assert.equal(
      await startVideoFormatMenu({
        socket,
        chatId: common.chatId,
        ownerLid: "utilizador-a",
        ownerName: "Pessoa A",
        sendReply: common.sendReply,
        source: "https://www.youtube.com/watch?v=exemplo",
        title: "Vídeo / teste",
        artist: "Canal",
        duration: "3:45",
        url: "https://www.youtube.com/watch?v=exemplo",
      }),
      true,
    );

    assert.match(messages[0].content.text, /👤 \*Pedido de:\* @Pessoa A/);
    assert.match(messages[0].content.text, /📌 \*Título:\* Vídeo \/ teste/);
    assert.match(messages[0].content.text, /💬 \*Canal:\* Canal/);
    assert.match(messages[0].content.text, /⏳ \*Duração:\* 3:45/);
    assert.match(messages[0].content.text, /🌐 \*Fonte:\* YouTube/);
    assert.equal(messages[0].content.interactiveButtons.length, 3);

    // Outro membro não abre a lista nem consome a pendência do autor.
    assert.equal(
      await handleVideoFormatReply({
        ...common,
        senderLid: "utilizador-b",
        senderName: "Pessoa B",
        text: "vfmt:menu",
      }),
      true,
    );
    assert.match(replies[0], /só quem pediu/i);
    assert.equal(messages.length, 1);

    // O autor abre a lista single-select com as 5 qualidades.
    assert.equal(
      await handleVideoFormatReply({
        ...common,
        senderLid: "utilizador-a",
        text: "vfmt:menu",
      }),
      true,
    );
    assert.deepEqual(
      messages[1].content.sections[0].rows.map((row) => row.rowId),
      ["vfmt:360", "vfmt:480", "vfmt:720", "vfmt:1080", "vfmt:best"],
    );

    // A escolha baixa no height certo, envia e apaga o temporário.
    const downloads = [];
    assert.equal(
      await handleVideoFormatReply({
        ...common,
        senderLid: "utilizador-a",
        jid: "utilizador-a",
        text: "3",
        download: async (source, height) => {
          downloads.push({ source, height });
          return { filePath };
        },
      }),
      true,
    );
    assert.deepEqual(downloads, [
      { source: "https://www.youtube.com/watch?v=exemplo", height: 720 },
    ]);
    assert.deepEqual(videos, [
      { file: filePath, caption: "🎬 Vídeo em 720p" },
    ]);
    await assert.rejects(fs.access(filePath));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("em conversa privada o próprio chat é o autor; sem remetente não há menu", async () => {
  const chatId = "5511999999999@s.whatsapp.net";
  const replies = [];
  const sent = [];
  const socket = {
    sendMessage: async (_chat, content) => sent.push(content),
  };

  assert.equal(
    await startVideoFormatMenu({
      socket,
      chatId,
      sendReply: async (text) => replies.push(text),
      source: "https://youtu.be/exemplo",
    }),
    true,
  );
  assert.equal(sent.length, 1);

  const downloads = [];
  assert.equal(
    await handleVideoFormatReply({
      chatId,
      text: "1",
      socket,
      sendReply: async (text) => replies.push(text),
      sendVideoFromFile: async () => {},
      download: async (_source, height) => {
        downloads.push(height);
        return {};
      },
    }),
    true,
  );
  assert.deepEqual(downloads, [360]);

  // Num grupo sem LID do remetente não dá para confirmar o autor.
  assert.equal(
    await startVideoFormatMenu({
      socket,
      chatId: "grupo-sem-lid@g.us",
      sendReply: async (text) => replies.push(text),
      source: "https://youtu.be/exemplo",
    }),
    false,
  );
  assert.match(replies.at(-1), /Não consegui confirmar quem fez o pedido/);
});

test("falha no envio apaga o vídeo e a pendência expira em 2 minutos", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());

  const { tempDir, filePath } = await makeTempVideo();
  const chatId = "grupo-ttl@g.us";
  const replies = [];
  const errors = [];
  const socket = { sendMessage: async () => {} };
  const sendReply = async (text) => replies.push(text);

  try {
    await startVideoFormatMenu({
      socket,
      chatId,
      ownerLid: "utilizador-a",
      sendReply,
      source: "https://www.youtube.com/watch?v=exemplo",
    });

    assert.equal(
      await handleVideoFormatReply({
        chatId,
        senderLid: "utilizador-a",
        text: "vfmt:best",
        socket,
        sendReply,
        sendErrorReply: async (text) => errors.push(text),
        sendVideoFromFile: async () => {
          throw new Error("Falha no envio");
        },
        download: async () => ({ filePath }),
      }),
      true,
    );
    assert.match(errors.at(-1), /Falha no envio/);
    await assert.rejects(fs.access(filePath));

    // Novo pedido: sem escolha, a pendência expira e nada é baixado.
    await startVideoFormatMenu({
      socket,
      chatId,
      ownerLid: "utilizador-a",
      sendReply,
      source: "https://www.youtube.com/watch?v=exemplo",
    });

    mock.timers.tick(VIDEO_FORMAT_TTL_MS);
    assert.match(replies.at(-1), /Tempo esgotado/);

    assert.equal(
      await handleVideoFormatReply({
        chatId,
        senderLid: "utilizador-a",
        text: "2",
        socket,
        sendReply,
        sendVideoFromFile: async () => {
          throw new Error("não deveria enviar");
        },
      }),
      false,
    );

    // Sem pendência em nenhum chat, o fluxo normal dos comandos segue.
    assert.equal(
      await handleVideoFormatReply({
        chatId: "sem-pendencia@g.us",
        senderLid: "utilizador-a",
        text: "3",
        socket,
        sendReply,
        sendVideoFromFile: async () => {},
      }),
      false,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
