import { PREFIX } from "../../../config.js";
import { startAnimeFlow } from "../../../utils/animeMenu.js";

export default {
  name: "anime",
  description: "Baixa episódios do HiAnime (via API Consumet)",
  commands: ["anime", "animes"],
  usage: `${PREFIX}anime <nome do anime>`,
  /**
   * @param {import("../../../@types/index.d.ts").CommandHandleProps} props
   */
  handle: async ({
    socket,
    remoteJid,
    fullArgs,
    webMessage,
    userLid,
    sendReply,
  }) => {
    await startAnimeFlow({
      socket,
      chatId: remoteJid,
      ownerLid: userLid,
      ownerName: webMessage?.pushName,
      sendReply,
      senderLids: [
        webMessage?.key?.participant,
        webMessage?.key?.participantAlt,
      ].filter(Boolean),
      nome: fullArgs.trim(),
    });
  },
};
