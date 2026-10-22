/**
 * Testes do fluxo de pagamento/recarga: parser dos SMS reais (e-mola e
 * m-pesa), registo da transação pendente, confirmação, recusa, caducidade e
 * o despacho dos comandos de dono.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { DATABASE_DIR, OWNER_LID, PREFIX } from "../config.js";
import { accountBalance, getAccount } from "../services/credits.js";
import {
  confirmRecharge,
  creditsForAmount,
  declineRecharge,
  expireRecharges,
  getPendingRecharge,
  listPendingRecharges,
  rechargeKey,
  registerPendingRecharge,
} from "../services/recharges.js";
import {
  handlePaymentSms,
  isKnownPaymentDestination,
  ownerPrivateJid,
  rechargeExpiredMessage,
  rechargeOwnerMessage,
} from "../utils/paymentFlow.js";
import { parsePaymentSms } from "../utils/paymentText.js";

const runId = randomUUID().slice(0, 8);
const testJid = (name) => `25884${runId.slice(0, 4)}${name}`.replace(/\W/g, "").slice(0, 15) + "@lid";

const SMS_EMOLA =
  "ID da transacao PP261021.1823.W70113. Transferiste 20.00MT para conta " +
  "865672009, nome: JOEL LAURINDO MANUESSA as 18:23:50 de 21/10/2026. Taxa: " +
  "0.00MT. O saldo da tua conta e 0.00MT. Conteudo: . Em caso de duvida, liga 100. Obrigado!";

const SMS_MPESA =
  "Confirmado DII4LME7OGU. Transferiste 5.00MT e a taxa foi de 1.00MT para " +
  "850446446 aos 18/9/26 as 2:37 PM. O teu novo saldo M-Pesa e de 0.00MT. E SEM " +
  "TAXAS as transferencias de  M-Pesa para M-Pesa. Em caso de duvida,liga 100!";

const FICHEIROS = ["pending-recharges", "credits"].map((nome) =>
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
  await writeFile(FICHEIROS[0], "{}");
  await writeFile(FICHEIROS[1], "{}");
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

/* ─────────── Parser dos SMS ─────────── */

test("lê o SMS do e-mola (exemplo real)", () => {
  const sms = parsePaymentSms(SMS_EMOLA);

  assert.equal(sms.provider, "emola");
  assert.equal(sms.transactionId, "PP261021.1823.W70113");
  assert.equal(sms.amount, 20);
  assert.equal(sms.fee, 0);
  assert.equal(sms.destination, "865672009");
  assert.equal(sms.name, "JOEL LAURINDO MANUESSA");
  // 18:23:50 em Moçambique (UTC+2).
  assert.equal(sms.dateTime, "2026-10-21T18:23:50+02:00");
});

test("lê o SMS do m-pesa com hora AM/PM", () => {
  const sms = parsePaymentSms(SMS_MPESA);

  assert.equal(sms.provider, "mpesa");
  assert.equal(sms.transactionId, "DII4LME7OGU");
  assert.equal(sms.amount, 5);
  assert.equal(sms.fee, 1);
  assert.equal(sms.destination, "850446446");
  // "2:37 PM" são 14:37.
  assert.equal(sms.dateTime, "2026-09-18T14:37:00+02:00");
});

test("texto comum não é tratado como pagamento", () => {
  assert.equal(parsePaymentSms("olá pessoal, bom dia!"), null);
  assert.equal(parsePaymentSms(""), null);
  assert.equal(parsePaymentSms("Transferiste 20.00MT"), null);
  assert.equal(
    parsePaymentSms("Transferiste 20.00MT para conta 865672009"),
    null,
    "sem operador identificável não é pagamento",
  );
});

test("só números conhecidos do bot são aceites", () => {
  assert.equal(
    isKnownPaymentDestination({ provider: "emola", destination: "865672009" }),
    true,
  );
  assert.equal(
    isKnownPaymentDestination({ provider: "mpesa", destination: "850446446" }),
    true,
  );
  // Um pagamento feito para outra pessoa não é para o bot.
  assert.equal(
    isKnownPaymentDestination({ provider: "emola", destination: "879222305" }),
    false,
  );
});

test("créditos por valor saem da tabela de créditos", () => {
  assert.equal(creditsForAmount(5), 15);
  assert.equal(creditsForAmount(10), 30);
  assert.equal(creditsForAmount(20), 55);
  assert.equal(creditsForAmount(7), null, "valor fora da tabela não inventa créditos");
  assert.equal(creditsForAmount(0), null);
});

/* ─────────── Registo e confirmação ─────────── */

test("o mesmo SMS não abre dois pedidos", () => {
  const dados = {
    transactionId: "TX-DUP-1",
    provider: "emola",
    amount: 10,
    destination: "865672009",
    senderLid: testJid("dup"),
    credits: 30,
  };

  const primeiro = registerPendingRecharge(dados);
  assert.equal(primeiro.ok, true);

  const segundo = registerPendingRecharge(dados);
  assert.equal(segundo.ok, true);
  assert.equal(segundo.reason, "duplicado");
  assert.equal(listPendingRecharges().filter((r) => r.key === "TX-DUP-1").length, 1);
});

test("confirmar credita uma vez e não credita duas", () => {
  const senderLid = testJid("conf");
  registerPendingRecharge({
    transactionId: "TX-CONF-1",
    provider: "emola",
    amount: 20,
    destination: "865672009",
    senderLid,
    credits: 55,
  });

  const antes = accountBalance(getAccount(senderLid));
  const primeiro = confirmRecharge("TX-CONF-1", { by: "dono" });
  assert.equal(primeiro.ok, true);
  assert.equal(primeiro.credited, 55);
  assert.equal(accountBalance(getAccount(senderLid)), antes + 55);

  const segundo = confirmRecharge("TX-CONF-1", { by: "dono" });
  assert.equal(segundo.ok, false);
  assert.equal(segundo.reason, "confirmed");
  assert.equal(
    accountBalance(getAccount(senderLid)),
    antes + 55,
    "não creditou duas vezes",
  );
});

test("recusar cancela e não credita", () => {
  const senderLid = testJid("rec");
  registerPendingRecharge({
    transactionId: "TX-REC-1",
    provider: "mpesa",
    amount: 5,
    destination: "850446446",
    senderLid,
    credits: 15,
  });

  const antes = accountBalance(getAccount(senderLid));
  const recusa = declineRecharge("TX-REC-1", { by: "dono" });
  assert.equal(recusa.ok, true);
  assert.equal(accountBalance(getAccount(senderLid)), antes, "nada foi creditado");

  const confirmar = confirmRecharge("TX-REC-1", { by: "dono" });
  assert.equal(confirmar.ok, false);
  assert.equal(confirmar.reason, "declined");
});

test("transação fora do prazo caduca e não credita", () => {
  const senderLid = testJid("exp");
  registerPendingRecharge({
    transactionId: "TX-EXP-1",
    provider: "emola",
    amount: 20,
    destination: "865672009",
    senderLid,
    credits: 55,
  });

  const antes = accountBalance(getAccount(senderLid));
  const agora = Date.now();
  const expiradas = expireRecharges({ now: agora + 11 * 60 * 60 * 1000 });

  assert.ok(expiradas.some((r) => r.key === "TX-EXP-1"));
  assert.equal(getPendingRecharge("TX-EXP-1").status, "expired");

  const confirmar = confirmRecharge("TX-EXP-1", {
    by: "dono",
    now: agora + 12 * 60 * 60 * 1000,
  });
  assert.equal(confirmar.ok, false);
  assert.equal(accountBalance(getAccount(senderLid)), antes, "nada foi creditado");
});

test("confirmação exige créditos definidos", () => {
  registerPendingRecharge({
    transactionId: "TX-SEM-CREDITOS",
    provider: "emola",
    amount: 7,
    destination: "865672009",
    senderLid: testJid("semcred"),
    credits: null,
  });

  const resultado = confirmRecharge("TX-SEM-CREDITOS", { by: "dono" });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.reason, "sem-creditos");

  // O dono pode definir os créditos à mão para valores fora da tabela.
  const manual = confirmRecharge("TX-SEM-CREDITOS", { credits: 12, by: "dono" });
  assert.equal(manual.ok, true);
  assert.equal(manual.credited, 12);
});

test("sem id de transação, a chave vem dos campos do SMS", () => {
  const chave = rechargeKey({
    transactionId: null,
    provider: "emola",
    amount: 20,
    destination: "865672009",
  });

  assert.equal(chave, "emola|20|865672009");
  assert.equal(rechargeKey({ transactionId: "TX-1" }), "TX-1");
});

/* ─────────── Fluxo completo ─────────── */

test("SMS no grupo abre pedido, avisa o dono e credita após confirmação", async () => {
  const chatId = `pagamento-${runId}@g.us`;
  const senderLid = testJid("fluxo");
  const enviados = [];
  const respostas = [];

  const socket = {
    sendMessage: async (jid, content) => {
      enviados.push({ jid, content });
      return { key: { id: "fake" } };
    },
  };

  const tratado = await handlePaymentSms({
    socket,
    chatId,
    senderLid,
    senderName: "Joel",
    text: SMS_EMOLA,
    sendReply: async (text) => respostas.push(String(text)),
  });

  assert.equal(tratado, true);
  assert.ok(respostas.some((t) => /Pagamento recebido/.test(t)));

  // O dono recebeu o pedido no privado, com os dados da transação.
  const dm = enviados.find((e) => e.jid === ownerPrivateJid());
  assert.ok(dm, "o dono foi avisado");
  assert.match(dm.content.text, /PP261021\.1823\.W70113/);
  assert.match(dm.content.text, /20 MT/);
  assert.match(dm.content.text, /865672009/);
  assert.match(dm.content.text, /JOEL LAURINDO MANUESSA/);
  assert.match(dm.content.text, /21\/10\/2026 18:23/);

  const pendente = getPendingRecharge("PP261021.1823.W70113");
  assert.equal(pendente.credits, 55);

  const antes = accountBalance(getAccount(senderLid));
  const confirmado = confirmRecharge(pendente.key, { by: "dono" });
  assert.equal(confirmado.ok, true);
  assert.equal(accountBalance(getAccount(senderLid)), antes + 55);
});

test("SMS para um número que não é do bot é ignorado", async () => {
  const respostas = [];
  const socket = { sendMessage: async () => ({ key: { id: "x" } }) };

  const tratado = await handlePaymentSms({
    socket,
    chatId: "grupo@g.us",
    senderLid: testJid("outro"),
    text: SMS_EMOLA.replace("865672009", "879222305"),
    sendReply: async (t) => respostas.push(String(t)),
  });

  assert.equal(tratado, false);
  assert.equal(respostas.length, 0);
});

test("dono não abre pedido de recarga para si próprio", () => {
  // O pipeline salta o dono antes de chamar handlePaymentSms; aqui garantimos
  // que o número privado do dono é o esperado.
  assert.equal(ownerPrivateJid("258834788141"), "258834788141@s.whatsapp.net");
  assert.equal(ownerPrivateJid(""), "");
});

test("a ficha do dono e o aviso de caducidade citam o prefixo", () => {
  const ficha = rechargeOwnerMessage({
    key: "TX-1",
    transactionId: "TX-1",
    providerLabel: "e-mola",
    amount: 20,
    fee: 0,
    destination: "865672009",
    name: "JOEL",
    smsDateTime: "2026-10-21T18:23:50+02:00",
    senderLid: "258840000000@lid",
    senderName: "Joel",
    chatId: "grupo@g.us",
    credits: 55,
  });

  assert.match(ficha, /NOVO PAGAMENTO PARA CONFIRMAR/);
  assert.match(ficha, /55 créditos/);

  assert.match(rechargeExpiredMessage(), new RegExp(PREFIX + "tabela"));
});

test("os comandos de dono existem e confirmam pelo id", async () => {
  const senderLid = testJid("cmd");
  registerPendingRecharge({
    transactionId: "TX-CMD-1",
    provider: "emola",
    amount: 20,
    destination: "865672009",
    senderLid,
    credits: 55,
  });

  const confirmar = (
    await import("../commands/owner/recarga-confirmar.js")
  ).default;
  const respostas = [];
  const antes = accountBalance(getAccount(senderLid));

  await confirmar.handle({
    fullArgs: "TX-CMD-1",
    sendReply: async (t) => respostas.push(String(t)),
    sendErrorReply: async (t) => respostas.push(String(t)),
  });

  assert.ok(respostas.some((t) => /RECARGA CONFIRMADA/i.test(t)), respostas.join(" | "));
  assert.equal(accountBalance(getAccount(senderLid)), antes + 55);

  const recusar = (await import("../commands/owner/recarga-recusar.js")).default;
  const respostas2 = [];

  await recusar.handle({
    fullArgs: "TX-CMD-1",
    sendReply: async (t) => respostas2.push(String(t)),
    sendErrorReply: async (t) => respostas2.push(String(t)),
  });

  assert.ok(respostas2.some((t) => /recusada|Não recusei/.test(t)));
  assert.equal(
    getPendingRecharge("TX-CMD-1").status,
    "confirmed",
    "não se recusa o que já foi confirmado",
  );
});

test("o toque do dono na lista vira o comando de confirmar", async () => {
  const { handleInteractiveMenuReply } = await import("../utils/interactive.js");

  const chatId = `pagamento-toque-${runId}@g.us`;
  const senderLid = testJid("toque");
  const enviados = [];
  const socket = {
    sendMessage: async (jid, content) => {
      enviados.push({ jid, content });
      return { key: { id: "fake" } };
    },
  };

  await handlePaymentSms({
    socket,
    chatId,
    senderLid,
    senderName: "Joel",
    text: SMS_EMOLA.replace("PP261021.1823.W70113", "TX-TOQUE-1"),
    sendReply: async () => {},
  });

  // O dono recebeu a lista; extrai-se o token da linha "Confirmar".
  const dm = enviados.find((e) => e.jid === ownerPrivateJid());
  assert.ok(dm, "o dono recebeu a lista");

  const linhas = dm.content.sections.flatMap((s) => s.rows);
  const confirmar = linhas.find((r) => /Confirmar/i.test(r.title));
  assert.ok(confirmar, "a lista tem a linha de confirmar");
  assert.ok(!/^\d+$/.test(confirmar.rowId), "o rowId é um token, não um número");

  // O toque do dono devolve o comando de dono (despachado pelo pipeline).
  const clique = await handleInteractiveMenuReply({
    chatId: ownerPrivateJid(),
    senderId: ownerPrivateJid(),
    text: confirmar.rowId,
    sendReply: async () => {},
  });

  assert.equal(clique.handled, false);
  assert.equal(clique.selectedId, `${PREFIX}recarga-confirmar TX-TOQUE-1`);

  // E esse comando credita o usuário.
  const comando = (
    await import("../commands/owner/recarga-confirmar.js")
  ).default;
  const antes = accountBalance(getAccount(senderLid));

  await comando.handle({
    fullArgs: "TX-TOQUE-1",
    sendReply: async () => {},
    sendErrorReply: async () => {},
  });

  assert.equal(accountBalance(getAccount(senderLid)), antes + 55);
});

test("confirmar avisa o usuário no grupo e manda a tabela de créditos", async () => {
  const chatId = `pagamento-aviso-${runId}@g.us`;
  const senderLid = testJid("aviso");
  const enviados = [];
  const relays = [];

  const socket = {
    sendMessage: async (jid, content) => {
      enviados.push({ jid, content });
      return { key: { id: "fake" } };
    },
    relayMessage: async (jid, message) => {
      relays.push({ jid, message });
      return { key: { id: "relay" } };
    },
  };

  await handlePaymentSms({
    socket,
    chatId,
    senderLid,
    senderName: "Joel",
    text: SMS_EMOLA.replace("PP261021.1823.W70113", "TX-AVISO-1"),
    sendReply: async () => {},
  });

  const antes = accountBalance(getAccount(senderLid));
  enviados.length = 0;

  const comando = (
    await import("../commands/owner/recarga-confirmar.js")
  ).default;

  await comando.handle({
    fullArgs: "TX-AVISO-1",
    socket,
    sendReply: async (t) => enviados.push({ jid: "dono", content: { text: String(t) } }),
    sendErrorReply: async () => {},
  });

  assert.equal(accountBalance(getAccount(senderLid)), antes + 55, "creditou");

  // O usuário recebeu o aviso no chat onde enviou o SMS, não no privado do dono.
  const aviso = enviados.find(
    (e) => e.jid === chatId && /PAGAMENTO CONFIRMADO|Pagamento confirmado/i.test(e.content.text),
  );
  assert.ok(aviso, `esperava o aviso ao usuário: ${JSON.stringify(enviados.map((e) => e.jid))}`);
  assert.match(aviso.content.text, /55/);
  assert.match(aviso.content.text, /85 créditos/);
  assert.deepEqual(aviso.content.mentions, [senderLid], "menciona quem pagou");

  // E a tabela de créditos foi enviada a seguir (rich response).
  assert.ok(
    relays.some((r) => r.jid === chatId),
    "a tabela de créditos seguiu para o grupo",
  );
});

test("recusar não avisa o usuário de créditos nem manda tabela", async () => {
  const chatId = `pagamento-sem-aviso-${runId}@g.us`;
  const senderLid = testJid("semaviso");
  const enviados = [];
  const relays = [];

  const socket = {
    sendMessage: async (jid, content) => {
      enviados.push({ jid, content });
      return { key: { id: "fake" } };
    },
    relayMessage: async (jid, message) => {
      relays.push({ jid, message });
      return { key: { id: "relay" } };
    },
  };

  await handlePaymentSms({
    socket,
    chatId,
    senderLid,
    senderName: "Joel",
    text: SMS_EMOLA.replace("PP261021.1823.W70113", "TX-SEMAVISO-1"),
    sendReply: async () => {},
  });

  const antes = accountBalance(getAccount(senderLid));
  enviados.length = 0;
  relays.length = 0;

  const comando = (
    await import("../commands/owner/recarga-recusar.js")
  ).default;

  await comando.handle({
    fullArgs: "TX-SEMAVISO-1",
    socket,
    sendReply: async (t) => enviados.push({ jid: "dono", content: { text: String(t) } }),
    sendErrorReply: async () => {},
  });

  assert.equal(accountBalance(getAccount(senderLid)), antes, "nada creditado");
  assert.equal(
    enviados.filter((e) => e.jid === chatId).length,
    0,
    "recusar não avisa o usuário de créditos",
  );
  assert.equal(relays.length, 0, "recusar não manda a tabela");
});
