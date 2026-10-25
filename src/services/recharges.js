/**
 * Recargas por pagamento (e-mola / m-pesa).
 *
 * Fluxo:
 *
 *   1. o usuário reencaminha o SMS do pagamento para o bot;
 *   2. `parsePaymentSms` lê os campos e `registerPendingRecharge` guarda a
 *      transação pendente, associada a quem a enviou;
 *   3. o dono recebe o pedido no privado e confirma ou recusa;
 *   4. confirmado, os créditos entram na conta; recusado ou passadas 10 horas,
 *      a transação caduca e o usuário tem de enviar de novo.
 *
 * Nada é creditado automaticamente: o dinheiro é confirmado pelo dono. Uma
 * transação só é aceite uma vez (o id é a chave), para o mesmo SMS não pagar
 * créditos duas vezes.
 *
 * @author Dev Gui
 */
import { PAYMENT_CONFIRM_TTL_MS } from "../config.js";
import {
  readPendingRecharges,
  savePendingRecharges,
} from "../utils/database.js";
import { providerLabel } from "../utils/paymentText.js";
import { TABELAS } from "../utils/tabelaPrecos.js";
import { addCredits, addDailyBonus, getAccount } from "./credits.js";
import {
  activateSubscription,
  isAmbiguousAmount,
  planByAmount,
} from "./subscriptions.js";

const STATUS_PENDING = "pending";
const STATUS_CONFIRMED = "confirmed";
const STATUS_DECLINED = "declined";
const STATUS_EXPIRED = "expired";

/** Estado final: não se confirma nem se recusa duas vezes. */
const FINAL_STATUSES = new Set([STATUS_CONFIRMED, STATUS_DECLINED, STATUS_EXPIRED]);

/**
 * Chave da transação. Quando o SMS não traz id, usa-se uma assinatura dos
 * campos, para que o mesmo SMS reenviado não abra dois pedidos.
 */
export function rechargeKey({ transactionId, provider, amount, destination }) {
  if (transactionId) return String(transactionId);

  return [provider, amount, destination]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .join("|");
}

/** Créditos correspondentes a um valor pago, pela tabela de créditos. */
export function creditsForAmount(mt) {
  const valor = Number(mt);

  if (!Number.isFinite(valor) || valor <= 0) return null;

  const pacote = TABELAS.creditos.valores.find((item) => Number(item.mt) === valor);

  return pacote ? Number(pacote.creditos) : null;
}

/**
 * O que um valor compra, ANTES de o utilizador decidir.
 *
 * Três casos:
 *
 * - `"creditos"` — valor só na tabela de créditos (5, 10, 30 e 50 MT): segue direto;
 * - `"assinatura"` — valor só na tabela de dias (45, 60, 90 e 140 MT): segue direto;
 * - `"escolha"` — valor nas DUAS tabelas (20 MT, o único): o bot pergunta se o
 *   utilizador quer créditos avulso ou assinatura, porque 20 MT tanto dá 65
 *   créditos como 7 dias de assinatura.
 *
 * @param {number} mt
 * @returns {"creditos"|"assinatura"|"escolha"|null}
 */
export function paymentIntent(mt) {
  const valor = Number(mt);

  if (!Number.isFinite(valor) || valor <= 0) return null;

  const temCreditos = creditsForAmount(valor) !== null;
  const temPlano = planByAmount(valor) !== null;

  if (temCreditos && temPlano) return "escolha";
  if (temPlano) return "assinatura";
  if (temCreditos) return "creditos";

  return null;
}

/**
 * Detalhes do plano de assinatura de um valor (para a mensagem do grupo).
 *
 * @param {number} mt
 * @returns {{dias: number, mt: number, bonus: number}|null}
 */
export function planForAmount(mt) {
  return planByAmount(mt);
}

export { isAmbiguousAmount };

/** Prune: apaga transações antigas já fechadas, para o ficheiro não crescer. */
function pruneRecharges(recharges, now) {
  for (const [key, recharge] of Object.entries(recharges)) {
    const fechada = FINAL_STATUSES.has(recharge.status);
    const idade = now - Date.parse(recharge.createdAt || 0);

    if (fechada && idade > 7 * 24 * 60 * 60 * 1000) {
      delete recharges[key];
    }
  }

  return recharges;
}

function readAll() {
  return readPendingRecharges() || {};
}

/**
 * Registra uma transação pendente a partir dos dados do SMS.
 *
 * @param {{transactionId?: string, provider: string, amount: number, fee?: number|null, destination?: string|null, name?: string|null, dateTime?: string|null, senderLid: string, senderName?: string, chatId?: string, credits?: number|null, now?: number}} data
 * @returns {{ok: boolean, reason?: string, recharge?: object}}
 */
export function registerPendingRecharge({
  transactionId,
  provider,
  amount,
  fee = null,
  destination = null,
  name = null,
  dateTime = null,
  senderLid,
  senderName = "",
  chatId = "",
  credits = null,
  kind = "creditos",
  plan = null,
  now = Date.now(),
}) {
  if (!senderLid) return { ok: false, reason: "sem-autor" };

  const key = rechargeKey({ transactionId, provider, amount, destination });
  const recharges = pruneRecharges(readAll(), now);
  const existente = recharges[key];

  // Reenvio do mesmo SMS: devolve o pedido que já existe, sem duplicar.
  if (existente) {
    if (existente.status === STATUS_PENDING) {
      return { ok: true, reason: "duplicado", recharge: existente };
    }

    return { ok: false, reason: existente.status, recharge: existente };
  }

  const recharge = {
    key,
    transactionId: transactionId || null,
    provider,
    providerLabel: providerLabel(provider),
    amount: Number(amount),
    fee: fee == null ? null : Number(fee),
    destination: destination || null,
    name: name || null,
    smsDateTime: dateTime || null,
    credits: credits == null ? null : Number(credits),
    // "creditos" = recarga avulsa; "assinatura" = plano por dias (bónus diário).
    kind: kind === "assinatura" ? "assinatura" : "creditos",
    plan: plan ? { ...plan } : null,
    senderLid,
    senderName: String(senderName || "").slice(0, 40),
    chatId: chatId || "",
    status: STATUS_PENDING,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PAYMENT_CONFIRM_TTL_MS).toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  };

  recharges[key] = recharge;
  savePendingRecharges(recharges);

  return { ok: true, recharge };
}

/** Recarrega pelo id da transação. */
export function getPendingRecharge(key) {
  return readAll()[String(key || "")] || null;
}

/** Transações ainda pendentes e dentro do prazo. */
export function listPendingRecharges({ now = Date.now() } = {}) {
  return Object.values(readAll()).filter(
    (recharge) =>
      recharge.status === STATUS_PENDING &&
      Date.parse(recharge.expiresAt || 0) > now,
  );
}

/** Transações pendentes mas já fora do prazo (o dono não confirmou a tempo). */
export function listExpiredRecharges({ now = Date.now() } = {}) {
  return Object.values(readAll()).filter(
    (recharge) =>
      recharge.status === STATUS_PENDING &&
      Date.parse(recharge.expiresAt || 0) <= now,
  );
}

function resolve(key, status, { by = null, now = Date.now() } = {}) {
  const recharges = readAll();
  const recharge = recharges[key];

  if (!recharge) return { ok: false, reason: "nao-encontrada" };
  if (FINAL_STATUSES.has(recharge.status)) {
    return { ok: false, reason: recharge.status, recharge };
  }

  recharge.status = status;
  recharge.resolvedAt = new Date(now).toISOString();
  recharge.resolvedBy = by;

  recharges[key] = recharge;
  savePendingRecharges(recharges);

  return { ok: true, recharge };
}

/**
 * Confirma a recarga e credita o usuário.
 *
 * A confirmação e o crédito são atómicos do ponto de vista do ficheiro: a
 * transação fica fechada antes de creditar, por isso um clique repetido não
 * credita duas vezes.
 *
 * @returns {{ok: boolean, reason?: string, recharge?: object, credited?: number}}
 */
export function confirmRecharge(
  key,
  { credits = null, by = null, now = Date.now(), kind = null } = {},
) {
  const atual = getPendingRecharge(key);

  if (!atual) return { ok: false, reason: "nao-encontrada" };
  if (atual.status !== STATUS_PENDING) {
    return { ok: false, reason: atual.status, recharge: atual };
  }
  if (Date.parse(atual.expiresAt || 0) <= now) {
    resolve(key, STATUS_EXPIRED, { now });
    return { ok: false, reason: STATUS_EXPIRED, recharge: atual };
  }

  // O dono pode converter uma compra ambígua (20 MT) no momento de confirmar:
  // se o utilizador respondeu "1" ou "2" no grupo, o pedido chega aqui com o
  // `kind` já resolvido. Sem indicação, vale o que o registo guardou.
  const tipo = kind === "assinatura" || kind === "creditos" ? kind : atual.kind || "creditos";

  if (tipo === "assinatura") {
    const plano = atual.plan || planByAmount(atual.amount);

    if (!plano) {
      return { ok: false, reason: "sem-plano", recharge: atual };
    }

    const fechado = resolve(key, STATUS_CONFIRMED, { by, now });
    if (!fechado.ok) return fechado;

    const ativacao = activateSubscription(atual.senderLid, plano, {
      now,
      note: `${atual.providerLabel} ${atual.amount} MT`,
    });

    if (!ativacao.ok) {
      return { ok: false, reason: "sem-plano", recharge: atual };
    }

    // O bónus do dia da compra é creditado já: o reset das 00h00 só corre
    // amanhã, e sem isto o primeiro dia seria o único sem bónus. Quando a conta
    // ainda não existia, ela nasce já com o bónus incluído e a soma aqui é
    // zero — o utilizador recebe-o de qualquer forma, por isso o valor
    // reportado é o do plano, não o que esta chamada somou.
    addDailyBonus(atual.senderLid, ativacao.bonusToday, { now });

    return {
      ok: true,
      recharge: fechado.recharge,
      credited: ativacao.bonusToday,
      kind: "assinatura",
      subscription: ativacao.subscription,
      extended: ativacao.extended,
    };
  }

  const quantidade = Number(credits ?? atual.credits ?? 0);

  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return { ok: false, reason: "sem-creditos", recharge: atual };
  }

  const fechado = resolve(key, STATUS_CONFIRMED, { by, now });
  if (!fechado.ok) return fechado;

  addCredits(atual.senderLid, quantidade, {
    note: `${atual.providerLabel} ${atual.amount} MT`,
    now,
  });

  return { ok: true, recharge: fechado.recharge, credited: quantidade, kind: "creditos" };
}

/** Recusa a recarga. */
export function declineRecharge(key, { by = null, now = Date.now() } = {}) {
  return resolve(key, STATUS_DECLINED, { by, now });
}

/**
 * Muda o que um pedido pendente entrega ("creditos" ou "assinatura").
 *
 * É o que permite ao utilizador responder "1" ou "2" depois de enviar um
 * pagamento de valor ambíguo (20 MT). Grava no PEDIDO, e não só na memória do
 * processo, porque o dono confirma mais tarde: `confirmRecharge` lê o `kind` do
 * registo e tem de encontrar a escolha lá.
 *
 * @param {string} key
 * @param {"creditos"|"assinatura"} kind
 * @returns {{ok: boolean, reason?: string, recharge?: object}}
 */
export function setRechargeKind(key, kind) {
  const tipo = kind === "assinatura" ? "assinatura" : "creditos";
  const recharges = readAll();
  const atual = recharges[String(key || "")];

  if (!atual) return { ok: false, reason: "nao-encontrada" };
  if (atual.status !== STATUS_PENDING) {
    return { ok: false, reason: atual.status, recharge: atual };
  }

  atual.kind = tipo;
  atual.plan = tipo === "assinatura" ? planByAmount(atual.amount) : null;

  // Assinatura escolhida num valor ambíguo: os "créditos" guardados (65, no caso
  // dos 20 MT) são da outra tabela e não se aplicam.
  if (tipo === "assinatura") atual.credits = null;

  recharges[atual.key] = atual;
  savePendingRecharges(recharges);

  return { ok: true, recharge: { ...atual } };
}

/**
 * Caduca as transações fora do prazo e devolve as que acabaram de expirar.
 * Chamado periodicamente para avisar o usuário.
 */
export function expireRecharges({ now = Date.now() } = {}) {
  const expiradas = listExpiredRecharges({ now });

  for (const recharge of expiradas) {
    resolve(recharge.key, STATUS_EXPIRED, { now });
  }

  return expiradas.map((recharge) => ({ ...recharge, status: STATUS_EXPIRED }));
}

/** Conta do usuário depois de uma recarga (para montar a resposta). */
export function rechargeAccount(senderLid) {
  return getAccount(senderLid);
}

export {
  STATUS_PENDING,
  STATUS_CONFIRMED,
  STATUS_DECLINED,
  STATUS_EXPIRED,
  PAYMENT_CONFIRM_TTL_MS,
};
