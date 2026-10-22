import { PREFIX } from "../../config.js";
import { sendTabela } from "../../utils/richTable.js";

export default {
  name: "tabela-dias",
  description: "Mostra a tabela de planos por dias (7 a 60 dias)",
  commands: ["tabela-dias", "tabela-planos", "planos"],
  usage: `${PREFIX}tabela-dias`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ socket, remoteJid, webMessage, sendReply, sendReact }) => {
    await sendReact("📋");

    await sendTabela({
      socket,
      remoteJid,
      quoted: webMessage,
      sendReply,
      id: "dias",
    });
  },
};
