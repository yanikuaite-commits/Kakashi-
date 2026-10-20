import { PREFIX } from "../../../config.js";
import { InvalidParameterError, WarningError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import { downloadingMessage } from "../../../services/download-message.js";
import { mediaCaption } from "../../../utils/formatMessage.js";
import { sendMediaByRule } from "../../../utils/sendMedia.js";
import fs from "node:fs/promises";
import { errorLog } from "../../../utils/logger.js";

export default {
  name: "facebook",
  description: "Faço o download de vídeos do Facebook",
  commands: ["facebook", "face", "fb"],
  usage: `${PREFIX}facebook https://www.facebook.com/reel/123456789012345`,
  /**
   * @param {import("../../../@types/index.d.ts").CommandHandleProps} props
   */
  handle: async ({
    socket,
    remoteJid,
    sendVideoFromFile,
    sendReply,
    fullArgs,
    webMessage,
    sendWaitReact,
    sendSuccessReact,
    sendErrorReply,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa enviar uma URL do Facebook!",
      );
    }

    if (!fullArgs.includes("facebook.com") && !fullArgs.includes("fb.watch")) {
      throw new WarningError("O link não é do Facebook!");
    }

    let data;
    try {
      await sendReply(
        downloadingMessage({
          fileType: "vídeo",
          usuario: webMessage?.pushName,
          plataforma: "Facebook",
        }),
      );
      data = await downloadByCommand("facebook", fullArgs);
      await sendSuccessReact();
      // Plataformas gerais: envia SEMPRE como vídeo.
      await sendMediaByRule({
        socket,
        chatId: remoteJid,
        result: data,
        caption: mediaCaption({
          titulo: data.title,
          canal: data.artist,
          seguidores: data.followers,
          duracao: data.durationString || "Não disponível",
          qualidade: "Melhor disponível",
        }),
        rule: "general",
        sendVideoFromFile,
      });
    } catch (error) {
      errorLog(error);
      await sendErrorReply(error.message);
    } finally {
      if (data?.filePath) await fs.rm(data.filePath, { force: true });
    }
  },
};
