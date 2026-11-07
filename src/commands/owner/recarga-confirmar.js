import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import {
  confirmRecharge,
  creditsForAmount,
  getPendingRecharge,
  vipPlanForAmount,
} from "../../services/recharges.js";
import { accountBalance, getAccount } from "../../services/credits.js";
import { generateVipCode } from "../../services/vipCodes.js";
import { panelMessage } from "../../utils/formatMessage.js";
import { notifyRechargeConfirmed } from "../../utils/paymentFlow.js";

export default {
  name: "recarga-confirmar",
  description: "Confirma um pagamento e adiciona créditos, dias ou gera código VIP",
  commands: ["recarga-confirmar", "confirmar-recarga", "confirmar-pagamento"],
  usage: `${PREFIX}recarga-confirmar <id da transação> [tipo/quantidade]`,
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

    const forcado = parts.find((part) => /^(assinatura|plano|creditos|credito|vip|aluguel)$/i.test(part));
    const kind = forcado
      ? /^(assinatura|plano)$/i.test(forcado)
        ? "assinatura"
        : /^(vip|aluguel)$/i.test(forcado)
          ? "vip"
          : "creditos"
      : null;

    const indicado = parts.filter((part) => /^\d+$/.test(part)).map(Number).pop();
    const credits = indicado || creditsForAmount(pendente.amount);
    const resolvedKind = kind || pendente.kind;
    const isVip = resolvedKind === "vip" || vipPlanForAmount(pendente.amount) !== null;
    const assinatura = resolvedKind === "assinatura";

    if (!assinatura && !isVip && !credits) {
      await sendErrorReply(
        `⚠️ O valor de ${pendente.amount} MT não está na tabela. ` +
          `Indica os créditos. Ex: ${PREFIX}recarga-confirmar ${key} 20`,
      );
      return;
    }

    // Processamento VIP
    if (isVip) {
      const vipPlan = vipPlanForAmount(pendente.amount);
      if (!vipPlan) {
        await sendErrorReply(`❌ Valor de ${pendente.amount} MT não corresponde a nenhum plano VIP válido.`);
        return;
      }

      // Fecha a transação
      const resultado = confirmRecharge(key, { by: "dono", kind: "vip" });
      if (!resultado.ok) {
        await sendErrorReply(`❌ Falha ao confirmar transação: ${resultado.reason}`);
        return;
      }

      // Gera o código VIP único
      const codigoVip = generateVipCode({
        plano: vipPlan.plano,
        dias: vipPlan.dias,
        buyerLid: pendente.senderLid,
      });

      // Envia o código em privado para o comprador
      try {
        await socket.sendMessage(pendente.senderLid, {
          text: `🔐 *SEU CÓDIGO VIP (ALUGUEL DE GRUPO)* 🔐\n\n` +
                `📦 *Plano:* ${vipPlan.plano} (${vipPlan.dias} dias)\n` +
                `🏷️ *Código de Ativação:* \`${codigoVip}\`\n\n` +
                `⚠️ *ATENÇÃO:* Este código é de **uso único** e pessoal. Não o partilhe com ninguém!\n\n` +
                `📌 *Como usar:*\n` +
                `1. Adicione o bot ao grupo desejado.\n` +
                `2. No chat do grupo, envie o comando:\n` +
                `   \`${PREFIX}validar ${codigoVip}\`\n\n` +
                `Obrigado pela preferência! ✨`
        });
      } catch (err) {
        console.error("Erro ao enviar código VIP em privado:", err);
      }

      await sendReply(
        panelMessage({
          icone: "👑",
          titulo: "Aluguel VIP Confirmado",
          campos: [
            `🔖 Transação: ${pendente.transactionId || key}`,
            `👤 Usuário: @${String(pendente.senderLid).split("@")[0]}`,
            `💰 Valor: ${pendente.amount} MT`,
            `🌟 Plano: ${vipPlan.plano} (${vipPlan.dias} dias)`,
            `🔑 Código gerado e enviado para o privado do comprador.`,
          ],
        }),
        [pendente.senderLid],
      );

      return;
    }

    // Fluxo normal de créditos ou assinatura...
    const resultado = confirmRecharge(key, { credits, by: "dono", kind: resolvedKind });

    if (!resultado.ok) {
      await sendErrorReply(`❌ Não confirmei a transação *${key}*: ${resultado.reason}.`);
      return;
    }

    const saldoAtual = accountBalance(getAccount(pendente.senderLid));
    const plano = resultado.subscription;

    await sendReply(
      panelMessage({
        icone: assinatura ? "⭐" : "✅",
        titulo: assinatura ? "Assinatura confirmada" : "Recarga confirmada",
        campos: [
          `🔖 Transação: ${pendente.transactionId || key}`,
          `👤 Usuário: @${String(pendente.senderLid).split("@")[0]}`,
          `💰 Valor: ${pendente.amount} MT (${pendente.providerLabel})`,
          assinatura
            ? `⭐ Plano: ${plano?.days} dias (+${plano?.bonus} créditos/dia)`
            : `➕ Créditos: ${resultado.credited}`,
          `💳 Saldo atual: ${saldoAtual} créditos`,
        ].filter(Boolean),
      }),
      [pendente.senderLid],
    );

    await notifyRechargeConfirmed({
      socket,
      recharge: pendente,
      credited: resultado.credited,
      balance: saldoAtual,
      sendReply,
    }).catch(() => {});
  },
};
