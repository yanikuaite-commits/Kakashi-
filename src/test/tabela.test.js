/**
 * Testes do comando `tabela`: lista interativa (1 e 2) e atalho direto.
 *
 * Usa o despacho real (`handleInteractiveMenuReply`), o mesmo que o middleware
 * usa, para garantir que a escolha do item da lista acaba no comando certo.
 *
 * @author Dev Gui
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { OWNER_LID } from "../config.js";
import { handleInteractiveMenuReply } from "../utils/interactive.js";
import command from "../commands/member/tabela.js";
import dias from "../commands/member/tabela-dias.js";
import creditos from "../commands/member/tabela-creditos.js";

const chatId = "tabela-test@g.us";

/** Separa o que sai como lista interativa (`sendMessage`) do que sai como tabela nativa (`relayMessage`). */
function fakeSocket({ falharLista = false } = {}) {
  const interativos = [];
  const ricos = [];
  return {
    interativos,
    ricos,
    sendMessage: async (_chatId, content) => {
      if (falharLista) throw new Error("lista indisponível neste cliente");
      interativos.push(content);
      return { key: { id: `msg-${interativos.length}` } };
    },
    relayMessage: async (_remoteJid, message) => {
      ricos.push(message);
      return {};
    },
  };
}

async function abrirMenu(socket = fakeSocket()) {
  const replies = [];
  await command.handle({
    socket,
    remoteJid: chatId,
    userLid: OWNER_LID,
    webMessage: { key: { remoteJid: chatId }, pushName: "Pessoa" },
    fullArgs: "",
    sendReply: async (texto) => replies.push(texto),
    sendReact: async () => {},
    prefix: ".",
  });
  return { socket, replies, lista: socket.interativos.at(-1) };
}

test("o comando tabela manda uma lista com as duas tabelas", async () => {
  const { lista } = await abrirMenu();
  const rows = lista.sections[0].rows;
  assert.equal(rows.length, 2);
  assert.match(rows[0].title, /Tabela 1/);
  assert.match(rows[1].title, /Tabela 2/);
  assert.ok(rows[0].rowId.startsWith("kmenu:"), "a lista usa token, não o comando");
  assert.ok(rows[1].rowId.startsWith("kmenu:"));
  assert.ok(lista.footer.includes("Yanik Uaite"));
  assert.equal(lista.text.includes("Yanik Uaite"), false, "rodapé não duplica no corpo");
});

test("escolher a tabela 1 na lista despacha o comando dos planos por dias", async () => {
  const { lista } = await abrirMenu();
  const resposta = await handleInteractiveMenuReply({
    chatId,
    senderId: OWNER_LID,
    text: lista.sections[0].rows[0].rowId,
    sendReply: async () => {},
  });
  assert.equal(resposta?.selectedId, ".tabela-dias");
});

test("escolher a tabela 2 na lista despacha o comando dos pacotes de créditos", async () => {
  const { lista } = await abrirMenu();
  const resposta = await handleInteractiveMenuReply({
    chatId,
    senderId: OWNER_LID,
    text: lista.sections[0].rows[1].rowId,
    sendReply: async () => {},
  });
  assert.equal(resposta?.selectedId, ".tabela-creditos");
});

test("sem lista, o fallback em texto responde a 1 e a 2 com os comandos certos", async () => {
  const socket = fakeSocket({ falharLista: true });
  const { replies } = await abrirMenu(socket);
  assert.ok(replies.some((texto) => texto.includes("Tabela 1")));
  assert.ok(replies.some((texto) => texto.includes("Tabela 2")));

  // Cada escolha consome o menu, por isso o menu é reaberto antes de cada número.
  for (const [numero, esperado] of [["1", ".tabela-dias"], ["2", ".tabela-creditos"]]) {
    await abrirMenu(fakeSocket({ falharLista: true }));
    const resposta = await handleInteractiveMenuReply({
      chatId,
      senderId: OWNER_LID,
      text: numero,
      sendReply: async () => {},
    });
    assert.equal(resposta?.selectedId, esperado, numero);
  }
});

test(".tabela 1 e .tabela 2 enviam a tabela certa sem abrir lista", async () => {
  for (const [argumento, esperado] of [["1", "20 MT"], ["2", "15 créditos"]]) {
    const socket = fakeSocket();
    await command.handle({
      socket,
      remoteJid: chatId,
      userLid: OWNER_LID,
      webMessage: { key: { remoteJid: chatId }, pushName: "Pessoa" },
      fullArgs: argumento,
      sendReply: async () => {},
      sendReact: async () => {},
      prefix: ".",
    });
    assert.equal(socket.interativos.length, 0, `sem lista para ".tabela ${argumento}"`);
    assert.equal(socket.ricos.length, 1, `uma tabela para ".tabela ${argumento}"`);
    assert.ok(
      JSON.stringify(socket.ricos[0]).includes(esperado),
      `"${esperado}" ausente em ".tabela ${argumento}"`,
    );
  }
});

test(".tabela com valor inválido avisa em vez de mandar lista", async () => {
  await assert.rejects(
    command.handle({
      socket: fakeSocket(),
      remoteJid: chatId,
      userLid: OWNER_LID,
      webMessage: { key: { remoteJid: chatId } },
      fullArgs: "99",
      sendReply: async () => {},
      sendReact: async () => {},
      prefix: ".",
    }),
    /não existe/,
  );
});

test("os comandos secundários enviam a respetiva tabela", async () => {
  const socketDias = fakeSocket();
  await dias.handle({
    socket: socketDias,
    remoteJid: chatId,
    webMessage: { key: { remoteJid: chatId } },
    sendReply: async () => {},
    sendReact: async () => {},
  });
  const textoDias = JSON.stringify(socketDias.ricos[0]);
  assert.ok(textoDias.includes("60 dias") && textoDias.includes("140 MT"));

  const socketCreditos = fakeSocket();
  await creditos.handle({
    socket: socketCreditos,
    remoteJid: chatId,
    webMessage: { key: { remoteJid: chatId } },
    sendReply: async () => {},
    sendReact: async () => {},
  });
  const textoCreditos = JSON.stringify(socketCreditos.ricos[0]);
  assert.ok(textoCreditos.includes("20 MT") && textoCreditos.includes("65 créditos"));
});

test("quando o rich response falha, a tabela cai no texto", async () => {
  const enviados = [];
  const socket = {
    sendMessage: async (_chatId, content) => {
      enviados.push(content);
      return { key: { id: "x" } };
    },
    relayMessage: async () => {
      throw new Error("relay indisponível");
    },
  };

  await dias.handle({
    socket,
    remoteJid: chatId,
    webMessage: { key: { remoteJid: chatId } },
    sendReply: async (texto) => enviados.push(texto),
    sendReact: async () => {},
  });

  const texto = enviados.map((item) => JSON.stringify(item)).join("\n");
  assert.ok(texto.includes("140 MT"), "o fallback tem de conter os preços");
});
