import { PREFIX } from "../../../config.js";
import { InvalidParameterError, WarningError } from "../../../errors/index.js";
import { searchYouTube } from "../../../services/youtube-search.js";

export function formatYouTubeResult(video, index, prefix = PREFIX) {
  return `🎬 *RESULTADO ${index + 1}*\n━━━━━━━━━━━━━━━━━━\n📌 *${video.title}*\n⏱️ ${video.duration}\n🔗 ${video.url}\n━━━━━━━━━━━━━━━━━━\n💡 Use ${prefix}play audio ou ${prefix}play video com o link (ou sem prefixo).`;
}

export async function sendYouTubeResults(videos, { sendImageFromURL, sendReply, prefix }) {
  for (const [index, video] of videos.entries()) {
    if (video.thumbnail) {
      try {
        await sendImageFromURL(video.thumbnail, "", null, false);
      } catch (error) {
        console.error("Não foi possível enviar a thumbnail da pesquisa:", error.message);
      }
    }
    await sendReply(formatYouTubeResult(video, index, prefix || PREFIX));
  }
}

export default {
  name: "yt-search",
  description: "Pesquiso vídeos no YouTube",
  commands: ["yt-search", "youtube-search", "yt", "youtube"],
  usage: `${PREFIX}yt MC Hariel`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, sendImageFromURL, sendReply, prefix }) => {
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

    await sendYouTubeResults(videos, { sendImageFromURL, sendReply, prefix });
  },
};
