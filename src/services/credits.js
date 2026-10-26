/**
 * Sistema de créditos.
 *
 * Regras:
 * - Cada usuário recebe créditos gratuitos todos os dias, renovados às 00h00
 *   no horário de Moçambique (Africa/Maputo, UTC+2).
 * - Cada função de membro gasta créditos (ver COMMAND_CREDITS em config.js).
 * - Mídias longas/pesadas gastam créditos extras (duração ou tamanho do arquivo).
 * - Os créditos recarregados pelo dono (pagamento em dinheiro) não expiram:
 *   os créditos do dia são resetados à meia-noite e os recarregados permanecem.
 * - O dono do bot (OWNER_LID) não gasta créditos.
 *
 * A persistência fica em src/utils/database.js (arquivo database/credits.json).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  COMMAND_CREDITS,
  CREDITS_TIMEZONE,
  DAILY_FREE_CREDITS,
  DEFAULT_COMMAND_CREDITS,
  FREE_COMMANDS,
  MEDIA_CREDITS_BY_DURATION,
  MEDIA_CREDITS_BY_SIZE,
  OWNER_CONTACT,
  PREFIX,
} from "../config.js";
import {
  readCreditsAccounts,
  saveCreditsAccounts,
} from "../utils/database.js";
import { infoLog } from "../utils/logger.js";
import { mozambiqueClock, minutesUntilDailyReset } from "../utils/clock.js";
import { dailySubscriptionBonus, getSubscription, daysRemaining } from "./subscriptions.js";

// Reexportado: o relógio de Moçambique nasceu aqui e outros módulos (e testes)
// importam-no deste ficheiro. A implementação vive em `utils/clock.js` para as
// assinaturas a poderem usar sem criar um ciclo de importação.
export { mozambiqueClock, minutesUntilDailyReset };

/**
 * Normaliza um nome de comando para comparação (sem acentos, minúsculo,
 * apenas letras e números). Mesma regra usada nos comandos bloqueados.
 */
function normalizeCommandName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const freeCommands = new Set(FREE_COMMANDS.map(normalizeCommandName));

const commandCosts = new Map(
  Object.entries(COMMAND_CREDITS).map(([name, cost]) => [
    normalizeCommandName(name),
    Number(cost) || 0,
  ]),
);

function untilResetLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return hours > 0 ? `${hours}h ${rest}min` : `${rest}min`;
}

/** Custo em créditos de um comando resolvido (0 = isento). */
export function commandCost(command, commandName = "") {
  const officialName = normalizeCommandName(command?.name || commandName);

  if (freeCommands.has(officialName)) {
    return 0;
  }

  const candidates = [
    officialName,
    normalizeCommandName(commandName),
    ...(Array.isArray(command?.commands) ? command.commands : []),
  ]
    .map(normalizeCommandName)
    .filter(Boolean);

  for (const name of candidates) {
    if (commandCosts.has(name)) {
      return commandCosts.get(name);
    }
  }

  return DEFAULT_COMMAND_CREDITS;
}

/** Créditos extras de uma mídia: usa a duração quando informada, senão o tamanho. */
export function mediaExtraCredits({ bytes = 0, seconds = 0 } = {}) {
  const duration = Number(seconds) || 0;
  const size = Number(bytes) || 0;

  const tiers = duration > 0 ? MEDIA_CREDITS_BY_DURATION : MEDIA_CREDITS_BY_SIZE;
  const amount = duration > 0 ? duration : size;
  const key = duration > 0 ? "minSeconds" : "minBytes";

  let credits = 0;

  for (const tier of tiers) {
    if (amount >= tier[key]) {
      credits = tier.credits;
    }
  }

  return credits;
}

/** Saldo total (créditos do dia + créditos recarregados). */
export function accountBalance(account) {
  return (
    Math.max(0, Number(account?.dailyCredits) || 0) +
    Math.max(0, Number(account?.paidCredits) || 0)
  );
}

/**
 * O usuário tem créditos suficientes?
 *
 * Verificação explícita, para ser usada ANTES de executar uma função: a cobrança
 * de `chargeCredits` é a última palavra (é ela que debita), mas consultar o
 * saldo primeiro evita começar um download caro que depois não se pode pagar.
 *
 * @param {string} jid
 * @param {number} amount
 * @param {{ now?: number }} [options]
 * @returns {{ ok: boolean, cost: number, balance: number, account: object }}
 */
export function hasSufficientCredits(jid, amount, { now = Date.now() } = {}) {
  const account = getAccount(jid, now);
  const cost = Math.max(0, Math.ceil(Number(amount) || 0));
  const balance = accountBalance(account);

  return { ok: cost <= balance, cost, balance, account };
}

function dailyAllowance(jid, now) {
  return DAILY_FREE_CREDITS + dailySubscriptionBonus(jid, now);
}

function createAccount(jid, now) {
  const { day } = mozambiqueClock(now);
  const timestamp = new Date(now).toISOString();
  const bonus = dailySubscriptionBonus(jid, now);

  return {
    jid,
    dailyCredits: DAILY_FREE_CREDITS + bonus,
    paidCredits: 0,
    lastResetDay: day,
    lastResetAt: timestamp,
    // Dia cujo bónus de assinatura já está incluído em `dailyCredits`. Nasce
    // marcado quando a conta já entra com o bónus (compra no mesmo dia da
    // primeira utilização), senão `addDailyBonus` somaria o bónus duas vezes.
    subscriptionBonusDay: bonus > 0 ? day : "",
    totalSpent: 0,
    commandsUsed: 0,
    totalRecharged: 0,
    recharges: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Reset diário das 00h00 (Moçambique).
 *
 * O valor reposto inclui o bónus da assinatura: um plano ativo rende
 * `DAILY_FREE_CREDITS + bonus` todos os dias até acabar. É AQUI que o bónus é
 * pago — creditá-lo de uma vez na compra daria o total no primeiro dia e zero
 * nos seguintes, que é o contrário de uma assinatura.
 */
function applyDailyReset(account, now) {
  const { day } = mozambiqueClock(now);

  if (account.lastResetDay === day) {
    return false;
  }

  const bonus = dailySubscriptionBonus(account.jid, now);

  account.dailyCredits = DAILY_FREE_CREDITS + bonus;
  account.lastResetDay = day;
  account.lastResetAt = new Date(now).toISOString();
  account.subscriptionBonusDay = bonus > 0 ? day : "";

  return true;
}

export function saveAccount(account) {
  const accounts = readCreditsAccounts();

  accounts[account.jid] = {
    ...account,
    updatedAt: new Date().toISOString(),
  };

  saveCreditsAccounts(accounts);

  return accounts[account.jid];
}

/**
 * Conta do usuário, já com o reset diário aplicado (00h00 de Moçambique).
 */
export function getAccount(jid, now = Date.now()) {
  const accounts = readCreditsAccounts();
  const stored = accounts[jid];
  const account = { ...createAccount(jid, now), ...(stored || {}) };
  const reset = applyDailyReset(account, now);

  if (reset || !stored) {
    accounts[jid] = account;
    saveCreditsAccounts(accounts);
  }

  return account;
}

/**
 * Cobra créditos do usuário.
 *
 * @param {string} jid
 * @param {number} amount
 * @param {{ reason?: string, countUsage?: boolean, allowPartial?: boolean, now?: number }} options
 * @returns {{ ok: boolean, cost: number, charged: number, account: object }}
 */
export function chargeCredits(
  jid,
  amount,
  { reason = "comando", countUsage = false, allowPartial = false, now = Date.now() } = {},
) {
  const account = getAccount(jid, now);
  const cost = Math.max(0, Math.ceil(Number(amount) || 0));
  const balance = accountBalance(account);
  const charged = Math.min(cost, balance);

  if (!cost || (!allowPartial && charged < cost)) {
    return { ok: false, cost, charged: 0, account, reason };
  }

  const fromDaily = Math.min(account.dailyCredits, charged);

  account.dailyCredits -= fromDaily;
  account.paidCredits -= charged - fromDaily;
  account.totalSpent += charged;

  if (countUsage) {
    account.commandsUsed += 1;
  }

  return { ok: true, cost, charged, account: saveAccount(account), reason };
}

/** Devolve créditos gastos por um comando que falhou (melhor esforço). */
export function refundCredits(jid, amount, { now = Date.now() } = {}) {
  const account = getAccount(jid, now);
  const refund = Math.max(0, Math.ceil(Number(amount) || 0));

  if (!refund) {
    return account;
  }

  // O teto do dia inclui o bónus da assinatura: devolver até ao valor que o
  // reset repõe, senão um reembolso num plano ativo ficava preso em
  // `DAILY_FREE_CREDITS` e o bónus do dia perdia-se.
  const roomForDaily = Math.max(0, dailyAllowance(account.jid, now) - account.dailyCredits);
  const backToDaily = Math.min(refund, roomForDaily);

  account.dailyCredits += backToDaily;
  account.paidCredits += refund - backToDaily;
  account.totalSpent = Math.max(0, account.totalSpent - refund);
  account.commandsUsed = Math.max(0, account.commandsUsed - 1);

  return saveAccount(account);
}

/**
 * Credita o bónus do dia da ativação de uma assinatura.
 *
 * O reset diário das 00h00 só corre no dia seguinte, por isso o dia da compra
 * seria o único sem bónus. Aqui soma-se ao saldo do dia (não aos recarregados,
 * que não expiram): é o mesmo tipo de crédito que o reset vai repor amanhã.
 *
 * É IDEMPOTENTE por dia: se a conta já nasceu com o bónus de hoje (compra no
 * mesmo dia da primeira utilização, quando `createAccount` correu já com a
 * assinatura ativa), não soma outra vez. Sem isto, o primeiro dia de um plano
 * novo rendia o bónus a dobrar.
 *
 * @param {string} jid
 * @param {number} amount
 * @param {{now?: number}} [options]
 * @returns {{ok: boolean, credited: number, account: object}}
 */
export function addDailyBonus(jid, amount, { now = Date.now() } = {}) {
  const account = getAccount(jid, now);
  const bonus = Math.max(0, Math.ceil(Number(amount) || 0));

  if (!bonus) {
    return { ok: false, credited: 0, account };
  }

  const { day } = mozambiqueClock(now);

  if (account.subscriptionBonusDay === day) {
    return { ok: true, credited: 0, account };
  }

  account.dailyCredits += bonus;
  account.subscriptionBonusDay = day;

  return { ok: true, credited: bonus, account: saveAccount(account) };
}

/** Recarga feita pelo dono após pagamento em dinheiro (créditos não expiram). */
export function addCredits(jid, amount, { note = "", now = Date.now() } = {}) {
  const account = getAccount(jid, now);
  const credits = Math.max(0, Math.ceil(Number(amount) || 0));

  if (!credits) {
    return { ok: false, credits: 0, account };
  }

  account.paidCredits += credits;
  account.totalRecharged += credits;
  account.recharges = [
    {
      credits,
      note: String(note || "").slice(0, 80),
      at: new Date(now).toISOString(),
    },
    ...(Array.isArray(account.recharges) ? account.recharges : []),
  ].slice(0, 5);

  return { ok: true, credits, account: saveAccount(account) };
}

/**
 * Remove créditos de um usuário (ação do dono, tipicamente uma punição).
 *
 * A ordem é a mesma de `chargeCredits` — gasta o diário primeiro e só depois os
 * recarregados. Isso tem uma consequência que o dono precisa de saber: os
 * créditos do dia voltam no reset das 00h00, por isso remover até ao limite do
 * diário não é uma perda definitiva. Uma remoção duradoura tem de chegar aos
 * recarregados.
 *
 * Por omissão é estrito: pedir mais do que o saldo não remove nada, em vez de
 * zerar a conta em silêncio. `allowPartial` existe para o modo "tudo", onde
 * remover o que resta é exatamente o objetivo.
 *
 * @param {string} jid
 * @param {number} amount
 * @param {{ note?: string, allowPartial?: boolean, now?: number }} [options]
 * @returns {{ ok: boolean, removed: number, reason?: string, balance: number, account: object }}
 */
export function removeCredits(
  jid,
  amount,
  { note = "", allowPartial = false, now = Date.now() } = {},
) {
  const account = getAccount(jid, now);
  const credits = Math.max(0, Math.ceil(Number(amount) || 0));
  const balance = accountBalance(account);

  if (!credits) {
    return { ok: false, removed: 0, reason: "valor inválido", balance, account };
  }

  if (balance < credits && !allowPartial) {
    return { ok: false, removed: 0, reason: "saldo insuficiente", balance, account };
  }

  const removed = Math.min(credits, balance);
  const fromDaily = Math.min(Math.max(0, account.dailyCredits), removed);

  account.dailyCredits -= fromDaily;
  account.paidCredits -= removed - fromDaily;

  // Registo do que saiu, para uma reclamação de "os meus créditos
  // desapareceram" ter resposta.
  account.adjustments = [
    {
      removed,
      note: String(note || "").slice(0, 80),
      at: new Date(now).toISOString(),
    },
    ...(Array.isArray(account.adjustments) ? account.adjustments : []),
  ].slice(0, 5);

  return { ok: true, removed, balance, account: saveAccount(account) };
}

/**
 * Contexto da requisição: permite cobrar créditos dentro de serviços
 * (downloads, por exemplo) sem passar o jid por todas as camadas.
 */
const creditsContext = new AsyncLocalStorage();

export function withCreditsContext(jid, callback) {
  if (!jid) {
    return callback();
  }

  return creditsContext.run({ jid }, callback);
}

export function currentAccountJid() {
  return creditsContext.getStore()?.jid || null;
}

/**
 * Cobra os créditos extras de uma mídia baixada.
 * Só cobra quando existe um usuário no contexto (o dono não entra no contexto).
 */
export async function chargeMediaCredits({ command = "mídia", bytes = 0, seconds = 0 } = {}) {
  const jid = currentAccountJid();
  const extra = mediaExtraCredits({ bytes, seconds });

  if (!jid || !extra) {
    return 0;
  }

  const result = chargeCredits(jid, extra, {
    reason: `mídia:${command}`,
    allowPartial: true,
  });

  if (result.charged) {
    infoLog(
      `Créditos extras de mídia (${command}): ${result.charged} de ${extra} — ${jid}`,
    );
  }

  return result.charged;
}

export function ownerContactLine() {
  return OWNER_CONTACT
    ? `💬 Fale com o dono no privado para recarregar pagando:\n   https://wa.me/${OWNER_CONTACT}`
    : "💬 Sem créditos? Fale com o dono do bot no privado para recarregar pagando.";
}

/** Mensagem enviada quando o usuário tenta usar uma função sem créditos. */
export function creditsExhaustedMessage({ commandName, cost, account, prefix = PREFIX }) {
  return (
    `🚫 *Seus créditos acabaram!*\n\n` +
    `📌 Você tentou usar *${prefix}${String(commandName || "").replaceAll("-", " ")}* (${cost} crédito${cost === 1 ? "" : "s"}).\n` +
    `💰 Saldo atual: *${accountBalance(account)} créditos*\n` +
    `🕛 Seus créditos gratuitos voltam às *00h00* (horário de Moçambique).\n\n` +
    `${ownerContactLine()}\n\n` +
    `📊 Veja sua conta com *${prefix}conta*`
  );
}

/** Comando dono/detalhe da conta. */
export function accountMessage({ account, name = "Você", prefix = PREFIX, now = Date.now() }) {
  const id = String(account.jid || "").split("@")[0];
  const minutes = minutesUntilDailyReset(now);
  const recharges = Array.isArray(account.recharges) ? account.recharges : [];
  const assinatura = getSubscription(account.jid, now);
  const bonus = dailySubscriptionBonus(account.jid, now);
  const faltam = daysRemaining(assinatura, now);

  return (
    `╭━━━ 💳 *MINHA CONTA*\n` +
    `┃ 👤 Usuário: ${name}\n` +
    `┃ 🆔 ID: ${id}\n` +
    `┣━━━━━━━━━━━━━━━━━━\n` +
    `┃ 💰 *Saldo:* ${accountBalance(account)} créditos\n` +
    `┃ ├ 🎁 Diários grátis: ${Math.max(0, account.dailyCredits)}/${DAILY_FREE_CREDITS + bonus}\n` +
    `┃ └ 💎 Recarregados: ${Math.max(0, account.paidCredits)}\n` +
    (bonus > 0
      ? `┣━━━━━━━━━━━━━━━━━━\n` +
        `┃ ⭐ *Assinatura ativa:* +${bonus}/dia\n` +
        `┃ ├ Faltam: ${faltam} dia${faltam === 1 ? "" : "s"}\n` +
        `┃ └ O bónus renova sozinho às 00h00\n`
      : "") +
    `┣━━━━━━━━━━━━━━━━━━\n` +
    `┃ 📊 *Estatísticas*\n` +
    `┃ ├ Comandos usados: ${account.commandsUsed || 0}\n` +
    `┃ ├ Créditos gastos: ${account.totalSpent || 0}\n` +
    `┃ └ Créditos recarregados: ${account.totalRecharged || 0}` +
    (recharges.length
      ? `\n┃    └ Última recarga: +${recharges[0].credits}` +
        (recharges[0].note ? ` (${recharges[0].note})` : "")
      : "") +
    `\n┣━━━━━━━━━━━━━━━━━━\n` +
    `┃ 🕛 Reset diário: 00h00 (Moçambique)\n` +
    `┃    ├ Faltam: ${untilResetLabel(minutes)}\n` +
    `┃    └ Próximo dia: +${DAILY_FREE_CREDITS + bonus} créditos\n` +
    `┣━━━━━━━━━━━━━━━━━━\n` +
    `┃ ${ownerContactLine()}\n` +
    `┃ 📋 Tabela de custos: ${prefix}conta custos\n` +
    `╰━━━━━━━━━━━━━━━━━━`
  );
}

/** Tabela de custos por função. */
export function costsMessage({ prefix = PREFIX } = {}) {
  const items = Object.entries(COMMAND_CREDITS)
    .map(
      ([name, cost]) =>
        `┃ ├ ${prefix}${name.replaceAll("-", " ")} — ${cost} crédito${cost === 1 ? "" : "s"}`,
    )
    .join("\n");

  return (
    `╭━━━ 💳 *CUSTOS EM CRÉDITOS*\n` +
    `┃ 🎁 Grátis por dia: ${DAILY_FREE_CREDITS} créditos\n` +
    `┃ 🕛 Reset: 00h00 (horário de Moçambique)\n` +
    `┣━━━━━━━━━━━━━━━━━━\n` +
    `${items}\n` +
    `┣━━━━━━━━━━━━━━━━━━\n` +
    `┃ 🎬 Mídia longa gasta extras:\n` +
    `┃ ├ até 3 min — +0\n` +
    `┃ ├ 3 a 10 min — +2\n` +
    `┃ ├ 10 a 30 min — +4\n` +
    `┃ └ acima de 30 min — +6\n` +
    `┃ (sem duração, usamos o tamanho: 10/30/60 MB)\n` +
    `┣━━━━━━━━━━━━━━━━━━\n` +
    `┃ ${ownerContactLine()}\n` +
    `╰━━━━━━━━━━━━━━━━━━`
  );
}
