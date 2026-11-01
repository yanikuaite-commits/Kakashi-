/**
 * Envio de mídia baixada segundo a regra de tamanho de cada origem.
 *
 * Concentra o `socket.sendMessage` e a decisão vídeo/documento para os
 * comandos não repetirem a mesma lógica. A decisão em si vive em
 * `mediaSend.js` (pura e testável).
 *
 * @author Dev Yanik
 */
import { decideGeneralSend, decideYouTubeSend, mediaUploadFromFile } from "./mediaSend.js";
import { withPreparedVideo } from "../services/mediaPrepare.js";

/**
 * Envia o resultado de um download.
 *
 * @param {object} options
 * @param {object} options.socket socket do Baileys
 * @param {string} options.chatId JID do chat
 * @param {{filePath: string, fileName?: string}} options.result
 * @param {string} options.caption legenda já montada (mediaCaption)
 * @param {"general"|"youtube"} options.rule regra de envio
 * @param {(file: string, caption: string) => Promise<unknown>} [options.sendVideoFromFile]
 * @returns {Promise<"document"|"video">} o formato usado
 */
export async function sendMediaByRule({
  socket,
  chatId,
  result,
  caption,
  rule,
  sendVideoFromFile,
}) {
  const acao =
    rule === "youtube"
      ? decideYouTubeSend(result.fileSize)
      : decideGeneralSend(result.fileSize);

  if (acao === "document") {
    await socket.sendMessage(chatId, {
      document: mediaUploadFromFile(result.filePath),
      mimetype: "video/mp4",
      fileName: result.fileName || "video.mp4",
      caption,
    });
    return "document";
  }

  if (typeof sendVideoFromFile === "function") {
    await withPreparedVideo(result.filePath, (filePath) =>
      sendVideoFromFile(filePath, caption),
    );
    return "video";
  }

  await withPreparedVideo(result.filePath, (filePath) =>
    socket.sendMessage(chatId, {
      video: mediaUploadFromFile(filePath),
      mimetype: "video/mp4",
      caption,
    }),
  );
  return "video";
}
