import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import { downloadingMessage } from "../../../services/download-message.js";
import { sendAudioAsTitledDocument } from "../../../utils/audioFormatMenu.js";
import fs from "node:fs/promises";

export default {
  name: "play-audio",
  description: "Faço o download de músicas",
  commands: ["play-audio", "play", "pa"],
  usage: `${PREFIX}play audio MC Hariel (ou link)`,
  /**
   * @param {import("../../../@types/index.d.ts").CommandHandleProps} props
   */
  handle: async ({
    fullArgs,
    webMessage,
    sendSuccessReact,
    sendReply,
    sendAudioDocumentFromFile,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa informar o nome ou a URL da música!",
      );
    }

    let data;
    try {
      await sendReply(
        downloadingMessage({
          fileType: "áudio",
          usuario: webMessage?.pushName,
        }),
      );
      data = await downloadByCommand("play-audio", fullArgs);
      await sendSuccessReact();
    } catch (error) {
      if (data?.filePath) await fs.rm(data.filePath, { force: true }).catch(() => {});
      throw error;
    }

    // Entrega direta, sem menu de formato: o documento com o título no nome do
    // ficheiro é o formato útil para guardar, e o menu só obrigava a esperar
    // por uma resposta que seria sempre a mesma ("4").
    try {
      await sendAudioAsTitledDocument({
        filePath: data.filePath,
        fileName: data.fileName,
        title: data.title,
        artist: data.artist,
        thumbnail: data.thumbnail,
        mimetype: "audio/mpeg",
        sendAudioDocumentFromFile,
      });
    } finally {
      // O temporário sai sempre: o envio já leu o ficheiro para memória, e
      // deixá-lo no disco só ocupava espaço até ao próximo pedido.
      if (data?.filePath) await fs.rm(data.filePath, { force: true }).catch(() => {});
    }
  },
};