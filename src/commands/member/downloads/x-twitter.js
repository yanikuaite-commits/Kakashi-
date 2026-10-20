import { PREFIX } from "../../../config.js";
import { InvalidParameterError, WarningError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import { downloadingMessage } from "../../../services/download-message.js";
import { mediaCaption } from "../../../utils/formatMessage.js";
import { sendMediaByRule } from "../../../utils/sendMedia.js";
import fs from "node:fs/promises";
import { errorLog } from "../../../utils/logger.js";

const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|mkv)(\?|$)/i;

export default {
  name: "x-twitter",
  description: "Faço o download de vídeos ou imagens do X (Twitter)",
  commands: ["xtwitter", "twitter", "x"],
  usage: `${PREFIX}xtwitter https://x.com/usuario/status/1234567890`,
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
        "Você precisa enviar uma URL do X (Twitter)!",
      );
    }

    if (!fullArgs.includes("x.com") && !fullArgs.includes("twitter.com")) {
      throw new WarningError("O link não é do X (Twitter)!");
    }

    let data;
    try {
      await sendReply(
        downloadingMessage({
          fileType: "vídeo",
          usuario: webMessage?.pushName,
          plataforma: "X (Twitter)",
        }),
      );
      data = await downloadByCommand("x-twitter", fullArgs);
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
