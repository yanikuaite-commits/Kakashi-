import { PREFIX } from "../../config.js";
import { isGroup, onlyNumbers } from "../../utils/index.js";
import { errorLog } from "../../utils/logger.js";
import { moderationMessage } from "../../utils/formatMessage.js";

export default {
  name: "rebaixar",
  description: "Rebaixa um administrador para membro comum",
  commands: ["rebaixar", "rebaixa", "demote"],
  usage: `${PREFIX}rebaixar @usuario`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    args,
    remoteJid,
    socket,
    sendWarningReply,
    sendSuccessReply,
    sendErrorReply,
  }) => {
    if (!isGroup(remoteJid)) {
      return sendWarningReply("Este comando só pode ser usado em grupo !");
    }
    if (!args.length || !args[0]) {
      return sendWarningReply(
        "Por favor, marque um administrador para rebaixar."
      );
    }
    const userId = args[0] ? `${onlyNumbers(args[0])}@lid` : null;
    try {
      await socket.groupParticipantsUpdate(remoteJid, [userId], "demote");
      await sendSuccessReply(
        moderationMessage({
          resumo: `🛡️ @${userId.split("@")[0]} foi rebaixado a membro comum.`,
        }),
        [userId],
      );
    } catch (error) {
      errorLog(`Erro ao rebaixar administrador: ${error.message}`);
      await sendErrorReply(
        "Ocorreu um erro ao tentar rebaixar o usuário. Eu preciso ser administrador do grupo para rebaixar outros administradores!"
      );
    }
  },
};
