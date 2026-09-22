import { PREFIX } from "../../../config.js";
import { InvalidParameterError, WarningError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import fs from "node:fs/promises";
import { errorLog } from "../../../utils/logger.js";

export default {
  name: "tik-tok",
  description: "Faço o download de vídeos do TikTok",
  commands: ["tik-tok", "ttk", "tik"],
  usage: `${PREFIX}tik-tok https://www.tiktok.com/@yrrefutavel/video/7359413022483287301`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    sendVideoFromFile,
    sendReply,
    fullArgs,
    sendWaitReact,
    sendSuccessReact,
    sendErrorReply,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError("Você precisa enviar uma URL do TikTok!");
    }

    if (!fullArgs.includes("tiktok")) {
      throw new WarningError("O link não é do TikTok!");
    }

    try {
      await sendReply("⬇️ Baixando...");
      const data = await downloadByCommand("tik-tok", fullArgs);
      await sendSuccessReact();
      await sendVideoFromFile(data.filePath);
      await fs.rm(data.filePath, { force: true });
    } catch (error) {
      errorLog(JSON.stringify(error, null, 2));
      await sendErrorReply(error.message);
    }
  },
};
