import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import {
  downloadByCommand,
  isYouTubeUrl,
  resolveDownloadSource,
} from "../../../services/downloader.js";
import { downloadingMessage } from "../../../services/download-message.js";
import { startVideoFormatMenu } from "../../../utils/videoFormatMenu.js";
import fs from "node:fs/promises";
import { errorLog } from "../../../utils/logger.js";

export default {
  name: "play-video",
  description: "Faço o download de vídeos",
  commands: ["play-video", "pv"],
  usage: `${PREFIX}play video MC Hariel (ou link)`,
  /**
   * @param {import("../../../@types/index.d.ts").CommandHandleProps} props
   */
  handle: async ({
    socket,
    sendVideoFromFile,
    sendReply,
    fullArgs,
    webMessage,
    sendSuccessReact,
    sendErrorReply,
    remoteJid,
    userLid,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa informar o nome ou a URL do vídeo!",
      );
    }

    let data;
    try {
      const source = fullArgs.trim();

      // Pesquisa por nome ou link do YouTube: mostra o menu de qualidade.
      if (!/^https?:\/\//i.test(source) || isYouTubeUrl(source)) {
        const resolved = await resolveDownloadSource("play-video", source);

        await startVideoFormatMenu({
          socket,
          chatId: remoteJid,
          ownerLid: userLid,
          ownerName: webMessage?.pushName,
          sendReply,
          source: resolved.source,
          title: resolved.match?.title,
          artist: resolved.match?.artist,
          duration: resolved.match?.duration,
          thumbnail: resolved.match?.thumbnail,
          url: resolved.match?.url || source.match(/https?:\/\/\S+/)?.[0] || "",
        });
        return;
      }

      await sendReply(
        downloadingMessage({
          fileType: "vídeo",
          usuario: webMessage?.pushName,
        }),
      );
      data = await downloadByCommand("play-video", source);
      await sendSuccessReact();
      await sendVideoFromFile(data.filePath);
    } catch (error) {
      errorLog(error);
      await sendErrorReply(error.message);
    } finally {
      if (data?.filePath) await fs.rm(data.filePath, { force: true });
    }
  },
};
