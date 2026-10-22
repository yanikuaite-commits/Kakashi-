import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import {
  confirmRecharge,
  creditsForAmount,
  getPendingRecharge,
} from "../../services/recharges.js";
import { accountBalance, getAccount } from "../../services/credits.js";
import { panelMessage } from "../../utils/formatMessage.js";

export default {
  name: "recarga-confirmar",
  description: "Confirma um pagamento e adiciona os créditos ao usuário",
  commands: ["recarga-confirmar", "confirmar-recarga", "confirmar-pagamento"],
  usage: `${PREFIX}recarga-confirmar <id da transação> [créditos]`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, sendReply, sendErrorReply }) => {
    const parts = fullArgs.trim().split(/\s+/).filter(Boolean);
    const key = parts.find((part) => !/^\d+$/.test(part)) || parts[0];

    if (!key) {
      throw new InvalidParameterError(
        `Informe o id da transação. Ex: ${PREFIX}recarga-confirmar PP261021.1823.W70113`,
      );
    }

    const pendente = getPendingRecharge(key);

    if (!pendente) {
      await sendErrorReply(
        `❌ Não encontrei a transação *${key}*. Ela pode já ter sido tratada ou ter caducado.`,
      );
      return;
    }

    // Créditos: os da tabela para o valor pago, ou o que o dono indicar
    // (para valores fora da tabela).
    const indicado = parts.filter((part) => /^\d+$/.test(part)).map(Number).pop();
    const credits = indicado || creditsForAmount(pendente.amount);

    if (!credits) {
      await sendErrorReply(
        `⚠️ O valor de ${pendente.amount} MT não está na tabela de créditos. ` +
          `Indica os créditos. Ex: ${PREFIX}recarga-confirmar ${key} 20`,
      );
      return;
    }

    const resultado = confirmRecharge(key, { credits, by: "dono" });

    if (!resultado.ok) {
      const motivo =
        resultado.reason === "confirmed"
          ? "já tinha sido confirmada"
          : resultado.reason === "declined"
            ? "já tinha sido recusada"
            : resultado.reason === "expired"
              ? "caducou (passaram mais de 10 horas)"
              : resultado.reason;

      await sendErrorReply(`❌ Não confirmei a transação *${key}*: ${motivo}.`);
      return;
    }

    await sendReply(
      panelMessage({
        icone: "✅",
        titulo: "Recarga confirmada",
        campos: [
          `🔖 Transação: ${pendente.transactionId || key}`,
          `👤 Usuário: @${String(pendente.senderLid).split("@")[0]}`,
          `💰 Valor: ${pendente.amount} MT (${pendente.providerLabel})`,
          `➕ Créditos: ${resultado.credited}`,
          `💳 Saldo atual: ${accountBalance(getAccount(pendente.senderLid))} créditos`,
        ],
      }),
      [pendente.senderLid],
    );
  },
};
