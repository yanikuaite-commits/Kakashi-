import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import fs from "node:fs/promises";
import {
  formatSecondsToMinutesAndSeconds,
  getRandomNumber,
} from "../../../utils/index.js";

export default {
  name: "play-audio",
  description: "Faço o download de músicas",
  commands: ["play-audio", "play", "pa"],
  usage: `${PREFIX}play-audio MC Hariel`,
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
        "Você precisa me dizer o que deseja buscar!",
      );
    }

    if (fullArgs.includes("http://") || fullArgs.includes("https://")) {
      throw new InvalidParameterError(
        `Você não pode usar links para baixar músicas! Use ${PREFIX}yt-mp3 link`,
      );
    }

    await sendReply("⬇️ Baixando...");
    const data = await downloadByCommand("play-audio", fullArgs);
    await sendSuccessReact();
    await sendAudioDocumentFromFile(
      data.filePath,
      data.fileName,
      data.title,
      data.artist,
      data.thumbnail,
    );
    await fs.rm(data.filePath, { force: true });
  },
};
