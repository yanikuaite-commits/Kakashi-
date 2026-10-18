import { PREFIX } from "../../config.js";
import { InvalidParameterError, WarningError } from "../../errors/index.js";
import { downloadByCommand, resolveDownloadSource } from "../../services/downloader.js";
import { downloadingMessage } from "../../services/download-message.js";
import fs from "node:fs/promises";
import {
  downloadMessage,
  errorMessage,
  loadingMessage,
} from "../../utils/formatMessage.js";
import { errorLog } from "../../utils/logger.js";

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

    await socket.sendMessage(socket.remoteJid || webMessage.remoteJid, {
      text: options.downloadingMessage
        ? options.downloadingMessage({
            fileType: "vídeo",
            usuario: webMessage?.pushName,
          })
        : loadingMessage({ usuario: webMessage?.pushName }),
    });

    data = await downloadByCommand("baixar", source);
    await socket.sendMessage(socket.remoteJid || webMessage.remoteJid, { react: { text: "✅", key: webMessage.key } });
    await socket.sendMessage(socket.remoteJid || webMessage.remoteJid, {
      video: { url: data.filePath },
      caption: downloadMessage({
        titulo: data.title,
        canal: data.artist,
        plataforma: data.platform || "Vídeo",
        usuario: webMessage?.pushName,
        extra: "✅ Feito! Aqui está o vídeo que pediste 🎉",
      }),
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