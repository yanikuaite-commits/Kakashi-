import assert from "node:assert/strict";
import { test } from "node:test";
import { generateWAMessageContent } from "baileys";
import {
  copyButton,
  createInteractiveActionId,
  handleInteractiveMenuReply,
  INTERACTIVE_MENU_TTL_MS,
  numberedFallback,
  sendInteractiveWithFallback,
  singleSelectButton,
  singleSelectList,
  urlButton,
} from "../utils/interactive.js";
import { RODAPE, withFooter } from "../utils/formatMessage.js";

test("interactive builders preserve IDs and produce Baileys payloads", () => {
  // Nesta base só single_select e cta_url renderizam: quick_reply é proibido.
  const listaBtn = singleSelectButton("Abrir", [
    { title: "Opções", rows: [{ id: "menu:open", title: "Abrir" }] },
  ]);
  assert.equal(listaBtn.name, "single_select");
  const listaParams = JSON.parse(listaBtn.buttonParamsJson);
  assert.equal(listaParams.sections[0].rows[0].id, "menu:open");
  assert.equal(urlButton("Canal", "https://example.com").name, "cta_url");
  assert.equal(urlButton("Canal", "javascript:alert(1)"), null);
  assert.equal(copyButton("Copiar", "https://example.com").name, "cta_copy");
  assert.equal(singleSelectList({ text: "Escolhe", title: "Menu", sections: [] }).buttonText, "Selecionar");
});

test("simple and native buttons include required native-flow metadata", async () => {
  const contents = await Promise.all([
    generateWAMessageContent(
      {
        text: "Teste",
        buttons: [{ buttonId: "kmenu:test", buttonText: { displayText: "Abrir" } }],
      },
      {},
    ),
    generateWAMessageContent(
      {
        text: "Teste",
        interactiveButtons: [
          singleSelectButton("Abrir", [
            { title: "Opções", rows: [{ id: "kmenu:test", title: "Abrir" }] },
          ]),
        ],
      },
      {},
    ),
  ]);

  for (const content of contents) {
    const flow = content.viewOnceMessage.message.interactiveMessage.nativeFlowMessage;
    assert.equal(flow.messageVersion, 1);
    assert.equal(flow.messageParamsJson, "{}");
    assert.match(flow.buttons[0].buttonParamsJson, /kmenu:test/);
  }
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

test("envio interativo propaga falha quando o fallback também falha", async () => {
  await assert.rejects(sendInteractiveWithFallback({
    socket: { sendMessage: async () => { throw new Error("sem suporte"); } },
    chatId: "grupo@g.us",
    content: { text: "menu" },
    fallbackText: "Escolhe 1",
    sendReply: async () => { throw new Error("sem conexão"); },
  }), /Falha no menu interativo e no fallback: sem suporte/);
});

test("fallback tenta envio direto se sendReply falhar", async () => {
  const sentMessages = [];
  const sent = await sendInteractiveWithFallback({
    socket: {
      sendMessage: async (_chatId, content) => {
        if (content.text !== "menu") sentMessages.push(content);
        else throw new Error("sem suporte interativo");
      },
    },
    chatId: "grupo-fallback-direto@g.us",
    content: { text: "menu" },
    fallbackText: "1. Opção",
    sendReply: async () => { throw new Error("presença indisponível"); },
  });

  assert.equal(sent, true);
  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].text.endsWith(RODAPE));
  assert.match(sentMessages[0].text, /1\. Opção/);
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
    content: { buttons: [{ buttonId: token, buttonText: { displayText: "Abrir" } }] },
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