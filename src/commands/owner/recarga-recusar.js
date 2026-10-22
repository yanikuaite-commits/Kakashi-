import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { declineRecharge, getPendingRecharge } from "../../services/recharges.js";
import { panelMessage } from "../../utils/formatMessage.js";

export default {
  name: "recarga-recusar",
  description: "Recusa um pagamento e cancela a transação",
  commands: ["recarga-recusar", "recusar-recarga", "recusar-pagamento"],
  usage: `${PREFIX}recarga-recusar <id da transação>`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, sendReply, sendErrorReply }) => {
    const key = fullArgs.trim().split(/\s+/).filter(Boolean)[0];

    if (!key) {
      throw new InvalidParameterError(
        `Informe o id da transação. Ex: ${PREFIX}recarga-recusar PP261021.1823.W70113`,
      );
    }

    const pendente = getPendingRecharge(key);

    if (!pendente) {
      await sendErrorReply(
        `❌ Não encontrei a transação *${key}*. Ela pode já ter sido tratada ou ter caducado.`,
      );
      return;
    }

    const resultado = declineRecharge(key, { by: "dono" });

    if (!resultado.ok) {
      await sendErrorReply(
        `❌ Não recusei a transação *${key}*: ${resultado.reason}.`,
      );
      return;
    }

    await sendReply(
      panelMessage({
        icone: "🚫",
        titulo: "Recarga recusada",
        campos: [
          `🔖 Transação: ${pendente.transactionId || key}`,
          `👤 Usuário: @${String(pendente.senderLid).split("@")[0]}`,
          `💰 Valor: ${pendente.amount} MT (${pendente.providerLabel})`,
          "",
          "A transação foi cancelada e nada foi creditado.",
        ],
      }),
      [pendente.senderLid],
    );
  },
};
