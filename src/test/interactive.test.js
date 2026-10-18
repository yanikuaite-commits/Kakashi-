import assert from "node:assert/strict";
import { test } from "node:test";
import {
  copyButton,
  createInteractiveActionId,
  handleInteractiveMenuReply,
  INTERACTIVE_MENU_TTL_MS,
  numberedFallback,
  quickReplyButton,
  sendInteractiveWithFallback,
  singleSelectList,
  urlButton,
} from "../utils/interactive.js";
import { RODAPE, withFooter } from "../utils/formatMessage.js";

test("interactive builders preserve IDs and produce Baileys payloads", () => {
  assert.deepEqual(JSON.parse(quickReplyButton("Abrir", "menu:open").buttonParamsJson), {
    display_text: "Abrir",
    id: "menu:open",
  });
  assert.equal(urlButton("Canal", "https://example.com").name, "cta_url");
  assert.equal(urlButton("Canal", "javascript:alert(1)"), null);
  assert.equal(copyButton("Copiar", "https://example.com").name, "cta_copy");
  assert.equal(singleSelectList({ text: "Escolhe", title: "Menu", sections: [] }).buttonText, "Selecionar");
});

test("envio interativo usa fallback numerado quando o envio falha", async () => {
  let fallback;
  const sent = await sendInteractiveWithFallback({
    socket: { sendMessage: async () => { throw new Error("sem suporte"); } },
    chatId: "grupo@g.us",
    content: { text: "menu" },
    fallbackText: numberedFallback([
      { number: "1", title: "Áudio" },
      { number: "2", title: "Documento" },
    ]),
    sendReply: async (text) => { fallback = text; },
  });

  assert.equal(sent, true);
  assert.match(fallback, /1\. Áudio/);
  assert.match(fallback, /2\. Documento/);
  assert.match(fallback, /Responde apenas com o número/);
});

test("envio interativo retorna false quando o envio e o fallback falham", async () => {
  const sent = await sendInteractiveWithFallback({
    socket: { sendMessage: async () => { throw new Error("sem suporte"); } },
    chatId: "grupo@g.us",
    content: { text: "menu" },
    fallbackText: "Escolhe 1",
    sendReply: async () => { throw new Error("sem conexão"); },
  });

  assert.equal(sent, false);
});

test("rodapé fica no fim e dentro do limite máximo do WhatsApp", () => {
  const formatted = withFooter("x".repeat(5000));
  assert.ok(formatted.endsWith(RODAPE));
  assert.ok(formatted.length <= 4096);
  assert.equal(withFooter(`mensagem\n\n${RODAPE}`), `mensagem\n\n${RODAPE}`);
});

test("menus interativos só aceitam o autor e fallback numérico preserva o ID", async () => {
  const replies = [];
  const sendReply = async (text) => replies.push(text);
  const menuText = "!exemplo-gatilho opcao1";

  assert.equal(INTERACTIVE_MENU_TTL_MS, 120_000);
  await sendInteractiveWithFallback({
    socket: { sendMessage: async () => {} },
    chatId: "menu-owner-test@g.us",
    ownerId: "autor",
    content: { buttons: [{ buttonId: menuText }] },
    sendReply,
  });

  const unauthorized = await handleInteractiveMenuReply({
    chatId: "menu-owner-test@g.us",
    senderId: "outra-pessoa",
    text: menuText,
    sendReply,
  });
  assert.deepEqual(unauthorized, { handled: true });
  assert.match(replies.at(-1), /só essa pessoa pode escolher/i);

  const ownerSelection = await handleInteractiveMenuReply({
    chatId: "menu-owner-test@g.us",
    senderId: "autor",
    text: menuText,
    sendReply,
  });
  assert.deepEqual(ownerSelection, { handled: false });

  await sendInteractiveWithFallback({
    socket: { sendMessage: async () => {} },
    chatId: "menu-owner-test@g.us",
    ownerId: "segundo-autor",
    content: { buttons: [{ buttonId: menuText }] },
    sendReply,
  });
  const secondOwnerSelection = await handleInteractiveMenuReply({
    chatId: "menu-owner-test@g.us",
    senderId: "segundo-autor",
    text: menuText,
    sendReply,
  });
  assert.deepEqual(secondOwnerSelection, { handled: false });

  await sendInteractiveWithFallback({
    socket: { sendMessage: async () => { throw new Error("fallback"); } },
    chatId: "menu-number-owner-test@g.us",
    ownerId: "autor",
    content: { buttons: [{ buttonId: menuText }] },
    fallbackText: "1. Opção 1",
    fallbackActions: [{ number: "1", id: menuText }],
    sendReply,
  });
  const unauthorizedNumber = await handleInteractiveMenuReply({
    chatId: "menu-number-owner-test@g.us",
    senderId: "outra-pessoa",
    text: "1",
    sendReply,
  });
  assert.deepEqual(unauthorizedNumber, { handled: true });

  await sendInteractiveWithFallback({
    socket: { sendMessage: async () => { throw new Error("fallback"); } },
    chatId: "menu-number-test@g.us",
    ownerId: "autor",
    content: { buttons: [{ buttonId: menuText }] },
    fallbackText: "1. Opção 1",
    fallbackActions: [{ number: "1", id: menuText }],
    sendReply,
  });

  const numberedSelection = await handleInteractiveMenuReply({
    chatId: "menu-number-test@g.us",
    senderId: "autor",
    text: "1",
    sendReply,
  });
  assert.deepEqual(numberedSelection, {
    handled: false,
    selectedId: menuText,
  });
});

test("token consumido não pode ser reutilizado depois do menu", async () => {
  const replies = [];
  const token = createInteractiveActionId();
  await sendInteractiveWithFallback({
    socket: { sendMessage: async () => {} },
    chatId: "menu-expiry-test@g.us",
    ownerId: "autor",
    content: { interactiveButtons: [quickReplyButton("Abrir", token)] },
    responseMappings: [{ id: token, target: ".exemplo-gatilho opcao1" }],
    sendReply: async (text) => replies.push(text),
  });

  const firstClick = await handleInteractiveMenuReply({
    chatId: "menu-expiry-test@g.us",
    senderId: "autor",
    text: token,
    sendReply: async (text) => replies.push(text),
  });
  assert.deepEqual(firstClick, {
    handled: false,
    selectedId: ".exemplo-gatilho opcao1",
  });

  const staleClick = await handleInteractiveMenuReply({
    chatId: "menu-expiry-test@g.us",
    senderId: "autor",
    text: token,
    sendReply: async (text) => replies.push(text),
  });
  assert.deepEqual(staleClick, { handled: true });
  assert.match(replies.at(-1), /expirou/i);
});