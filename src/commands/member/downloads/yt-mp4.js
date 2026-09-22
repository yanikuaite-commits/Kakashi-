import { PREFIX } from "../../../config.js";
import { InvalidParameterError, WarningError } from "../../../errors/index.js";
import {
  isYouTubeUrl,
  resolutionMenu,
  setPendingResolution,
} from "../../../services/downloader.js";

export default {
  name: "yt-mp4",
  description: "Faço o download de áudios do YouTube pelo link!",
  commands: ["yt-mp4", "youtube-mp4", "yt-video", "youtube-video", "mp4"],
  usage: `${PREFIX}yt-mp4 https://www.youtube.com/watch?v=mW8o_WDL91o`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    remoteJid,
    fullArgs,
    sendReply,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa enviar uma URL do YouTube!"
      );
    }

    const source = fullArgs.trim();
    if (!isYouTubeUrl(source)) {
      throw new WarningError("O link não é do YouTube!");
    }

    setPendingResolution(remoteJid, source);
    await sendReply(resolutionMenu());
  },
};
