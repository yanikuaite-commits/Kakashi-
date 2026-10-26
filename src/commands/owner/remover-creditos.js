import { OWNER_LID, PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import {
  accountBalance,
  getAccount,
  removeCredits,
} from "../../services/credits.js";
import { onlyNumbers } from "../../utils/index.js";
import { errorLog } from "../../utils/logger.js";

export default {
  name: "remover-creditos",
  description: "Remove créditos de um usuário (dono)",
  commands: [
    "remover-creditos",
    "remover-credito",
    "tirar-creditos",
    "debitar",
    "remove-creditos",
  ],
  usage: `${PREFIX}remover-creditos 30 @usuario (ou responda à mensagem do usuário)`,
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
          `Mencione o usuário ou responda a uma mensagem dele. Ex: ${PREFIX}remover-creditos 30 @usuario`,
        );
      }

      if (targetLid === OWNER_LID) {
        throw new InvalidParameterError("O dono do bot não tem saldo para remover.");
      }

      // "tudo" é o atalho para esvaziar a conta sem ter de saber o saldo.
      const tudo = parts.some((part) => part.toLowerCase() === "tudo");
      const credits = Number(parts.find((part) => /^\d+$/.test(part)) || 0);

      if (!credits && !tudo) {
        throw new InvalidParameterError(
          `Informe quantos créditos remover (ou "tudo"). Ex: ${PREFIX}remover-creditos 30 @usuario`,
        );
      }

      const antes = accountBalance(getAccount(targetLid));

      if (tudo && !antes) {
        await sendErrorReply(
          `❌ @${targetLid.split("@")[0]} já está sem créditos.`,
          [targetLid],
        );
        return;
      }

      const resultado = removeCredits(targetLid, credits || antes, {
        note: `remoção por ${userLid || "dono"}`,
        // Com "tudo" o valor pedido é o saldo lido agora; se ele mudar no
        // instante seguinte (outro comando a correr), remover o que resta é
        // melhor do que falhar por "saldo insuficiente".
        allowPartial: tudo,
      });

      if (!resultado.ok) {
        await sendErrorReply(
          `❌ Não removi créditos de @${targetLid.split("@")[0]}: ${resultado.reason} ` +
            `(saldo atual: ${resultado.balance}).`,
          [targetLid],
        );
        return;
      }

      const currentAccount = getAccount(targetLid);

      await sendReply(
        `✅ *Créditos removidos!*\n\n` +
          `👤 Usuário: @${targetLid.split("@")[0]}\n` +
          `➖ Créditos removidos: ${resultado.removed}\n` +
          `💰 Saldo atual: ${accountBalance(resultado.account)} créditos\n` +
          `   ├ 🎁 Diários: ${Math.max(0, currentAccount.dailyCredits)}\n` +
          `   └ 💎 Recarregados: ${Math.max(0, currentAccount.paidCredits)}\n\n` +
          `🕛 Os créditos do dia voltam às 00h00 (Moçambique); só os recarregados não regressam.`,
        [targetLid],
      );
    } catch (error) {
      errorLog(error);
      await sendErrorReply(`Erro ao remover créditos: ${error.message}`);
    }
  },
};
