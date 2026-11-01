/**
 * Testes da escolha "créditos ou assinatura" numa compra ambígua.
 *
 * O caminho real é exercitado de ponta a ponta: registar o pedido no serviço de
 * recargas, marcar a pergunta em aberto e responder como o WhatsApp faria. O que
 * importa provar é que a escolha acaba GRAVADA NO PEDIDO — se ficasse só no
 * handler, o dono confirmaria horas depois e a compra sairia errada.
 *
 * @author Dev Yanik
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, afterEach, before, test } from "node:test";
import { DAILY_FREE_CREDITS, DATABASE_DIR } from "../config.js";
import { getAccount } from "../services/credits.js";
import {
  confirmRecharge,
  getPendingRecharge,
  registerPendingRecharge,
  setRechargeKind,
} from "../services/recharges.js";
import {
  handlePaymentChoiceReply,
  registerPaymentChoice,
  resetPaymentChoices,
} from "../utils/paymentChoice.js";

const runId = randomUUID().slice(0, 8);
const chatId = `5511999${runId.replace(/\D/g, "").slice(0, 5)}@g.us`;
const senderLid = `cho_${runId}@lid`;
const outroLid = `out_${runId}@lid`;

const FICHEIROS = ["credits", "subscriptions", "pending-recharges"].map((nome) =>
  path.join(DATABASE_DIR, `${nome}.json`),
);

let anteriores = [];

before(async () => {
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

afterEach(() => {
  resetPaymentChoices();
});

/** Abre um pedido pendente de 20 MT (valor nas duas tabelas). */
function abrirPedidoAmbiguo(sender = senderLid) {
  const chave = `TX-ESC-${randomUUID().slice(0, 8)}`;

  const registo = registerPendingRecharge({
    transactionId: chave,
    provider: "emola",
    amount: 20,
    destination: "865672009",
    senderLid: sender,
    credits: 65,
    kind: "creditos",
    plan: { dias: 7, mt: 20, bonus: 40 },
  });

  assert.equal(registo.ok, true, "o pedido devia abrir");

  return registo.recharge.key;
}

test("responder 2 converte o pedido em assinatura e o dono confirma-a", async () => {
  const chave = abrirPedidoAmbiguo();
  registerPaymentChoice({ chatId, senderLid, rechargeKey: chave });

  const respostas = [];
  const tratado = await handlePaymentChoiceReply({
    chatId,
    senderLid,
    text: "2",
    sendReply: async (texto) => respostas.push(texto),
  });

  assert.equal(tratado, true);
  assert.match(respostas.join("\n"), /Assinatura escolhida/);

  // A escolha tem de estar no PEDIDO, não só na memória do handler.
  const guardado = getPendingRecharge(chave);
  assert.equal(guardado.kind, "assinatura");
  assert.deepEqual(guardado.plan, { dias: 7, mt: 20, bonus: 40 });
  assert.equal(guardado.credits, null, "os 65 créditos da outra tabela não se aplicam");

  // O dono confirma depois: tem de sair assinatura, não créditos.
  const resultado = confirmRecharge(chave, { by: "dono" });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.kind, "assinatura");
  assert.equal(resultado.subscription.days, 7);
  assert.equal(getAccount(senderLid).dailyCredits, DAILY_FREE_CREDITS + 40);
});

test("responder 1 mantém créditos e credita-os na confirmação", async () => {
  const chave = abrirPedidoAmbiguo();
  registerPaymentChoice({ chatId, senderLid, rechargeKey: chave });

  const respostas = [];
  await handlePaymentChoiceReply({
    chatId,
    senderLid,
    text: "1",
    sendReply: async (texto) => respostas.push(texto),
  });

  assert.match(respostas.join("\n"), /Créditos escolhidos/);
  assert.equal(getPendingRecharge(chave).kind, "creditos");

  const resultado = confirmRecharge(chave, { by: "dono" });
  assert.equal(resultado.kind, "creditos");
  assert.equal(resultado.credited, 65);
});

test("um \"1\" sem pergunta em aberto segue o fluxo normal", async () => {
  const tratado = await handlePaymentChoiceReply({
    chatId,
    senderLid: `sem_${runId}@lid`,
    text: "1",
    sendReply: async () => {},
  });

  assert.equal(tratado, false, "sem pergunta pendente o handler não se mete");
});

test("outro membro do grupo não converte a compra de quem pagou", async () => {
  const chave = abrirPedidoAmbiguo();
  registerPaymentChoice({ chatId, senderLid, rechargeKey: chave });

  // O mapa é indexado pelo autor: o "2" de outro membro não encontra nada.
  const tratado = await handlePaymentChoiceReply({
    chatId,
    senderLid: outroLid,
    text: "2",
    sendReply: async () => {},
  });

  assert.equal(tratado, false);
  assert.equal(getPendingRecharge(chave).kind, "creditos", "a compra ficou intacta");
});

test("a resposta é consumida uma só vez", async () => {
  const chave = abrirPedidoAmbiguo();
  registerPaymentChoice({ chatId, senderLid, rechargeKey: chave });

  const primeira = await handlePaymentChoiceReply({
    chatId,
    senderLid,
    text: "2",
    sendReply: async () => {},
  });
  const segunda = await handlePaymentChoiceReply({
    chatId,
    senderLid,
    text: "1",
    sendReply: async () => {},
  });

  assert.equal(primeira, true);
  assert.equal(segunda, false, "a pergunta já foi respondida");
  assert.equal(getPendingRecharge(chave).kind, "assinatura", "o segundo toque não desfez");
});

test("responder a um pedido já tratado avisa em vez de falhar", async () => {
  const chave = abrirPedidoAmbiguo();
  registerPaymentChoice({ chatId, senderLid, rechargeKey: chave });
  confirmRecharge(chave, { by: "dono" });

  const respostas = [];
  const tratado = await handlePaymentChoiceReply({
    chatId,
    senderLid,
    text: "2",
    sendReply: async (texto) => respostas.push(texto),
  });

  assert.equal(tratado, true);
  assert.match(respostas.join("\n"), /já não está à espera/);
});

test("setRechargeKind não mexe em pedidos já resolvidos", () => {
  const chave = abrirPedidoAmbiguo(`res_${runId}@lid`);
  confirmRecharge(chave, { by: "dono" });

  const resultado = setRechargeKind(chave, "assinatura");

  assert.equal(resultado.ok, false);
  assert.equal(resultado.reason, "confirmed");
});

test("setRechargeKind aceita uma chave inexistente sem rebentar", () => {
  const resultado = setRechargeKind(`nao-existe-${runId}`, "assinatura");

  assert.equal(resultado.ok, false);
  assert.equal(resultado.reason, "nao-encontrada");
});
