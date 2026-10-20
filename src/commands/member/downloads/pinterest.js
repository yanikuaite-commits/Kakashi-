import { delay } from "baileys";
import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import { downloadingMessage } from "../../../services/download-message.js";
import { mediaCaption } from "../../../utils/formatMessage.js";
import { sendMediaByRule } from "../../../utils/sendMedia.js";
import fs from "node:fs/promises";
import { errorLog } from "../../../utils/logger.js";

export default {
  name: "pinterest",
  description: "Baixo vídeos do Pinterest pelo link.",
  commands: ["pinterest", "pin"],
  usage: `${PREFIX}pinterest https://www.pinterest.com/pin/123456789/`,
  /**
   * @param {import("../../../@types/index.d.ts").CommandHandleProps} props
   */
  handle: async ({
    socket,
    remoteJid,
    fullArgs,
    webMessage,
    sendWaitReact,
    sendSuccessReact,
    sendErrorReply,
    sendVideoFromFile,
    sendReply,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa enviar uma URL do Pinterest!",
      );
    }

    let data;
    try {
      await sendReply(
        downloadingMessage({
          fileType: "vídeo",
          usuario: webMessage?.pushName,
          plataforma: "Pinterest",
        }),
      );
      data = await downloadByCommand("pinterest", fullArgs.trim());
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
