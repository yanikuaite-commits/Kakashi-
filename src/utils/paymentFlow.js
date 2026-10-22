/**
 * Fluxo de recarga por pagamento (e-mola / m-pesa).
 *
 * Quando um membro reencaminha o SMS do pagamento para o grupo:
 *
 *   1. o SMS é lido (`parsePaymentSms`) e validado contra os números que o bot
 *      recebe (`PAYMENT_E_MOLA_NUMBER` / `PAYMENT_M_PESA_NUMBER`);
 *   2. a tabela de créditos é enviada ao grupo, para o usuário ver o que o
 *      valor dele dá;
 *   3. o grupo recebe o aviso de que o dono tem de confirmar;
 *   4. o dono recebe no privado os dados da transação (id, valor, número, nome
 *      e hora) numa lista interativa de confirmar/recusar, válida 10 horas;
 *   5. passadas as 10 horas sem resposta, a transação caduca e o usuário é
 *      avisado para enviar de novo.
 *
 * Nada é creditado automaticamente: quem confirma o dinheiro é o dono.
 *
 * @author Dev Gui
 */
import { CREDITS_TIMEZONE, MAIN_MENU_OWNER_NUMBER, PAYMENT_CONFIRM_TTL_MS, PAYMENT_E_MOLA_NUMBER, PAYMENT_M_PESA_NUMBER, PREFIX } from "../config.js";
import {
  createInteractiveActionId,
  sendInteractiveWithFallback,
} from "./interactive.js";
import { errorLog, infoLog } from "./logger.js";
import { PROVIDER_EMOLA, parsePaymentSms, providerLabel } from "./paymentText.js";
import { sendTabela } from "./richTable.js";
import {
  creditsForAmount,
  expireRecharges,
  listPendingRecharges,
  registerPendingRecharge,
} from "../services/recharges.js";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** JID privado do dono, a partir do número configurado no menu principal. */
export function ownerPrivateJid(numero = MAIN_MENU_OWNER_NUMBER) {
  const digitos = String(numero || "").replace(/\D/g, "");
  return digitos ? `${digitos}@s.whatsapp.net` : "";
}

/** O destinatário do SMS é um dos números que o bot recebe? */
export function isKnownPaymentDestination({ provider, destination }) {
  const esperado =
    provider === PROVIDER_EMOLA ? PAYMENT_E_MOLA_NUMBER : PAYMENT_M_PESA_NUMBER;

  const limpo = String(destination || "").replace(/\D/g, "");
  const alvo = String(esperado || "").replace(/\D/g, "");

  return Boolean(limpo && alvo && limpo === alvo);
}

function formatarHora(dateTime) {
  if (!dateTime) return "Não informada";

  const data = new Date(dateTime);
  if (Number.isNaN(data.getTime())) return "Não informada";

  // O SMS traz a hora local de Moçambique; mostrar em UTC daria 2h a menos.
  const partes = new Intl.DateTimeFormat("pt-PT", {
    timeZone: CREDITS_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(data);

  const valor = (tipo) => partes.find((p) => p.type === tipo)?.value || "";

  return `${valor("day")}/${valor("month")}/${valor("year")} ${valor("hour")}:${valor("minute")}`;
}

/** Ficha da transação, como o dono a vê no privado. */
export function rechargeOwnerMessage(recharge) {
  const creditos =
    recharge.credits == null
      ? "⚠️ Valor fora da tabela — define os créditos na confirmação"
      : `${recharge.credits} créditos`;

  return [
    "💳 *NOVO PAGAMENTO PARA CONFIRMAR*",
    "",
    `🔖 Transação: ${recharge.transactionId || recharge.key}`,
    `📱 Operador: ${recharge.providerLabel}`,
    `💰 Valor: ${recharge.amount} MT`,
    recharge.fee == null ? null : `🧾 Taxa: ${recharge.fee} MT`,
    `🎯 Destino: ${recharge.destination || "—"}`,
    `👤 Nome no SMS: ${recharge.name || "—"}`,
    `🕒 Hora do SMS: ${formatarHora(recharge.smsDateTime)}`,
    "",
    `🙋 Enviado por: ${recharge.senderName || recharge.senderLid}`,
    `🆔 ID do usuário: ${String(recharge.senderLid).split("@")[0]}`,
    `📥 Chat: ${recharge.chatId || "—"}`,
    "",
    `🎁 Créditos a adicionar: ${creditos}`,
    "",
    `⏳ Tens ${Math.round(PAYMENT_CONFIRM_TTL_MS / (60 * 60 * 1000))} horas para confirmar ou recusar. ` +
      "Depois disso a transação é cancelada e o usuário tem de enviar de novo.",
  ]
    .filter((linha) => linha !== null)
    .join("\n");
}

/** Mensagem enviada ao grupo quando o pagamento é detetado. */
export function rechargeGroupMessage({ recharge, senderLid }) {
  const creditos =
    recharge.credits == null
      ? "valor a confirmar pelo dono"
      : `${recharge.credits} créditos`;

  return [
    "✅ *Pagamento recebido!*",
    "",
    `💰 Valor: ${recharge.amount} MT`,
    `📱 Operador: ${recharge.providerLabel}`,
    `🎁 Créditos: ${creditos}`,
    `🔖 Transação: ${recharge.transactionId || "—"}`,
    "",
    "⏳ O dono foi avisado e vai confirmar o pagamento. Assim que confirmar, os créditos entram na tua conta.",
    "",
    `📊 Vê a tua conta com *${PREFIX}conta*`,
  ].join("\n");
}

/** Aviso de caducidade enviado ao usuário. */
export function rechargeExpiredMessage() {
  return [
    "⌛ *O teu pagamento não foi confirmado a tempo.*",
    "",
    "A transação foi cancelada após 10 horas sem confirmação do dono.",
    "",
    "📤 Envia o SMS do pagamento novamente para eu abrir um novo pedido.",
    `📋 Confere os valores com *${PREFIX}tabela*`,
  ].join("\n");
}

/**
 * Envia ao dono a lista interativa de confirmar/recusar.
 *
 * As linhas levam tokens `kmenu:` e o mapeamento para o comando de dono, pelo
 * mesmo despacho dos outros menus. A lista dura 10 horas.
 */
async function notifyOwner({ socket, recharge }) {
  const ownerJid = ownerPrivateJid();

  if (!ownerJid) {
    errorLog("[pagamento] MAIN_MENU_OWNER_NUMBER não configurado; dono não avisado.");
    return false;
  }

  const confirmar = createInteractiveActionId();
  const recusar = createInteractiveActionId();

  const content = {
    text: rechargeOwnerMessage(recharge),
    title: "Confirmar recarga",
    footer: "Kakashi Bot",
    buttonText: "Decidir",
    sections: [
      {
        title: "O que queres fazer?",
        rows: [
          {
            title: "✅ Confirmar pagamento",
            description: "Adiciona os créditos ao usuário",
            rowId: confirmar,
          },
          {
            title: "❌ Recusar pagamento",
            description: "Cancela a transação",
            rowId: recusar,
          },
        ],
      },
    ],
    viewOnce: true,
  };

  await sendInteractiveWithFallback({
    socket,
    chatId: ownerJid,
    content,
    fallbackText: [
      "Responde com *1* para confirmar ou *2* para recusar:",
      "",
      `1. Confirmar (${PREFIX}recarga-confirmar ${recharge.key})`,
      `2. Recusar (${PREFIX}recarga-recusar ${recharge.key})`,
    ].join("\n"),
    fallbackActions: [
      { number: "1", id: `${PREFIX}recarga-confirmar ${recharge.key}` },
      { number: "2", id: `${PREFIX}recarga-recusar ${recharge.key}` },
    ],
    responseMappings: [
      { id: confirmar, target: `${PREFIX}recarga-confirmar ${recharge.key}` },
      { id: recusar, target: `${PREFIX}recarga-recusar ${recharge.key}` },
    ],
    ownerId: ownerJid,
    ttlMs: PAYMENT_CONFIRM_TTL_MS,
    sendReply: async (text) => socket.sendMessage(ownerJid, { text }),
  });

  return true;
}

/**
 * Trata um SMS de pagamento recebido num chat.
 *
 * Devolve `true` quando a mensagem foi tratada como pagamento (o pipeline deve
 * parar de a processar como texto normal).
 *
 * @param {{socket: object, chatId: string, senderLid: string, senderName?: string, text: string, sendReply?: Function}} params
 * @returns {Promise<boolean>}
 */
export async function handlePaymentSms({
  socket,
  chatId,
  senderLid,
  senderName = "",
  text,
  sendReply,
}) {
  let sms;

  try {
    sms = parsePaymentSms(text);
  } catch (error) {
    errorLog(`[pagamento] falha ao ler o SMS: ${error.message}`);
    return false;
  }

  if (!sms) return false;

  if (!isKnownPaymentDestination(sms)) {
    infoLog(
      `[pagamento] SMS para ${sms.destination} ignorado (não é um número do bot).`,
    );
    return false;
  }

  const registo = registerPendingRecharge({
    ...sms,
    senderLid,
    senderName,
    chatId,
    credits: creditsForAmount(sms.amount),
  });

  if (!registo.ok) {
    if (registo.reason === "duplicado") {
      await sendReply?.(
        "⏳ Este pagamento já está à espera de confirmação do dono. Aguarda, por favor.",
      );
      return true;
    }

    if (registo.reason === "confirmed" || registo.reason === "declined") {
      await sendReply?.("ℹ️ Este pagamento já foi tratado pelo dono.");
      return true;
    }

    return false;
  }

  infoLog(
    `[pagamento] ${registo.recharge.providerLabel} ${registo.recharge.amount} MT de ${senderLid} ` +
      `(${registo.recharge.transactionId || registo.recharge.key})`,
  );

  // Tabela de créditos + aviso no grupo, depois o pedido ao dono.
  await sendTabela({
    socket,
    remoteJid: chatId,
    sendReply,
    id: "creditos",
  }).catch((error) => errorLog(`[pagamento] falha ao enviar a tabela: ${error.message}`));

  await sendReply?.(
    rechargeGroupMessage({ recharge: registo.recharge, senderLid }),
  ).catch?.(() => {});

  await notifyOwner({ socket, recharge: registo.recharge }).catch((error) =>
    errorLog(`[pagamento] falha ao avisar o dono: ${error.message}`),
  );

  return true;
}

/**
 * Verifica periodicamente as transações fora do prazo e avisa os usuários.
 *
 * O temporizador do menu é uma garantia fraca (um pedido novo substitui-o),
 * por isso a caducidade é confirmada aqui, no chat onde o SMS foi enviado.
 */
export function startRechargeSweeper(socket) {
  const varrer = async () => {
    let expiradas = [];

    try {
      expiradas = expireRecharges();
    } catch (error) {
      errorLog(`[pagamento] falha ao caducar transações: ${error.message}`);
      return;
    }

    for (const recharge of expiradas) {
      if (!recharge.chatId) continue;

      try {
        await socket.sendMessage(recharge.chatId, {
          text: rechargeExpiredMessage(),
          mentions: recharge.senderLid ? [recharge.senderLid] : [],
        });
      } catch (error) {
        errorLog(
          `[pagamento] falha ao avisar ${recharge.senderLid}: ${error.message}`,
        );
      }
    }
  };

  const timer = setInterval(varrer, SWEEP_INTERVAL_MS);
  timer.unref?.();
  varrer().catch(() => {});

  return timer;
}

export { listPendingRecharges };
