import { PREFIX } from "../../config.js";
import { listPendingRecharges } from "../../services/recharges.js";
import { panelMessage } from "../../utils/formatMessage.js";

function formatarHora(iso) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "—";

  const pad = (n) => String(n).padStart(2, "0");

  return (
    `${pad(data.getUTCDate())}/${pad(data.getUTCMonth() + 1)} ` +
    `${pad(data.getUTCHours())}:${pad(data.getUTCMinutes())}`
  );
}

export default {
  name: "recargas-pendentes",
  description: "Lista os pagamentos à espera de confirmação",
  commands: ["recargas-pendentes", "pagamentos-pendentes", "recargas"],
  usage: `${PREFIX}recargas-pendentes`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ sendReply }) => {
    const pendentes = listPendingRecharges().sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );

    if (!pendentes.length) {
      await sendReply(
        panelMessage({
          icone: "📭",
          titulo: "Recargas pendentes",
          campos: ["Não há pagamentos à espera de confirmação."],
        }),
      );
      return;
    }

    const campos = pendentes.flatMap((recharge, index) => {
      const plano = recharge.plan;
      const entrega =
        recharge.kind === "assinatura"
          ? plano
            ? `⭐ ${plano.dias} dias (+${plano.bonus}/dia)`
            : "⭐ assinatura (plano por confirmar)"
          : recharge.credits == null
            ? "fora da tabela"
            : `🎁 ${recharge.credits} créditos`;

      return [
        `*${index + 1}. ${recharge.transactionId || recharge.key}*`,
        `   ├ 💰 ${recharge.amount} MT (${recharge.providerLabel})`,
        `   ├ 👤 @${String(recharge.senderLid).split("@")[0]}`,
        `   ├ ${entrega}`,
        `   ├ 🕒 Enviado: ${formatarHora(recharge.createdAt)}`,
        `   └ ⌛ Expira: ${formatarHora(recharge.expiresAt)}`,
      ];
    });

    await sendReply(
      panelMessage({
        icone: "💳",
        titulo: `Recargas pendentes (${pendentes.length})`,
        campos: [
          ...campos,
          "",
          `✅ Confirmar: *${PREFIX}recarga-confirmar <id>*`,
          `⭐ Forçar assinatura: *${PREFIX}recarga-confirmar <id> assinatura*`,
          `🚫 Recusar: *${PREFIX}recarga-recusar <id>*`,
        ],
      }),
    );
  },
};
