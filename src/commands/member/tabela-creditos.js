import { PREFIX } from "../../config.js";
import { sendTabela } from "../../utils/richTable.js";

export default {
  name: "tabela-creditos",
  description: "Mostra a tabela de pacotes de créditos (5, 10 e 20 MT)",
  commands: ["tabela-creditos", "tabela-pacotes", "pacotes"],
  usage: `${PREFIX}tabela-creditos`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ socket, remoteJid, webMessage, sendReply, sendReact }) => {
    await sendReact("💳");

    await sendTabela({
      socket,
      remoteJid,
      quoted: webMessage,
      sendReply,
      id: "creditos",
    });
  },
};
