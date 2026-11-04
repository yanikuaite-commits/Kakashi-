import { PREFIX } from "../../../config.js";
import { startMegacineFlow } from "../../../utils/megacineMenu.js";

export default {
  name: "megacine",
  description: "Baixa séries, doramas e filmes do Saimo TV",
  commands: ["megacine", "serie", "series", "novela", "novelas", "filme", "filmes"],
  usage: `${PREFIX}megacine <nome da série ou filme>`,
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
    sendVideoFromFile,
    textOnly,
  }) => {
    await startMegacineFlow({
      socket,
      chatId: remoteJid,
      ownerLid: userLid,
      ownerName: webMessage?.pushName,
      sendReply,
      sendVideoFromFile,
      senderLids: [
        webMessage?.key?.participant,
        webMessage?.key?.participantAlt,
      ].filter(Boolean),
      nome: fullArgs.trim(),
      textOnly,
    });
  },
};
