/**
 * Testes das assinaturas diárias (planos por dias).
 *
 * A regra central é o bónus ser PAGO POR DIA, não de uma vez: um plano de 7 dias
 * com +40 tem de render 30+40 todos os dias, até completar os 7. É isso que
 * distingue uma assinatura de uma recarga avulsa, e é o que estes testes fixam.
 *
 * @author Dev Gui
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { DAILY_FREE_CREDITS, DATABASE_DIR } from "../config.js";
import {
  addDailyBonus,
  chargeCredits,
  getAccount,
  refundCredits,
} from "../services/credits.js";
import {
  activateSubscription,
  cancelSubscription,
  coversDay,
  dailySubscriptionBonus,
  daysRemaining,
  getSubscription,
  isAmbiguousAmount,
  listActiveSubscriptions,
  planByAmount,
  planByDays,
  remainingBonus,
  subscriptionPlans,
} from "../services/subscriptions.js";
import {
  confirmRecharge,
  paymentIntent,
  planForAmount,
  registerPendingRecharge,
} from "../services/recharges.js";
import { mozambiqueDay } from "../utils/clock.js";

// Cada execução usa contas próprias para não herdar estado antigo.
const runId = randomUUID().slice(0, 8);
const testJid = (nome) => `ass_${runId}_${nome}@lid`;

// 12h00 em Moçambique (UTC+2) = 10h00 UTC.
const meioDia = Date.UTC(2026, 9, 14, 10, 0, 0);
const diaSeguinte = Date.UTC(2026, 9, 15, 10, 0, 0);
const dentroDe7Dias = Date.UTC(2026, 9, 20, 10, 0, 0);
const depoisDe7Dias = Date.UTC(2026, 9, 21, 10, 0, 0);

// A base de dados é partilhada: guardar e repor evita deixar as contas de teste
// no `database/` e apagar dados reais de quem correr os testes.
const FICHEIROS = ["credits", "subscriptions", "pending-recharges"].map((nome) =>
  path.join(DATABASE_DIR, `${nome}.json`),
);

let anteriores = [];

before(async () => {
  assert.equal(mozambiqueDay(meioDia), "2026-10-14");

  anteriores = await Promise.all(
    FICHEIROS.map(async (ficheiro) => {
      try {
        return [ficheiro, await readFile(ficheiro, "utf8")];
      } catch {
        return [ficheiro, null];
      }
    }),
  );

  for (const ficheiro of FICHEIROS) await writeFile(ficheiro, "{}");
});

after(async () => {
  for (const [ficheiro, conteudo] of anteriores) {
    if (conteudo === null) {
      await rm(ficheiro, { force: true });
    } else {
      await writeFile(ficheiro, conteudo);
    }
  }
});

/* ─────────── Catálogo de planos ─────────── */

test("os planos são os pedidos, com o bónus por dia", () => {
  assert.deepEqual(subscriptionPlans(), [
    { dias: 7, mt: 20, bonus: 40 },
    { dias: 14, mt: 45, bonus: 60 },
    { dias: 20, mt: 60, bonus: 100 },
    { dias: 30, mt: 90, bonus: 150 },
    { dias: 60, mt: 140, bonus: 300 },
  ]);
});

test("planByDays e planByAmount encontram o plano certo", () => {
  assert.deepEqual(planByDays(7), { dias: 7, mt: 20, bonus: 40 });
  assert.deepEqual(planByDays("60"), { dias: 60, mt: 140, bonus: 300 });
  assert.deepEqual(planByAmount(45), { dias: 14, mt: 45, bonus: 60 });
  assert.deepEqual(planByAmount(140), { dias: 60, mt: 140, bonus: 300 });

  assert.equal(planByDays(8), null, "8 dias não é um plano");
  assert.equal(planByAmount(5), null, "5 MT é pacote de créditos, não plano");
  assert.equal(planByAmount(0), null);
  assert.equal(planByAmount(-10), null);
});

/* ─────────── Ambiguidade entre as duas tabelas ─────────── */

test("20 MT existe nas duas tabelas e é ambíguo", () => {
  // 20 MT: 65 créditos avulso OU 7 dias de assinatura. É o único valor que
  // aparece nas duas tabelas, por isso é o único que exige pergunta.
  assert.equal(isAmbiguousAmount(20), true);

  // Só numa tabela: sem dúvida.
  assert.equal(isAmbiguousAmount(5), false, "5 MT só dá créditos");
  assert.equal(isAmbiguousAmount(10), false, "10 MT só dá créditos");
  assert.equal(isAmbiguousAmount(30), false, "30 MT só dá créditos (85)");
  assert.equal(isAmbiguousAmount(50), false, "50 MT só dá créditos");
  assert.equal(isAmbiguousAmount(45), false, "45 MT só dá plano");
  assert.equal(isAmbiguousAmount(60), false, "60 MT só dá plano");
  assert.equal(isAmbiguousAmount(90), false, "90 MT só dá plano");
  assert.equal(isAmbiguousAmount(140), false, "140 MT só dá plano");
});

test("paymentIntent diz o que fazer com cada valor", () => {
  assert.equal(paymentIntent(5), "creditos");
  assert.equal(paymentIntent(10), "creditos");
  assert.equal(paymentIntent(30), "creditos");
  assert.equal(paymentIntent(50), "creditos");

  assert.equal(paymentIntent(45), "assinatura");
  assert.equal(paymentIntent(60), "assinatura");
  assert.equal(paymentIntent(90), "assinatura");
  assert.equal(paymentIntent(140), "assinatura");

  assert.equal(paymentIntent(20), "escolha");

  assert.equal(paymentIntent(7), null, "valor fora de todas as tabelas");
  assert.equal(paymentIntent(0), null);
});

test("planForAmount só devolve plano para valores de plano", () => {
  assert.deepEqual(planForAmount(45), { dias: 14, mt: 45, bonus: 60 });
  assert.equal(planForAmount(5), null);
});

/* ─────────── Cobertura do intervalo ─────────── */

test("coversDay inclui o dia de início e exclui o de expiração", () => {
  const assinatura = { startDay: "2026-10-14", expiresDay: "2026-10-21", active: true };

  assert.equal(coversDay(assinatura, "2026-10-14"), true, "1.º dia conta");
  assert.equal(coversDay(assinatura, "2026-10-20"), true, "7.º dia conta");
  assert.equal(coversDay(assinatura, "2026-10-21"), false, "dia de expiração já não conta");
  assert.equal(coversDay(assinatura, "2026-10-13"), false, "antes do início não conta");
  assert.equal(coversDay(assinatura, "2026-10-22"), false);

  assert.equal(coversDay({ ...assinatura, active: false }, "2026-10-15"), false);
  assert.equal(coversDay(null, "2026-10-15"), false);
});

/* ─────────── Ativação ─────────── */

test("ativar credita o bónus do dia da compra", () => {
  const jid = testJid("ativar");
  const resultado = activateSubscription(jid, planByDays(7), { now: meioDia });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.bonusToday, 40, "o dia da compra não pode ficar sem bónus");
  assert.equal(resultado.extended, false);
  assert.equal(resultado.subscription.startDay, "2026-10-14");
  assert.equal(resultado.subscription.expiresDay, "2026-10-21");
  assert.equal(resultado.subscription.days, 7);
  assert.equal(resultado.subscription.bonus, 40);

  // A conta nasce já com o bónus de hoje (o bónus faz parte da conta diária) e
  // `addDailyBonus` é idempotente nesse dia: não soma duas vezes.
  assert.equal(getAccount(jid, meioDia).dailyCredits, DAILY_FREE_CREDITS + 40);
  assert.equal(addDailyBonus(jid, resultado.bonusToday, { now: meioDia }).credited, 0);
  assert.equal(getAccount(jid, meioDia).dailyCredits, DAILY_FREE_CREDITS + 40);
});

test("o bónus entra uma única vez mesmo com conta criada depois da assinatura", () => {
  const jid = testJid("ordem");
  // Ordem invertida: a assinatura existe ANTES de existir conta de créditos.
  activateSubscription(jid, planByDays(7), { now: meioDia });
  assert.equal(getAccount(jid, meioDia).dailyCredits, DAILY_FREE_CREDITS + 40);

  addDailyBonus(jid, 40, { now: meioDia });
  assert.equal(
    getAccount(jid, meioDia).dailyCredits,
    DAILY_FREE_CREDITS + 40,
    "não creditou o bónus duas vezes",
  );
});

test("a assinatura cobre exatamente os dias comprados", () => {
  const jid = testJid("dias");
  activateSubscription(jid, planByDays(7), { now: meioDia });

  assert.equal(dailySubscriptionBonus(jid, meioDia), 40, "dia 1");
  assert.equal(dailySubscriptionBonus(jid, diaSeguinte), 40, "dia 2");
  assert.equal(dailySubscriptionBonus(jid, dentroDe7Dias), 40, "dia 7");
  assert.equal(dailySubscriptionBonus(jid, depoisDe7Dias), 0, "dia 8 já acabou");
});

test("sem assinatura não há bónus", () => {
  const jid = testJid("sem");

  assert.equal(dailySubscriptionBonus(jid, meioDia), 0);
  assert.equal(getSubscription(jid, meioDia), null);
  assert.equal(daysRemaining(null, meioDia), 0);
  assert.equal(remainingBonus(null, meioDia), 0);
});

test("daysRemaining e remainingBonus contam o que falta", () => {
  const jid = testJid("resta");
  const { subscription } = activateSubscription(jid, planByDays(7), { now: meioDia });

  assert.equal(daysRemaining(subscription, meioDia), 7, "no dia 1 faltam 7");
  assert.equal(daysRemaining(subscription, diaSeguinte), 6, "no dia 2 faltam 6");
  assert.equal(daysRemaining(subscription, dentroDe7Dias), 1, "no dia 7 falta 1");
  assert.equal(daysRemaining(subscription, depoisDe7Dias), 0, "no dia 8 nada");

  assert.equal(remainingBonus(subscription, meioDia), 7 * 40);
  assert.equal(remainingBonus(subscription, dentroDe7Dias), 40);
  assert.equal(remainingBonus(subscription, depoisDe7Dias), 0);
});

/* ─────────── Renovação ─────────── */

test("renovar a meio de um plano soma os dias em vez de os perder", () => {
  const jid = testJid("renova");
  activateSubscription(jid, planByDays(7), { now: meioDia });

  // Compra outro plano de 7 dias no dia 2: os dias que faltam do primeiro são
  // preservados e o novo começa quando o antigo acabar.
  const segunda = activateSubscription(jid, planByDays(7), { now: diaSeguinte });

  assert.equal(segunda.extended, true);
  assert.equal(segunda.bonusToday, 0, "o plano novo ainda não começou hoje");
  assert.equal(segunda.subscription.startDay, "2026-10-21", "começa quando o antigo acaba");
  assert.equal(segunda.subscription.expiresDay, "2026-10-28");
  assert.equal(segunda.subscription.createdAt, getSubscription(jid, meioDia).createdAt);
});

test("renovar depois de acabar começa logo hoje", () => {
  const jid = testJid("renova2");
  activateSubscription(jid, planByDays(7), { now: meioDia });

  const depois = activateSubscription(jid, planByDays(14), { now: depoisDe7Dias });

  assert.equal(depois.extended, false);
  assert.equal(depois.bonusToday, 60);
  assert.equal(depois.subscription.startDay, "2026-10-21");
  assert.equal(depois.subscription.expiresDay, "2026-11-04");
});

test("cancelar tira o bónus", () => {
  const jid = testJid("cancela");
  activateSubscription(jid, planByDays(30), { now: meioDia });
  assert.equal(dailySubscriptionBonus(jid, meioDia), 150);

  assert.equal(cancelSubscription(jid, { now: meioDia }).ok, true);
  assert.equal(dailySubscriptionBonus(jid, meioDia), 0);
  assert.equal(cancelSubscription(testJid("nada"), { now: meioDia }).ok, false);
});

test("listActiveSubscriptions devolve só as que cobrem hoje", () => {
  const jid = testJid("lista");
  activateSubscription(jid, planByDays(7), { now: meioDia });

  const hoje = listActiveSubscriptions(meioDia).map((a) => a.jid);
  assert.ok(hoje.includes(jid));

  const depois = listActiveSubscriptions(depoisDe7Dias).map((a) => a.jid);
  assert.ok(!depois.includes(jid), "fora do prazo não aparece");
});

/* ─────────── Bónus por dia, no reset das 00h00 ─────────── */

test("o bónus é reposto todos os dias pelo reset, não de uma vez", () => {
  const jid = testJid("reset");
  activateSubscription(jid, planByDays(7), { now: meioDia });

  // Dia 1: já nasce com o bónus; gasta tudo.
  assert.equal(getAccount(jid, meioDia).dailyCredits, DAILY_FREE_CREDITS + 40);
  chargeCredits(jid, DAILY_FREE_CREDITS + 40, { now: meioDia });
  assert.equal(getAccount(jid, meioDia).dailyCredits, 0);

  // Dia 2: o reset das 00h00 repõe o valor COM bónus.
  assert.equal(getAccount(jid, diaSeguinte).dailyCredits, DAILY_FREE_CREDITS + 40);

  // Dia 7 ainda tem bónus; dia 8 volta ao valor grátis.
  assert.equal(getAccount(jid, dentroDe7Dias).dailyCredits, DAILY_FREE_CREDITS + 40);
  assert.equal(getAccount(jid, depoisDe7Dias).dailyCredits, DAILY_FREE_CREDITS);
});

test("gastar antes do reset não apaga o bónus do dia seguinte", () => {
  const jid = testJid("gasta");
  activateSubscription(jid, planByDays(30), { now: meioDia });

  // Saldo do dia 1 = 30 + 150 = 180; gasta tudo.
  assert.equal(getAccount(jid, meioDia).dailyCredits, DAILY_FREE_CREDITS + 150);
  chargeCredits(jid, DAILY_FREE_CREDITS + 150, { now: meioDia });
  assert.equal(getAccount(jid, meioDia).dailyCredits, 0);

  assert.equal(getAccount(jid, diaSeguinte).dailyCredits, DAILY_FREE_CREDITS + 150);
});

test("o reembolso num plano ativo devolve até ao teto do dia com bónus", () => {
  const jid = testJid("reembolso");
  activateSubscription(jid, planByDays(7), { now: meioDia });

  assert.equal(getAccount(jid, meioDia).dailyCredits, DAILY_FREE_CREDITS + 40);

  chargeCredits(jid, 50, { now: meioDia });
  assert.equal(getAccount(jid, meioDia).dailyCredits, DAILY_FREE_CREDITS + 40 - 50);

  refundCredits(jid, 50, { now: meioDia });
  assert.equal(
    getAccount(jid, meioDia).dailyCredits,
    DAILY_FREE_CREDITS + 40,
    "o reembolso volta ao teto COM bónus, sem o perder para os recarregados",
  );
  assert.equal(getAccount(jid, meioDia).paidCredits, 0);
});

/* ─────────── Confirmação do pagamento ─────────── */

test("confirmar um plano ativa a assinatura e credita o bónus do dia", () => {
  const jid = testJid("confirma");
  registerPendingRecharge({
    transactionId: `TX-ASS-${runId}`,
    provider: "emola",
    amount: 45,
    destination: "865672009",
    senderLid: jid,
    kind: "assinatura",
    plan: planByAmount(45),
  });

  const resultado = confirmRecharge(`TX-ASS-${runId}`, { by: "dono", now: meioDia });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.kind, "assinatura");
  assert.equal(resultado.credited, 60, "bónus do dia da compra");
  assert.equal(resultado.subscription.days, 14);
  assert.equal(getAccount(jid, meioDia).dailyCredits, DAILY_FREE_CREDITS + 60);
  assert.equal(dailySubscriptionBonus(jid, diaSeguinte), 60);
});

test("confirmar uma recarga avulsa não cria assinatura", () => {
  const jid = testJid("avulsa");
  registerPendingRecharge({
    transactionId: `TX-CRED-${runId}`,
    provider: "mpesa",
    amount: 10,
    destination: "850446446",
    senderLid: jid,
    credits: 30,
  });

  const resultado = confirmRecharge(`TX-CRED-${runId}`, { by: "dono", now: meioDia });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.kind, "creditos");
  assert.equal(resultado.credited, 30);
  assert.equal(getSubscription(jid, meioDia), null);
  assert.equal(getAccount(jid, meioDia).paidCredits, 30);
});

test("o dono pode converter um valor ambíguo na confirmação", () => {
  const jid = testJid("converte");
  registerPendingRecharge({
    transactionId: `TX-CONV-${runId}`,
    provider: "emola",
    amount: 20,
    destination: "865672009",
    senderLid: jid,
    credits: 65,
  });

  // O utilizador respondeu "2" (assinatura) no grupo.
  const resultado = confirmRecharge(`TX-CONV-${runId}`, {
    by: "dono",
    kind: "assinatura",
    now: meioDia,
  });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.kind, "assinatura");
  assert.equal(resultado.subscription.days, 7);
  assert.equal(dailySubscriptionBonus(jid, meioDia), 40);
  assert.equal(getAccount(jid, meioDia).paidCredits, 0, "não creditou avulso");
});
