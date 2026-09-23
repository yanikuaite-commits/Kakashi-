import { PREFIX } from "../../../config.js";
import { InvalidParameterError, WarningError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import fs from "node:fs/promises";
import { errorLog } from "../../../utils/logger.js";

export default {
  name: "yt-mp3",
  description: "Faço o download de áudios do YouTube pelo link!",
  commands: ["yt-mp3", "youtube-mp3", "yt-audio", "youtube-audio", "mp3"],
  usage: `${PREFIX}yt-mp3 https://www.youtube.com/watch?v=mW8o_WDL91o`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    sendAudioDocumentFromFile,
    sendReply,
    fullArgs,
    sendWaitReact,
    sendSuccessReact,
    sendErrorReply,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa enviar uma URL do YouTube!"
      );
    }

    if (!fullArgs.includes("you")) {
      throw new WarningError("O link não é do YouTube!");
    }

    let data;
    try {
      await sendReply("⬇️ Baixando...");
      data = await downloadByCommand("yt-mp3", fullArgs);
      await sendSuccessReact();
      await sendAudioDocumentFromFile(
        data.filePath,
        data.fileName,
        data.title,
        data.artist,
        data.thumbnail,
      );
    } catch (error) {
      errorLog(JSON.stringify(error, null, 2));
      await sendErrorReply(error.message);
    } finally {
      if (data?.filePath) await fs.rm(data.filePath, { force: true });
    }
  },
};
