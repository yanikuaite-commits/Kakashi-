import { OWNER_LID, PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { accountBalance, addCredits, getAccount } from "../../services/credits.js";
import { onlyNumbers } from "../../utils/index.js";
import { errorLog } from "../../utils/logger.js";

export default {
  name: "recarregar",
  description: "Adiciona créditos a um usuário que pagou pela recarga",
  commands: ["recarregar", "recarga", "add-creditos", "creditar"],
  usage: `${PREFIX}recarregar 30 @usuario (ou responda à mensagem do usuário)`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    fullArgs,
    isReply,
    replyLid,
    userLid,
    sendReply,
    sendErrorReply,
  }) => {
    try {
      // "args" não separa por espaço, então lemos o fullArgs diretamente.
      const parts = fullArgs.trim().split(/\s+/).filter(Boolean);
      const mentioned = parts.find((part) => part.includes("@"));
      const targetLid = isReply ? replyLid : mentioned ? `${onlyNumbers(mentioned)}@lid` : "";

      if (!targetLid) {
        throw new InvalidParameterError(
          "Mencione o usuário ou responda a uma mensagem dele. Ex: .recarregar 30 @usuario",
        );
      }

      if (targetLid === OWNER_LID) {
        throw new InvalidParameterError("O dono do bot não precisa de créditos.");
      }

      const credits = Number(parts.find((part) => /^\d+$/.test(part)) || 0);

      if (!credits) {
        throw new InvalidParameterError(
          "Informe quantos créditos adicionar. Ex: .recarregar 30 @usuario",
        );
      }

      const { account } = addCredits(targetLid, credits, {
        note: `recarga por ${userLid || "dono"}`,
      });

      const currentAccount = getAccount(targetLid);

      await sendReply(
        `✅ *Recarga concluída!*\n\n` +
          `👤 Usuário: @${targetLid.split("@")[0]}\n` +
          `➕ Créditos adicionados: ${credits}\n` +
          `💰 Saldo atual: ${accountBalance(account)} créditos\n` +
          `   ├ 🎁 Diários: ${Math.max(0, currentAccount.dailyCredits)}\n` +
          `   └ 💎 Recarregados: ${Math.max(0, currentAccount.paidCredits)}\n\n` +
          `🕛 Os créditos do dia continuam sendo renovados às 00h00 (Moçambique) e os recarregados não expiram.`,
        [targetLid],
      );
    } catch (error) {
      errorLog(error);
      await sendErrorReply(`Erro ao recarregar: ${error.message}`);
    }
  },
};
