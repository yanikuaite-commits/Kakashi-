import fs from "node:fs/promises";
import { downloadWithCobalt } from "../utils/cobaltDownloader.js";

export async function handleDownload(sock, message, args) {
  const jid = message.key.remoteJid;
  const url = args[0];
  if (!url) {
    await sock.sendMessage(jid, { text: "Informe o link do vídeo. Exemplo: baixar https://exemplo.com/video" });
    return;
  }

  let filePath;
  try {
    const result = await downloadWithCobalt(url);
    filePath = result.filePath;
    await sock.sendMessage(jid, {
      video: { url: filePath },
      mimetype: result.mimetype,
      caption: "Vídeo baixado via Cobalt",
    });
    console.log("Vídeo enviado com sucesso.");
  } catch (error) {
    console.error("Erro ao baixar vídeo com Cobalt:", error);
    await sock.sendMessage(jid, { text: `Não consegui baixar este vídeo: ${error.message}` });
  } finally {
    if (filePath) await fs.rm(filePath, { force: true });
  }
}
