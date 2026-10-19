import fs from "node:fs/promises";
import { downloadVideo } from "../services/downloader.js";
import { downloadMessage, errorMessage, usageMessage } from "./formatMessage.js";

export async function handleDownload(sock, message, args) {
  const jid = message.key.remoteJid;
  const url = args[0];
  if (!url) {
    await sock.sendMessage(jid, {
      text: usageMessage({ usage: "baixar https://exemplo.com/video" }),
    });
    return;
  }

  let filePath;
  try {
    const result = await downloadVideo(url);
    filePath = result.filePath;
    await sock.sendMessage(jid, {
      video: { url: filePath },
      mimetype: result.mimetype,
      caption: downloadMessage({
        titulo: result.title,
        canal: result.artist,
        plataforma: "Download",
        extra: "✅ Feito! Aqui está o vídeo que pediste 🎉",
      }),
    });
    console.log("Vídeo enviado com sucesso.");
  } catch (error) {
    console.error("Erro ao baixar vídeo com GenDownload:", error);
    await sock.sendMessage(jid, { text: errorMessage(error.message) });
  } finally {
    if (filePath) await fs.rm(filePath, { force: true });
  }
}
