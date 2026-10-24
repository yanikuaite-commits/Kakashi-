import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DATABASE_DIR } from "../config.js";
import comando from "../commands/owner/private-whitelist.js";
import {
  getGuidedSession,
  handleGuidedFlow,
  openGuidedSession,
  resetGuidedSessions,
} from "../interactive/flow.js";
import { getFunction } from "../interactive/menuRegistry.js";
import { getPrivateWhitelist } from "../utils/database.js";

const ARQUIVO = path.join(DATABASE_DIR, "private-whitelist.json");
const PRIVADO = "privado-teste@s.whatsapp.net";
const DONO = "dono-teste@lid";

/** Guarda e repõe a whitelist real: os testes não podem deixar lixo no banco. */
async function comWhitelistLimpa(fn) {
  const anterior = await readFile(ARQUIVO).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

  try {
    await writeFile(ARQUIVO, "[]");
    return await fn();
  } finally {
    if (anterior === null) await rm(ARQUIVO, { force: true });
    else await writeFile(ARQUIVO, anterior);
  }
}

/** Corre o comando como o dynamicCommand o chamaria. */
async function correr(texto, { remoteJid = "grupo@g.us" } = {}) {
  const [, ...resto] = String(texto).split(/\s+/);
  const enviadas = [];

  const executar = () =>
    comando.handle({
      fullArgs: resto.join(" "),
      remoteJid,
      sendSuccessReply: async (message) => enviadas.push(message),
    });

  return { enviadas, executar };
}

function criarAmbiente() {
  const enviadas = [];
  const replies = [];
  const socket = {
    sendMessage: async (_chatId, content) => {
      enviadas.push(content);
      return { key: { id: "MSG-TESTE" } };
    },
  };

  return {
    socket,
    sendReply: async (text) => replies.push(String(text)),
    enviadas,
    replies,
  };
}

/* ═══════════ COMANDO · SINTAXE E NORMALIZAÇÃO ═══════════ */

test("private-whitelist: aceita a sintaxe com espaços documentada", async () => {
  await comWhitelistLimpa(async () => {
    // `args` do projeto separa por `\`, `|` e `/`, não por espaço: com
    // `.private-whitelist add <lid>` o LID vinha colado à ação e o comando
    // respondia sempre com o erro de uso.
    const { enviadas, executar } = await correr(
      ".private-whitelist add 275381038891241@lid",
    );
    await executar();

    assert.deepEqual(getPrivateWhitelist(), ["275381038891241@lid"]);
    assert.match(enviadas.at(-1), /autorizado/i);
  });
});

test("private-whitelist: normaliza as formas do mesmo LID", async () => {
  await comWhitelistLimpa(async () => {
    for (const entrada of [
      "275381038891241:12@lid", // sufixo de aparelho
      "275381038891241", // só o número
      "+275 381 038 891 241", // com + e espaços
    ]) {
      await writeFile(ARQUIVO, "[]");
      const { executar } = await correr(`.private-whitelist add ${entrada}`);
      await executar();

      assert.deepEqual(
        getPrivateWhitelist(),
        ["275381038891241@lid"],
        `entrada ${entrada}`,
      );
    }
  });
});

test("private-whitelist: remove e lista", async () => {
  await comWhitelistLimpa(async () => {
    await (await correr(".private-whitelist add 11111111111@lid")).executar();
    await (await correr(".private-whitelist add 22222222222@lid")).executar();

    const lista = await correr(".private-whitelist list");
    await lista.executar();
    assert.match(lista.enviadas.at(-1), /11111111111@lid/);
    assert.match(lista.enviadas.at(-1), /22222222222@lid/);

    const remover = await correr(".private-whitelist remove 11111111111@lid");
    await remover.executar();
    assert.deepEqual(getPrivateWhitelist(), ["22222222222@lid"]);
  });
});

test("private-whitelist: sem LID em grupo explica o que falta", async () => {
  await comWhitelistLimpa(async () => {
    const { executar } = await correr(".private-whitelist add");

    await assert.rejects(executar, (error) =>
      /Envie o LID da pessoa/.test(error.message),
    );
  });
});

test("private-whitelist: uso desconhecido é recusado", async () => {
  await comWhitelistLimpa(async () => {
    const { executar } = await correr(".private-whitelist apagar 111@lid");

    await assert.rejects(executar, (error) =>
      /add\|remove\|list/.test(error.message),
    );
  });
});

/* ═══════════ FLUXO GUIADO · MENU DO DONO ═══════════ */

test("menu do dono: whitelist pede só o LID e já traz a ação add", async () => {
  resetGuidedSessions();
  const ambiente = criarAmbiente();

  await openGuidedSession({
    socket: ambiente.socket,
    chatId: PRIVADO,
    ownerId: DONO,
    ownerName: "Dono",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: true },
  });

  await handleGuidedFlow({
    socket: ambiente.socket,
    chatId: PRIVADO,
    senderId: DONO,
    text: "fn:dono:private-whitelist",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async () => {},
  });

  const card = ambiente.enviadas.at(-1);

  assert.match(card.text, /Envie o LID da pessoa/);
  // O atalho mostra o comando completo: o dono não escreve `add`.
  assert.match(card.text, /\.private-whitelist add 275381038891241@lid/);

  const sessao = getGuidedSession(PRIVADO, DONO);
  assert.equal(sessao.pending.funcaoId, "private-whitelist");
});

test("menu do dono: o LID enviado é despachado com a ação add", async () => {
  resetGuidedSessions();
  const ambiente = criarAmbiente();

  await openGuidedSession({
    socket: ambiente.socket,
    chatId: PRIVADO,
    ownerId: DONO,
    ownerName: "Dono",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: true },
  });

  await handleGuidedFlow({
    socket: ambiente.socket,
    chatId: PRIVADO,
    senderId: DONO,
    text: "fn:dono:private-whitelist",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async () => {},
  });

  const pedidos = [];
  await handleGuidedFlow({
    socket: ambiente.socket,
    chatId: PRIVADO,
    senderId: DONO,
    text: "275381038891241@lid",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async (props) => {
      pedidos.push(props);
    },
  });

  assert.deepEqual(pedidos, [
    {
      comando: "private-whitelist",
      categoria: "dono",
      funcao: "private-whitelist",
      input: "275381038891241@lid",
      args: "add",
    },
  ]);
});

test("menu do dono: entrada que não é LID avisa e mantém a pendência", async () => {
  resetGuidedSessions();
  const ambiente = criarAmbiente();

  await openGuidedSession({
    socket: ambiente.socket,
    chatId: PRIVADO,
    ownerId: DONO,
    ownerName: "Dono",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: true },
  });

  await handleGuidedFlow({
    socket: ambiente.socket,
    chatId: PRIVADO,
    senderId: DONO,
    text: "fn:dono:private-whitelist",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async () => {},
  });

  const pedidos = [];
  await handleGuidedFlow({
    socket: ambiente.socket,
    chatId: PRIVADO,
    senderId: DONO,
    text: "isto não é um lid",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async (props) => {
      pedidos.push(props);
    },
  });

  assert.equal(pedidos.length, 0);
  // A mensagem diz o que se espera, e não "um texto válido".
  assert.match(ambiente.replies.at(-1), /não parece um LID/);
  assert.equal(
    getGuidedSession(PRIVADO, DONO).pending.funcaoId,
    "private-whitelist",
  );
});

test("menu do dono: o validador de LID aceita as formas do WhatsApp", () => {
  const { validador } = getFunction("dono", "private-whitelist");

  for (const bom of [
    "275381038891241@lid",
    "275381038891241:12@lid",
    "275381038891241",
    "258840000000@s.whatsapp.net",
  ]) {
    assert.equal(validador(bom), true, bom);
  }

  for (const mau of ["", "ola", "12", "isto não é um lid"]) {
    assert.equal(validador(mau), false, mau);
  }
});
