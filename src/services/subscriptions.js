/**
 * Assinaturas diárias (planos por dias).
 *
 * COMO FUNCIONA: um plano paga-se uma vez e devolve `bonus` créditos EXTRA por
 * dia, somados aos créditos gratuitos, durante `dias` dias seguidos. Um plano de
 * 7 dias com `bonus: 40` rende 30 (grátis) + 40 = 70 créditos por dia, todos os
 * dias, até o 7.º dia.
 *
 * O bónus NÃO é creditado de uma vez: é somado ao reset diário das 00h00
 * (`src/services/credits.js`), que é o único sítio que escreve `dailyCredits`.
 * Creditá-lo de uma vez daria o total no primeiro dia e zero nos seguintes —
 * exatamente o contrário de uma assinatura.
 *
 * Este módulo é só estado e aritmética: não credita nem fala com o WhatsApp. O
 * `credits.js` pergunta-lhe `dailySubscriptionBonus`, e quem ativa é o fluxo de
 * pagamento (`src/services/recharges.js`), depois de o dono confirmar.
 *
 * @author Dev Yanik
 */
import { readSubscriptions, saveSubscriptions } from "../utils/database.js";
import { mozambiqueDay } from "../utils/clock.js";
import { TABELAS } from "../utils/tabelaPrecos.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Chave estável de um plano ("7d", "14d", ...). */
export function planKey(plan) {
  return `${Number(plan?.dias) || 0}d`;
}

/** Planos de assinatura, na ordem da tabela. */
export function subscriptionPlans() {
  return TABELAS.dias.valores.map((plano) => ({ ...plano }));
}

/**
 * Plano pelo número de dias.
 *
 * @param {number|string} dias
 * @returns {{dias: number, mt: number, bonus: number}|null}
 */
export function planByDays(dias) {
  const alvo = Number(dias);
  const plano = TABELAS.dias.valores.find((item) => Number(item.dias) === alvo);

  return plano ? { ...plano } : null;
}

/**
 * Plano pelo valor pago.
 *
 * Devolve `null` quando o valor não é de um plano. Um valor que existe nas duas
 * tabelas (20 MT) é ambíguo e resolvido pelo fluxo de pagamento, não aqui.
 *
 * @param {number} mt
 * @returns {{dias: number, mt: number, bonus: number}|null}
 */
export function planByAmount(mt) {
  const valor = Number(mt);

  if (!Number.isFinite(valor) || valor <= 0) return null;

  const plano = TABELAS.dias.valores.find((item) => Number(item.mt) === valor);

  return plano ? { ...plano } : null;
}

/**
 * Valor que existe nas duas tabelas (créditos e assinatura).
 *
 * 20 MT dá 65 créditos avulso ou 7 dias de assinatura — o único valor nas duas
 * tabelas. Nesse caso o bot pergunta o que o utilizador quer.
 *
 * @param {number} mt
 * @returns {boolean}
 */
export function isAmbiguousAmount(mt) {
  const valor = Number(mt);

  if (!Number.isFinite(valor) || valor <= 0) return false;

  const emCreditos = TABELAS.creditos.valores.some(
    (item) => Number(item.mt) === valor,
  );
  const emDias = TABELAS.dias.valores.some((item) => Number(item.mt) === valor);

  return emCreditos && emDias;
}

/**
 * Dia de Moçambique resultante de somar dias a um dia ("AAAA-MM-DD").
 *
 * @param {string} day
 * @param {number} days
 * @returns {string}
 */
export function addDaysToDay(day, days) {
  const base = Date.parse(`${day}T00:00:00Z`);

  if (!Number.isFinite(base)) return day;

  return new Date(base + Number(days) * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * A assinatura ainda cobre este dia?
 *
 * O intervalo é `[startDay, expiresDay[` — o dia de ativação conta como o
 * primeiro dia, e o dia de expiração já não recebe bónus. É isso que faz um
 * plano de 7 dias render exatamente 7 dias.
 *
 * @param {{startDay: string, expiresDay: string, active?: boolean}} subscription
 * @param {string} day
 * @returns {boolean}
 */
export function coversDay(subscription, day) {
  if (!subscription || subscription.active === false) return false;

  const { startDay, expiresDay } = subscription;
  if (!startDay || !expiresDay) return false;

  return day >= startDay && day < expiresDay;
}

/**
 * Assinatura de um usuário, já com a expiração aplicada.
 *
 * Uma assinatura fora do prazo é marcada como inativa na leitura, para o estado
 * guardado não ficar a mentir e o bónus parar sozinho.
 *
 * @param {string} jid
 * @param {number} [now]
 * @returns {object|null}
 */
export function getSubscription(jid, now = Date.now()) {
  const subscriptions = readSubscriptions();
  const atual = subscriptions[jid];

  if (!atual) return null;

  const day = mozambiqueDay(now);

  if (atual.active !== false && day >= (atual.expiresDay || "")) {
    atual.active = false;
    atual.expiredAt = new Date(now).toISOString();
    subscriptions[jid] = atual;
    saveSubscriptions(subscriptions);
  }

  return { ...atual };
}

/**
 * Créditos de bónus que a assinatura dá NESTE dia (0 sem assinatura ativa).
 *
 * @param {string} jid
 * @param {number} [now]
 * @returns {number}
 */
export function dailySubscriptionBonus(jid, now = Date.now()) {
  const assinatura = getSubscription(jid, now);

  if (!assinatura) return 0;

  return coversDay(assinatura, mozambiqueDay(now))
    ? Math.max(0, Number(assinatura.bonus) || 0)
    : 0;
}

/** Total de créditos de bónus que o plano ainda vai pagar, hoje incluído. */
export function remainingBonus(subscription, now = Date.now()) {
  if (!subscription) return 0;

  const hoje = mozambiqueDay(now);
  const bonus = Math.max(0, Number(subscription.bonus) || 0);

  if (!coversDay(subscription, hoje)) return 0;

  const fim = subscription.expiresDay;
  let dias = 0;
  let dia = hoje;

  while (dia < fim) {
    dias += 1;
    dia = addDaysToDay(dia, 1);
  }

  return dias * bonus;
}

/** Dias que faltam até a assinatura acabar (0 quando já acabou). */
export function daysRemaining(subscription, now = Date.now()) {
  if (!subscription) return 0;

  const hoje = mozambiqueDay(now);

  if (!coversDay(subscription, hoje)) return 0;

  let dias = 0;
  let dia = hoje;

  while (dia < subscription.expiresDay) {
    dias += 1;
    dia = addDaysToDay(dia, 1);
  }

  return dias;
}

/**
 * Ativa (ou renova) a assinatura de um usuário.
 *
 * Renovar com uma assinatura ativa SOMA o novo plano ao fim do atual, em vez de
 * o substituir: quem paga 7 dias a meio de um plano de 30 não pode perder os
 * dias que já pagou. O bónus do plano novo passa a valer a partir do dia em que
 * o antigo acaba.
 *
 * Devolve o registo guardado e a informação de que o fluxo de pagamento precisa
 * para creditar o bónus do dia da ativação.
 *
 * @param {string} jid
 * @param {{dias: number, mt: number, bonus: number}} plan
 * @param {{now?: number, note?: string}} [options]
 * @returns {{ok: boolean, subscription: object, bonusToday: number, extended: boolean}}
 */
export function activateSubscription(
  jid,
  plan,
  { now = Date.now(), note = "" } = {},
) {
  const plano = { dias: Number(plan?.dias) || 0, mt: Number(plan?.mt) || 0, bonus: Number(plan?.bonus) || 0 };

  if (!jid || plano.dias <= 0) {
    return { ok: false, subscription: null, bonusToday: 0, extended: false };
  }

  const subscriptions = readSubscriptions();
  const atual = subscriptions[jid] || null;
  const hoje = mozambiqueDay(now);
  const aindaVale = coversDay(atual, hoje);
  const extended = Boolean(aindaVale);

  // Renovação a meio de um plano: começa quando o antigo acaba. Sem assinatura
  // ativa, começa hoje.
  const startDay = aindaVale ? atual.expiresDay : hoje;
  const expiresDay = addDaysToDay(startDay, plano.dias);

  const registo = {
    jid,
    plan: planKey(plano),
    days: plano.dias,
    bonus: plano.bonus,
    mt: plano.mt,
    startDay,
    expiresDay,
    active: true,
    createdAt: atual?.createdAt || new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    activatedAt: new Date(now).toISOString(),
    history: [
      {
        plan: planKey(plano),
        days: plano.dias,
        bonus: plano.bonus,
        mt: plano.mt,
        note: String(note || "").slice(0, 80),
        at: new Date(now).toISOString(),
      },
      ...(Array.isArray(atual?.history) ? atual.history : []),
    ].slice(0, 10),
  };

  subscriptions[jid] = registo;
  saveSubscriptions(subscriptions);

  // O bónus do dia da ativação é creditado já (o reset diário das 00h00 só
  // corre no dia seguinte). Numa renovação a meio do plano, o plano novo ainda
  // não começou, pelo que não há nada a creditar hoje.
  return {
    ok: true,
    subscription: registo,
    bonusToday: extended ? 0 : plano.bonus,
    extended,
  };
}

/** Remove a assinatura (usado pelo dono, para cancelar). */
export function cancelSubscription(jid, { now = Date.now() } = {}) {
  const subscriptions = readSubscriptions();

  if (!subscriptions[jid]) return { ok: false };

  subscriptions[jid].active = false;
  subscriptions[jid].cancelledAt = new Date(now).toISOString();
  saveSubscriptions(subscriptions);

  return { ok: true, subscription: { ...subscriptions[jid] } };
}

/** Assinaturas ativas (usado pelo painel do dono). */
export function listActiveSubscriptions(now = Date.now()) {
  return Object.values(readSubscriptions())
    .filter((assinatura) => coversDay(assinatura, mozambiqueDay(now)))
    .map((assinatura) => ({ ...assinatura }));
}
