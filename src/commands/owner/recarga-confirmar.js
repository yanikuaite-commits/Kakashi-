import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import {
  confirmRecharge,
  creditsForAmount,
  getPendingRecharge,
} from "../../services/recharges.js";
import { accountBalance, getAccount } from "../../services/credits.js";
import { panelMessage } from "../../utils/formatMessage.js";
import { notifyRechargeConfirmed } from "../../utils/paymentFlow.js";

export default {
  name: "recarga-confirmar",
  description: "Confirma um pagamento e adiciona os créditos ao usuário",
  commands: ["recarga-confirmar", "confirmar-recarga", "confirmar-pagamento"],
  usage: `${PREFIX}recarga-confirmar <id da transação> [créditos]`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, sendReply, sendErrorReply, socket }) => {
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

    // Tipo da compra: o registo já traz "assinatura" ou "creditos". O dono pode
    // forçar o outro com "assinatura" ou "creditos" no comando — útil quando o
    // utilizador não respondeu à pergunta de um valor ambíguo (20 MT).
    const forcado = parts.find((part) => /^(assinatura|plano|creditos|credito)$/i.test(part));
    const kind = forcado
      ? /^(assinatura|plano)$/i.test(forcado)
        ? "assinatura"
        : "creditos"
      : null;

    // Créditos: os da tabela para o valor pago, ou o que o dono indicar
    // (para valores fora da tabela).
    const indicado = parts.filter((part) => /^\d+$/.test(part)).map(Number).pop();
    const credits = indicado || creditsForAmount(pendente.amount);
    const assinatura = (kind || pendente.kind) === "assinatura";

    if (!assinatura && !credits) {
      await sendErrorReply(
        `⚠️ O valor de ${pendente.amount} MT não está na tabela de créditos. ` +
          `Indica os créditos. Ex: ${PREFIX}recarga-confirmar ${key} 20`,
      );
      return;
    }

    const resultado = confirmRecharge(key, { credits, by: "dono", kind });

    if (!resultado.ok) {
      const motivo =
        resultado.reason === "confirmed"
          ? "já tinha sido confirmada"
          : resultado.reason === "declined"
            ? "já tinha sido recusada"
            : resultado.reason === "expired"
              ? "caducou (passaram mais de 10 horas)"
              : resultado.reason === "sem-plano"
                ? "o valor não corresponde a nenhum plano de dias"
                : resultado.reason;

      await sendErrorReply(`❌ Não confirmei a transação *${key}*: ${motivo}.`);
      return;
    }

    const saldoAtual = accountBalance(getAccount(pendente.senderLid));
    const plano = resultado.subscription;

    await sendReply(
      panelMessage({
        icone: resultado.kind === "assinatura" ? "⭐" : "✅",
        titulo:
          resultado.kind === "assinatura"
            ? "Assinatura confirmada"
            : "Recarga confirmada",
        campos: [
          `🔖 Transação: ${pendente.transactionId || key}`,
          `👤 Usuário: @${String(pendente.senderLid).split("@")[0]}`,
          `💰 Valor: ${pendente.amount} MT (${pendente.providerLabel})`,
          resultado.kind === "assinatura"
            ? `⭐ Plano: ${plano?.days} dias (+${plano?.bonus} créditos/dia)`
            : `➕ Créditos: ${resultado.credited}`,
          resultado.kind === "assinatura"
            ? `🎁 Bónus de hoje: +${resultado.credited} créditos`
            : "",
          resultado.kind === "assinatura" && plano?.expiresDay
            ? `📅 Válida até: ${plano.expiresDay}`
            : "",
          `💳 Saldo atual: ${saldoAtual} créditos`,
        ].filter(Boolean),
      }),
      [pendente.senderLid],
    );

    // O usuário é avisado no chat onde enviou o SMS: sem isto ele nunca sabe
    // que os créditos entraram. A tabela mostra quanto valem os próximos.
    await notifyRechargeConfirmed({
      socket,
      recharge: pendente,
      credited: resultado.credited,
      balance: saldoAtual,
      sendReply,
    }).catch(() => {});
  },
};
