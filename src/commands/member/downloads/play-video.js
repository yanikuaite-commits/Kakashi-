import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import {
  downloadByCommand,
  isYouTubeUrl,
  resolveDownloadSource,
  resolutionMenu,
  setPendingResolution,
} from "../../../services/downloader.js";
import { downloadingMessage } from "../../../services/download-message.js";
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
    sendVideoFromFile,
    sendReply,
    fullArgs,
    webMessage,
    sendSuccessReact,
    sendErrorReply,
    remoteJid,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa informar o nome ou a URL do vídeo!",
      );
    }

    let data;
    try {
      const source = fullArgs.trim();
      if (!/^https?:\/\//i.test(source) || isYouTubeUrl(source)) {
        const resolved = await resolveDownloadSource("play-video", source);
        setPendingResolution(remoteJid, resolved.source);
        await sendReply(resolutionMenu());
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
