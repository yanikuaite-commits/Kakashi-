import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleAnimeReply,
  resetAnimeSessions,
  startAnimeFlow,
} from "../utils/animeMenu.js";

/**
 * Regressão do bug: "Fui eu a mandar o menu mas o bot nega".
 *
 * O autor abria o menu com uma forma de JID e a resposta chegava com outra
 * (`@lid` vs número, com/sem sufixo de aparelho). A comparação por string
 * exata tratava o próprio autor como estranho.
 *
 * O caminho do token `anm:ep:<i>` chega a `sendQualityList`, que sem episódios
 * responde "não está mais disponível" SEM ir à rede — por isso dá para provar
 * que o autor passou pelo portão de posse sem chamar a API.
 */
const CHAT = "120363000000000000@g.us";
const LID = "987654321098765:12@lid";
const PN = "244991234567@s.whatsapp.net";

function makeSocket() {
  return { sendMessage: async () => ({ key: { id: "m" } }) };
}

async function abrirMenu(ownerLid, senderLids) {
  const replies = [];
  await startAnimeFlow({
    socket: makeSocket(),
    chatId: CHAT,
    ownerLid,
    ownerName: "Yanik Uaite",
    sendReply: async (text) => replies.push(String(text)),
    senderLids,
  });
  return replies;
}

test("o autor passa o portão de posse mesmo com forma de JID diferente", async () => {
  resetAnimeSessions();
  await abrirMenu(LID, [LID, PN]);

  const replies = [];
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: PN, // forma diferente da abertura
    senderLids: [PN, LID],
    senderName: "Yanik Uaite",
    text: "anm:ep:0",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, true);
  assert.equal(
    replies.some((r) => /Só quem pediu/i.test(r)),
    false,
    "o autor não pode ser tratado como estranho",
  );
  assert.match(replies[0], /não está mais disponível/i);
});

test("o autor cancela o próprio menu mesmo com forma de JID diferente", async () => {
  resetAnimeSessions();
  await abrirMenu(LID, [LID, PN]);

  const replies = [];
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: PN,
    senderLids: [PN, LID],
    text: "anm:cancel",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, true);
  assert.equal(replies.some((r) => /Só quem pediu/i.test(r)), false);
  assert.match(replies[0], /cancelado/i);
});

test("outro membro continua a ser negado", async () => {
  resetAnimeSessions();
  await abrirMenu(LID, [LID, PN]);

  const replies = [];
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: "555555555555555@lid",
    senderLids: ["555555555555555@lid"],
    senderName: "Outra Pessoa",
    text: "anm:ep:0",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, true);
  assert.match(replies[0], /Só quem pediu/i);
});

test("outro membro não cancela o menu do autor", async () => {
  resetAnimeSessions();
  await abrirMenu(LID, [LID, PN]);

  const replies = [];
  await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: "555555555555555@lid",
    senderLids: ["555555555555555@lid"],
    text: "anm:cancel",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.match(replies[0], /Só quem pediu pode cancelar/i);
});

test("token de anime sem sessão avisa que o menu expirou", async () => {
  resetAnimeSessions();

  const replies = [];
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: LID,
    senderLids: [LID],
    text: "anm:ep:0",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, true);
  assert.match(replies[0], /expirou/i);
});
