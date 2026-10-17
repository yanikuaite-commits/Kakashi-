import { PREFIX } from "../../config.js";
import { downloadByCommand, resolveDownloadSource } from "../services/downloader.js";
import { downloadingMessage } from "../services/download-message.js";
import fs from "node:fs/promises";
import { errorLog } from "../utils/logger.js";
import { InvalidParameterError, WarningError } from "../errors/index.js";

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
      text: options.downloadingMessage ? options.downloadingMessage({ fileType: "vídeo" }) : "⬇️ Baixando...",
    });

    data = await downloadByCommand("baixar", source);
    await socket.sendMessage(socket.remoteJid || webMessage.remoteJid, { react: { text: "✅", key: webMessage.key } });
    await socket.sendMessage(socket.remoteJid || webMessage.remoteJid, {
      video: { url: data.filePath },
      caption: "",
    });
  } catch (error) {
    errorLog(error);
    await socket.sendMessage(socket.remoteJid || webMessage.remoteJid, {
      text: `❌ Erro! ${error.message}`,
      quoted: webMessage,
    });
  } finally {
    if (data?.filePath) await fs.rm(data.filePath, { force: true });
  }
}
