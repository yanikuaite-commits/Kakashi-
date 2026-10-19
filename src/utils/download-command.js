import { PREFIX } from "../config.js";
import { InvalidParameterError, WarningError } from "../errors/index.js";
import { downloadByCommand } from "../services/downloader.js";
import { downloadingMessage } from "../services/download-message.js";
import fs from "node:fs/promises";
import {
  errorMessage,
  loadingMessage,
  mediaCaption,
} from "./formatMessage.js";
import { sendMediaByRule } from "./sendMedia.js";
import { errorLog } from "./logger.js";

export async function handleDownload(socket, webMessage, args, options = {}) {
  const fullArgs = args.join(" ");
  if (!fullArgs) {
    throw new InvalidParameterError("Você precisa enviar uma URL para download!");
  }

  let data;
  try {
    const source = fullArgs.trim();
    if (!/^https?:\/\//i.test(source)) {
      throw new WarningError("Envie uma URL válida para download.");
    }

    const chatId = socket.remoteJid || webMessage.remoteJid;

    await socket.sendMessage(chatId, {
      text: options.downloadingMessage
        ? options.downloadingMessage({
            fileType: "vídeo",
            usuario: webMessage?.pushName,
          })
        : loadingMessage({ usuario: webMessage?.pushName }),
    });

    data = await downloadByCommand("baixar", source);
    await socket.sendMessage(chatId, { react: { text: "✅", key: webMessage.key } });

    // Plataformas gerais: envia SEMPRE como vídeo.
    await sendMediaByRule({
      socket,
      chatId,
      result: data,
      caption: mediaCaption({
        titulo: data.title,
        canal: data.artist,
        seguidores: data.followers,
        duracao: data.durationString || "Não disponível",
        qualidade: "Melhor disponível",
        extra: "✅ Feito! Aqui está o vídeo que pediste 🎉",
      }),
      rule: "general",
    });
  } catch (error) {
    errorLog(error);
    await socket.sendMessage(socket.remoteJid || webMessage.remoteJid, {
      text: errorMessage(error.message),
      quoted: webMessage,
    });
  } finally {
    if (data?.filePath) await fs.rm(data.filePath, { force: true });
  }
}