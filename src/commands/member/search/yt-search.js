import { PREFIX } from "../../../config.js";
import { InvalidParameterError, WarningError } from "../../../errors/index.js";
import { searchYouTube } from "../../../services/youtube-search.js";

export function formatYouTubeResults(videos) {
  return videos.map((video, index) =>
    `*${index + 1}. ${video.title}*\nDuração: ${video.duration}\nLink: ${video.url}${video.thumbnail ? `\nThumbnail: ${video.thumbnail}` : ""}`
  ).join("\n\n");
}

export default {
  name: "yt-search",
  description: "Pesquiso vídeos no YouTube",
  commands: ["yt-search", "youtube-search"],
  usage: `${PREFIX}yt-search MC Hariel`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, sendSuccessReply }) => {
    if (fullArgs.length <= 1) {
      throw new InvalidParameterError(
        "Você precisa fornecer uma pesquisa para o YouTube."
      );
    }

    const maxLength = 100;

    if (fullArgs.length > maxLength) {
      throw new InvalidParameterError(
        `O tamanho máximo da pesquisa é de ${maxLength} caracteres.`
      );
    }

    const videos = await searchYouTube(fullArgs);
    if (!videos.length) throw new WarningError("Nenhum vídeo encontrado para esta pesquisa.");

    await sendSuccessReply(`*Resultados para: ${fullArgs}*\n\n${formatYouTubeResults(videos)}`);
  },
};
