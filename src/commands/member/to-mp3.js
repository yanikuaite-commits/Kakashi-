import fs from "node:fs";
import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { getRandomName, getRandomNumber } from "../../utils/index.js";
import { toMp3 } from "../../services/converter.js";

export default {
  name: "to-mp3",
  description: "Converte vídeos para áudio MP3!",
  commands: ["to-mp3", "video2mp3", "mp3"],
  usage: `${PREFIX}to-mp3 (envie em cima de um vídeo ou responda um vídeo)`,

  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    isVideo,
    webMessage,
    sendWaitReact,
    sendSuccessReact,
    sendAudioFromFile,
    downloadVideo,
  }) => {
    if (!isVideo) {
      throw new InvalidParameterError(
        "Por favor, envie este comando em resposta a um vídeo ou com um vídeo anexado."
      );
    }

    await sendWaitReact();

    const videoPath = await downloadVideo(webMessage, getRandomName());

    const output = await toMp3(videoPath);

    await sendSuccessReact();
    await sendAudioFromFile(output);

    fs.unlinkSync(output);
    fs.unlinkSync(videoPath);
  },
};
