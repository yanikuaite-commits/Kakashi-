import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { OWNER_LID } from "../config.js";
import {
  CATEGORIES,
  FUNCTIONS,
  canAccess,
  getCategory,
  listCategories,
  listFunctions,
} from "../interactive/menuRegistry.js";
import {
  GUIDED_TTL_MS,
  getGuidedSession,
  handleGuidedFlow,
  resetGuidedSessions,
  sendMainCard,
  startGuidedMenu,
} from "../interactive/flow.js";
import { findCommandImport, formatCommand } from "../utils/index.js";
import menuCommand from "../commands/member/menu.js";

const GROUP = "grupo@g.us";

function criarAmbiente({ chatId = GROUP } = {}) {
  const cards = [];
  const replies = [];
  const dispatches = [];

  const socket = {
    sendMessage: async (_chatId, content) => {
      cards.push(content);
    },
  };

  const sendReply = async (text, mentions) => {
    replies.push({ text, mentions });
  };

  const dispatch = async (dados) => {
    dispatches.push(dados);
  };

  return { chatId, socket, sendReply, dispatch, cards, replies, dispatches };
}

afterEach(() => {
  try {
    mock.timers.reset();
  } catch {
    // Os timers só são mockados no teste de expiração.
  }
  resetGuidedSessions();
});

/* ═══════════ REGISTO ═══════════ */

test("registo cobre as categorias e aponta só para comandos existentes", async () => {
  assert.equal(CATEGORIES.length, 14);

  for (const categoria of CATEGORIES) {
    assert.ok(categoria.descricao.length > 10, `${categoria.id} sem descrição`);
  }

  for (const funcao of FUNCTIONS) {
    assert.ok(getCategory(funcao.categoria), `${funcao.id}: categoria inválida`);
    assert.ok(
      ["link", "texto", "midia", "nenhum"].includes(funcao.aceita),
      `${funcao.id}: aceita inválido`,
    );

    const encontrado = await findCommandImport(formatCommand(funcao.comando));
    assert.ok(
      encontrado.command,
      `${funcao.categoria}/${funcao.id}: comando "${funcao.comando}" não existe`,
    );
  }
});

test("categorias restritas só aparecem para quem tem permissão", () => {
  assert.equal(canAccess(getCategory("dono"), { isOwner: false }), false);
  assert.equal(
    canAccess(getCategory("admin"), { isOwner: false, isAdmin: false }),
    false,
  );
  assert.equal(
    canAccess(getCategory("admin"), { isOwner: false, isAdmin: true }),
    true,
  );
  assert.equal(canAccess(getCategory("download"), {}), true);

  const membro = listCategories({}).map(({ id }) => id);
  assert.ok(!membro.includes("dono"));
  assert.ok(!membro.includes("admin"));
  assert.ok(membro.includes("download"));

  const dono = listCategories({ isOwner: true }).map(({ id }) => id);
  assert.ok(dono.includes("dono"));
});

/* ═══════════ PASSO 1 · MENU PRINCIPAL ═══════════ */

test("menu principal mostra Dono só para o dono e abre as categorias", async () => {
  const ambiente = criarAmbiente();

  await startGuidedMenu({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: "membro@lid",
    ownerName: "Membro",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: false },
  });

  const card = ambiente.cards.at(-1);
  const ids = card.interactiveButtons
    .map((botao) => JSON.parse(botao.buttonParamsJson).id)
    .filter(Boolean);
  assert.deepEqual(ids, ["menu:categories"]);
  // O botão do canal é um link externo (cta_url), sem ID de resposta.
  assert.ok(
    card.interactiveButtons.some((botao) => botao.name === "cta_url"),
  );
  assert.match(card.text, /Ver Menus/);
  assert.match(card.text, /Made by Yanik Uaite/);

  await startGuidedMenu({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: OWNER_LID,
    ownerName: "Dono",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: true, isAdmin: true },
  });

  const cardDono = ambiente.cards.at(-1);
  const idsDono = cardDono.interactiveButtons
    .map((botao) => JSON.parse(botao.buttonParamsJson).id)
    .filter(Boolean);
  assert.deepEqual(idsDono, ["cat:dono", "menu:categories"]);

  // "Ver Menus" → lista single_select com as categorias.
  assert.equal(
    await handleGuidedFlow({
      ...ambiente,
      senderId: "membro@lid",
      text: "menu:categories",
      commonFunctions: {},
    }),
    true,
  );

  const lista = ambiente.cards.at(-1);
  assert.equal(lista.sections[0].rows.length, 9); // 8 categorias + "mais"
  assert.equal(lista.sections[0].rows[0].rowId, "cat:geral");
});

/* ═══════════ PASSOS 2-4 · FLUXO COMPLETO DO TIKTOK ═══════════ */

test("fluxo completo do TikTok vai da categoria à execução do comando", async () => {
  const ambiente = criarAmbiente();

  await startGuidedMenu({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: "membro@lid",
    ownerName: "Membro",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: false },
  });

  // Categoria Downloads.
  assert.equal(
    await handleGuidedFlow({
      ...ambiente,
      senderId: "membro@lid",
      text: "cat:download",
      commonFunctions: {},
    }),
    true,
  );

  const categoria = ambiente.cards.at(-1);
  assert.match(categoria.text, /Baixe vídeos e músicas/);
  assert.match(categoria.text, /Prefixo \[ \./);
  const botoesCategoria = categoria.interactiveButtons.map(
    (botao) => JSON.parse(botao.buttonParamsJson).id,
  );
  assert.equal(botoesCategoria[0], "fnlist:download:0");

  // Lista de funções.
  await handleGuidedFlow({
    ...ambiente,
    senderId: "membro@lid",
    text: "fnlist:download:0",
    commonFunctions: {},
  });
  const funcoes = ambiente.cards.at(-1).sections[0].rows.map((linha) => linha.rowId);
  assert.ok(funcoes.includes("fn:download:tiktok"));
  assert.ok(funcoes.includes("fn:download:youtube-audio"));

  // Card da função cria o estado pendente.
  await handleGuidedFlow({
    ...ambiente,
    senderId: "membro@lid",
    text: "fn:download:tiktok",
    commonFunctions: {},
  });

  const cardFuncao = ambiente.cards.at(-1);
  assert.match(cardFuncao.text, /Envie o link do vídeo do TikTok/);
  assert.match(cardFuncao.text, /tik-tok/);
  assert.ok(getGuidedSession(GROUP, "membro@lid").pending);

  // Passo 4: o link é validado e o comando existente é executado.
  assert.equal(
    await handleGuidedFlow({
      ...ambiente,
      senderId: "membro@lid",
      text: "https://vm.tiktok.com/ZMabc123",
      commonFunctions: {},
    }),
    true,
  );

  assert.deepEqual(ambiente.dispatches, [
    {
      comando: "tik-tok",
      categoria: "download",
      funcao: "tiktok",
      input: "https://vm.tiktok.com/ZMabc123",
      args: "",
    },
  ]);
  assert.match(ambiente.replies[0].text, /Já estou a tratar do teu pedido/);
  assert.equal(getGuidedSession(GROUP, "membro@lid").pending, null);

  const resultado = ambiente.cards.at(-1);
  assert.deepEqual(
    resultado.interactiveButtons.map(
      (botao) => JSON.parse(botao.buttonParamsJson).id,
    ),
    ["fn:download:tiktok", "back:download", "menu:main"],
  );
});

/* ═══════════ VALIDAÇÃO E ESTADO ═══════════ */

async function abrirFuncaoTiktok(ambiente) {
  await startGuidedMenu({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: "membro@lid",
    ownerName: "Membro",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: false },
  });

  await handleGuidedFlow({
    ...ambiente,
    senderId: "membro@lid",
    text: "fn:download:tiktok",
    commonFunctions: {},
  });
}

test("link inválido avisa sem apagar o estado e aceita a correção", async () => {
  const ambiente = criarAmbiente();
  await abrirFuncaoTiktok(ambiente);

  assert.equal(
    await handleGuidedFlow({
      ...ambiente,
      senderId: "membro@lid",
      text: "https://exemplo.com/video",
      commonFunctions: {},
    }),
    true,
  );

  assert.equal(ambiente.dispatches.length, 0);
  assert.match(ambiente.cards.at(-1).text, /não parece um link de \*TikTok\*/);
  assert.ok(getGuidedSession(GROUP, "membro@lid").pending);

  await handleGuidedFlow({
    ...ambiente,
    senderId: "membro@lid",
    text: "https://vt.tiktok.com/ZSabc",
    commonFunctions: {},
  });

  assert.equal(ambiente.dispatches.length, 1);
  assert.equal(
    ambiente.dispatches[0].input,
    "https://vt.tiktok.com/ZSabc",
  );
});

test("só quem abriu o menu pode usar os botões", async () => {
  const ambiente = criarAmbiente();
  await abrirFuncaoTiktok(ambiente);

  assert.equal(
    await handleGuidedFlow({
      ...ambiente,
      senderId: "outro@lid",
      senderName: "Outro",
      text: "cancel",
      commonFunctions: {},
    }),
    true,
  );

  assert.match(ambiente.replies.at(-1).text, /Este menu é de @Membro/);
  assert.deepEqual(ambiente.replies.at(-1).mentions, ["membro@lid"]);
  assert.ok(getGuidedSession(GROUP, "membro@lid").pending);

  // O dono do pedido continua a poder cancelar.
  await handleGuidedFlow({
    ...ambiente,
    senderId: "membro@lid",
    text: "cancel",
    commonFunctions: {},
  });
  assert.equal(getGuidedSession(GROUP, "membro@lid").pending, null);
  assert.match(ambiente.cards.at(-1).text, /cancelado/i);

  // Depois de cancelar, texto livre volta ao fluxo normal dos comandos.
  assert.equal(
    await handleGuidedFlow({
      ...ambiente,
      senderId: "membro@lid",
      text: "https://vm.tiktok.com/ZMabc123",
      commonFunctions: {},
    }),
    false,
  );
});

test("comando com prefixo cancela o estado e segue normalmente", async () => {
  const ambiente = criarAmbiente();
  await abrirFuncaoTiktok(ambiente);

  assert.equal(
    await handleGuidedFlow({
      ...ambiente,
      senderId: "membro@lid",
      text: ".ping",
      commonFunctions: {},
    }),
    false,
  );

  assert.equal(getGuidedSession(GROUP, "membro@lid").pending, null);
  assert.match(ambiente.replies.at(-1).text, /Pedido cancelado/);
});

test("estado pendente expira em 2 minutos", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const ambiente = criarAmbiente();
  await abrirFuncaoTiktok(ambiente);

  assert.equal(GUIDED_TTL_MS, 120_000);
  assert.ok(getGuidedSession(GROUP, "membro@lid").pending);

  mock.timers.tick(GUIDED_TTL_MS);

  assert.equal(getGuidedSession(GROUP, "membro@lid"), null);
  assert.match(ambiente.replies.at(-1).text, /O tempo deste menu terminou/);

  assert.equal(
    await handleGuidedFlow({
      ...ambiente,
      senderId: "membro@lid",
      text: "https://vm.tiktok.com/ZMabc123",
      commonFunctions: {},
    }),
    false,
  );
});

test("fallback sem botões aceita a resposta numérica", async () => {
  const replies = [];
  const cards = [];

  // sendMessage sempre falha → o helper cai no texto numerado.
  const socket = {
    sendMessage: async () => {
      throw new Error("sem suporte a botões");
    },
  };

  const sendReply = async (text) => replies.push({ text });

  await startGuidedMenu({
    socket,
    chatId: GROUP,
    ownerId: "membro@lid",
    ownerName: "Membro",
    sendReply,
    permissions: { isOwner: false, isAdmin: false },
  });

  assert.match(replies[0].text, /1\. 📚 Ver Menus/);
  assert.equal(getGuidedSession(GROUP, "membro@lid").cardFallback, true);

  const dispatch = async () => {};
  assert.equal(
    await handleGuidedFlow({
      socket,
      chatId: GROUP,
      senderId: "membro@lid",
      text: "1",
      commonFunctions: {},
      sendReply,
      dispatch,
    }),
    true,
  );

  assert.match(replies.at(-1).text, /Downloads/);
  assert.match(replies.at(-1).text, /Mais categorias/);
});

test("dono abre a categoria restrita; membro recebe recusa", async () => {
  const ambiente = criarAmbiente();

  await startGuidedMenu({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: "membro@lid",
    ownerName: "Membro",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: false },
  });

  assert.equal(
    await handleGuidedFlow({
      ...ambiente,
      senderId: "membro@lid",
      text: "cat:dono",
      commonFunctions: {},
    }),
    true,
  );
  assert.match(ambiente.replies.at(-1).text, /permissão/);

  await startGuidedMenu({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: "admin@lid",
    ownerName: "Admin",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: true },
  });

  await handleGuidedFlow({
    ...ambiente,
    senderId: "admin@lid",
    text: "cat:admin",
    commonFunctions: {},
  });
  assert.match(ambiente.cards.at(-1).text, /Administração do grupo/);
});

test("função de mídia exige imagem/vídeo e função sem entrada executa no toque", async () => {
  const ambiente = criarAmbiente();

  await startGuidedMenu({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: "membro@lid",
    ownerName: "Membro",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: false },
  });

  // Sticker: aceita apenas mídia.
  await handleGuidedFlow({
    ...ambiente,
    senderId: "membro@lid",
    text: "fn:sticker:sticker",
    commonFunctions: {},
  });
  assert.ok(getGuidedSession(GROUP, "membro@lid").pending);

  await handleGuidedFlow({
    ...ambiente,
    senderId: "membro@lid",
    text: "texto qualquer",
    commonFunctions: {},
  });
  assert.equal(ambiente.dispatches.length, 0);
  assert.match(ambiente.cards.at(-1).text, /não parece uma mídia/);

  await handleGuidedFlow({
    ...ambiente,
    senderId: "membro@lid",
    text: "imagem",
    commonFunctions: { isImage: true },
  });
  assert.deepEqual(ambiente.dispatches.at(-1), {
    comando: "sticker",
    categoria: "sticker",
    funcao: "sticker",
    input: "",
    args: "",
  });

  // Ping: aceita "nenhum" e executa pelo botão ▶️ Executar.
  await handleGuidedFlow({
    ...ambiente,
    senderId: "membro@lid",
    text: "fn:geral:ping",
    commonFunctions: {},
  });
  const cardPing = ambiente.cards.at(-1);
  assert.match(cardPing.text, /Toca em \*Executar\*/);

  await handleGuidedFlow({
    ...ambiente,
    senderId: "membro@lid",
    text: "run:geral:ping",
    commonFunctions: {},
  });
  assert.equal(ambiente.dispatches.at(-1).comando, "ping");
});

test("o comando .menu envia o card principal e .menu <categoria> abre a categoria", async () => {
  const ambiente = criarAmbiente();

  await menuCommand.handle({
    socket: ambiente.socket,
    remoteJid: GROUP,
    fullArgs: "",
    webMessage: { pushName: "Membro" },
    userLid: "membro@lid",
    sendReply: ambiente.sendReply,
    isOwner: false,
  });

  // `.menu` agora abre o card visual principal (src/utils/mainMenu.js).
  const card = ambiente.cards.at(-1);
  assert.match(card.caption || card.text, /You Name: @Membro/);
  assert.ok(
    card.interactiveButtons.some((botao) =>
      botao.buttonParamsJson.includes("Ver Menus"),
    ),
  );

  await menuCommand.handle({
    socket: ambiente.socket,
    remoteJid: GROUP,
    fullArgs: "download",
    webMessage: { pushName: "Membro" },
    userLid: "membro@lid",
    sendReply: ambiente.sendReply,
    isOwner: false,
  });

  assert.match(ambiente.cards.at(-1).text, /Baixe vídeos e músicas/);

  await assert.rejects(
    menuCommand.handle({
      socket: ambiente.socket,
      remoteJid: GROUP,
      fullArgs: "inexistente",
      webMessage: { pushName: "Membro" },
      userLid: "membro@lid",
      sendReply: ambiente.sendReply,
    }),
    /Categoria desconhecida/,
  );
});

test("sendMainCard também pode ser chamado direto pela sessão", async () => {
  const ambiente = criarAmbiente();
  const session = {
    chatId: GROUP,
    key: `${GROUP}:x@lid`,
    ownerId: "x@lid",
    ownerName: "X",
    permissions: { isOwner: false, isAdmin: false },
    sendReply: ambiente.sendReply,
    options: new Map(),
    pending: null,
    timer: null,
  };

  const sent = await sendMainCard({ socket: ambiente.socket, session });
  assert.equal(sent, true);
  assert.match(ambiente.cards.at(-1).text, /Categorias disponíveis/);
});
