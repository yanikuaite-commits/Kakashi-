import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import fs from "node:fs/promises";

export default {
  name: "play-audio",
  description: "Faço o download de músicas",
  commands: ["play-audio", "play", "pa"],
  usage: `${PREFIX}play-audio MC Hariel (ou link)`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    sendAudioDocumentFromFile,
    fullArgs,
    sendSuccessReact,
    sendReply,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa informar o nome ou a URL da música!",
      );
    }

    let data;
    try {
      await sendReply("⬇️ Baixando...");
      data = await downloadByCommand("play-audio", fullArgs);
      await sendSuccessReact();
      await sendAudioDocumentFromFile(
        data.filePath,
        data.fileName,
        data.title,
        data.artist,
        data.thumbnail,
        true,
        data.mimetype,
      );
    } finally {
      if (data?.filePath) await fs.rm(data.filePath, { force: true });
    }
  },
};
