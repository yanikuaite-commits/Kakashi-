import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import fs from "node:fs/promises";
import { errorLog } from "../../../utils/logger.js";

export default {
  name: "play-video",
  description: "Faço o download de vídeos",
  commands: ["play-video", "pv"],
  usage: `${PREFIX}play-video MC Hariel`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    sendVideoFromFile,
    sendReply,
    fullArgs,
    sendSuccessReact,
    sendErrorReply,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa me dizer o que deseja buscar!",
      );
    }

    if (fullArgs.includes("http://") || fullArgs.includes("https://")) {
      throw new InvalidParameterError(
        `Você não pode usar links para baixar vídeos! Use ${PREFIX}yt-mp4 link`,
      );
    }

    try {
      await sendReply("⬇️ Baixando...");
      const data = await downloadByCommand("play-video", fullArgs);
      await sendSuccessReact();
      await sendVideoFromFile(data.filePath);
      await fs.rm(data.filePath, { force: true });
    } catch (error) {
      errorLog(JSON.stringify(error, null, 2));
      await sendErrorReply(JSON.stringify(error.message));
    }
  },
};
