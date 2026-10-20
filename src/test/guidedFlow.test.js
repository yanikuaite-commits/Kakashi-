import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getGuidedSession,
  handleGuidedFlow,
  openGuidedSession,
  resetGuidedSessions,
} from "../interactive/flow.js";
import { handleVideoFormatReply } from "../utils/videoFormatMenu.js";
import { extractDataFromMessage } from "../utils/index.js";

const GROUP = "grupo-flow@g.us";
const DONO = "membro-flow@lid";

function criarAmbiente({ chatId = GROUP } = {}) {
  const enviadas = [];
  const replies = [];

  const socket = {
    sendMessage: async (_chatId, content) => {
      enviadas.push(content);
      return { key: { id: "MSG-TESTE" } };
    },
  };

  const sendReply = async (text, mentions) => {
    replies.push({ text, mentions });
  };

  return { chatId, socket, sendReply, enviadas, replies };
}

function listaIds(conteudo) {
  const lista = conteudo.interactiveButtons?.find(
    (botao) => botao.name === "single_select",
  );
  if (!lista) return null;
  return JSON.parse(lista.buttonParamsJson)
    .sections.flatMap((secao) => secao.rows)
    .map((linha) => linha.id);
}

function respostasDoMenu(ambiente) {
  return ambiente.enviadas.filter((conteudo) => conteudo.sections);
}

function limpar() {
  resetGuidedSessions();
}

/* ═══════════ DOWNLOAD · TIKTOK ═══════════ */

test(" tik-tok: link baixa direto e mantém a função ativa", async (t) => {
  limpar();
  const ambiente = criarAmbiente();

  const session = await openGuidedSession({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: DONO,
    ownerName: "Membro",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: false },
  });
  assert.ok(session);

  // Card da função.
  assert.equal(
    await handleGuidedFlow({
      socket: ambiente.socket,
      chatId: GROUP,
      senderId: DONO,
      text: "fn:download:tiktok",
      commonFunctions: {},
      sendReply: ambiente.sendReply,
      dispatch: async () => {},
    }),
    true,
  );

  const sessao = getGuidedSession(GROUP, DONO);
  assert.equal(sessao.pending.funcaoId, "tiktok");

  // Lista ÚNICA com navegação + Canal; sem quick_reply.
  const card = ambiente.enviadas.at(-1);
  const ids = listaIds(card);
  assert.ok(ids.includes("back:download"));
  assert.ok(ids.includes("menu:main"));
  assert.ok(ids.includes("cancel"));
  assert.ok(
    card.interactiveButtons.every(
      (botao) => botao.name === "single_select" || botao.name === "cta_url",
    ),
  );

  // O link é a entrada da função pendente.
  const pedidos = [];
  assert.equal(
    await handleGuidedFlow({
      socket: ambiente.socket,
      chatId: GROUP,
      senderId: DONO,
      text: "https://vm.tiktok.com/ZM1234567890/",
      commonFunctions: {},
      sendReply: ambiente.sendReply,
      dispatch: async (props) => {
        pedidos.push(props);
      },
    }),
    true,
  );

  assert.deepEqual(pedidos, [
    {
      comando: "tik-tok",
      categoria: "download",
      funcao: "tiktok",
      input: "https://vm.tiktok.com/ZM1234567890/",
      args: "",
    },
  ]);

  // "⏳ Já estou a tratar..." com menção; depois o texto final simples.
  assert.ok(ambiente.replies.some((r) => /Já estou a tratar/.test(r.text)));
  assert.deepEqual(ambiente.replies.find((r) => /Já estou/.test(r.text)).mentions, [
    DONO,
  ]);
  const fim = ambiente.replies.at(-1).text;
  assert.match(fim, /Envie outro link ou use \.menu/);

  // Função continua ativa: outro link nem precisa reabrir o card.
  const pedidos2 = [];
  await handleGuidedFlow({
    socket: ambiente.socket,
    chatId: GROUP,
    senderId: DONO,
    text: "https://vt.tiktok.com/ZM9999/",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async (props) => {
      pedidos2.push(props);
    },
  });
  assert.equal(pedidos2[0].input, "https://vt.tiktok.com/ZM9999/");
});

/* ═══════════ DOWNLOAD · YOUTUBE VÍDEO (OPCOES) ═══════════ */

test(" youtube-video: link guardado; lista de qualidade; escolha baixa", async (t) => {
  limpar();
  const ambiente = criarAmbiente();

  await openGuidedSession({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: DONO,
    ownerName: "Membro",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: false },
  });

  assert.equal(
    await handleGuidedFlow({
      socket: ambiente.socket,
      chatId: GROUP,
      senderId: DONO,
      text: "fn:download:youtube-video",
      commonFunctions: {},
      sendReply: ambiente.sendReply,
      dispatch: async () => {},
    }),
    true,
  );

  // Link → guarda na sessão e envia a LISTA de qualidade (sem baixar).
  const pedidos = [];
  await handleGuidedFlow({
    socket: ambiente.socket,
    chatId: GROUP,
    senderId: DONO,
    text: "https://youtu.be/abc123",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async (props) => {
      pedidos.push(props);
    },
  });

  assert.deepEqual(pedidos, [], "download não acontece na escolha do link");

  const sessao = getGuidedSession(GROUP, DONO);
  assert.equal(sessao.pending.funcaoId, "youtube-video");
  assert.equal(sessao.pending.input, "https://youtu.be/abc123");

  // A lista de qualidade foi enviada como listMessage com tokens vfmt:*.
  const listas = respostasDoMenu(ambiente);
  assert.ok(listas.length >= 1);
  const idsQualidade = listas
    .at(-1)
    .sections.flatMap((secao) => secao.rows)
    .map((linha) => linha.rowId);
  assert.deepEqual(idsQualidade, [
    "vfmt:360",
    "vfmt:480",
    "vfmt:720",
    "vfmt:1080",
    "vfmt:best",
  ]);

  // O token vfmt:NUNCA é tratado pelo fluxo guiado (segue para o menu).
  assert.equal(
    await handleGuidedFlow({
      socket: ambiente.socket,
      chatId: GROUP,
      senderId: DONO,
      text: "vfmt:720",
      commonFunctions: {},
      sendReply: ambiente.sendReply,
      dispatch: async () => {
        throw new Error("não devia despachar comando");
      },
    }),
    false,
  );

  // 720p (token ou número do fallback): baixa e envia o vídeo.
  const baixados = [];
  const enviados = [];
  const final = [];
  await handleVideoFormatReply({
    chatId: GROUP,
    senderLid: DONO,
    text: "vfmt:720",
    socket: ambiente.socket,
    jid: DONO,
    sendReply: ambiente.sendReply,
    sendErrorReply: ambiente.sendReply,
    sendVideoFromFile: async (_path, caption) => {
      enviados.push(caption);
    },
    onFinished: async () => {
      final.push("ok");
    },
    download: async (source, height) => {
      baixados.push({ source, height });
      return { filePath: "/tmp/video.mp4", mimetype: "video/mp4" };
    },
  });

  assert.deepEqual(baixados, [
    { source: "https://youtu.be/abc123", height: 720 },
  ]);
  assert.ok(enviados[0].includes("720p"));
  assert.deepEqual(final, ["ok"]);

  // A escolha consumiu a pendência de qualidade do videoFormatMenu...
  assert.equal(
    await handleVideoFormatReply({
      chatId: GROUP,
      senderLid: DONO,
      text: "vfmt:360",
      socket: ambiente.socket,
      jid: DONO,
      sendReply: ambiente.sendReply,
      sendVideoFromFile: async () => {},
    }),
    false,
  );
});

test(" youtube-resposta do WhatsApp chega ao fluxo com snake_case", () => {
  // Causa raiz do silêncio: nativeFlowResponseMessage.paramsJson traz
  // selected_row_id (snake_case). extractDataFromMessage tem de ler.
  const resposta = extractDataFromMessage({
    key: { remoteJid: GROUP },
    message: {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          name: "single_select",
          paramsJson: JSON.stringify({ selected_row_id: "cat:download" }),
        },
      },
    },
  });

  assert.equal(resposta.fullMessage, "cat:download");
});

/* ═══════════ COMPORTAMENTO TRANSVERSAL ═══════════ */

test(" menu de outro membro: só o autor navega", async (t) => {
  limpar();
  const ambiente = criarAmbiente();
  await openGuidedSession({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: DONO,
    ownerName: "Membro",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: false },
  });

  await handleGuidedFlow({
    ...ambiente,
    senderId: "outro@lid",
    text: "cat:download",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async () => {},
  });

  assert.match(ambiente.replies.at(-1).text, /menu é de @Membro/);
});

test(" link inválido avisa e mantém a pendência", async (t) => {
  limpar();
  const ambiente = criarAmbiente();
  await openGuidedSession({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: DONO,
    ownerName: "Membro",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: false },
  });

  await handleGuidedFlow({
    ...ambiente,
    senderId: DONO,
    text: "fn:download:tiktok",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async () => {},
  });

  await handleGuidedFlow({
    ...ambiente,
    senderId: DONO,
    text: "isto não é um link",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async () => {},
  });

  assert.ok(ambiente.replies.at(-1).text.includes("não parece um link"));
  assert.equal(getGuidedSession(GROUP, DONO).pending.funcaoId, "tiktok");
});

/* ═══════════ BOTÃO DO DONO EM TODOS OS CARDS ═══════════ */

test("botão Dono aparece em todos os cards do fluxo guiado", async () => {
  limpar();
  const ambiente = criarAmbiente();

  const donoDe = (card) =>
    card.interactiveButtons.find((botao) => {
      if (botao.name !== "cta_url") return false;
      const params = JSON.parse(botao.buttonParamsJson);
      return params.display_text === "👑 Dono";
    });

  await openGuidedSession({
    socket: ambiente.socket,
    chatId: GROUP,
    ownerId: DONO,
    ownerName: "Membro",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: false },
  });

  // Card 1: menu principal.
  await handleGuidedFlow({
    ...ambiente,
    senderId: DONO,
    text: "menu:main",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async () => {},
  });
  assert.deepEqual(
    JSON.parse(donoDe(ambiente.enviadas.at(-1)).buttonParamsJson),
    { display_text: "👑 Dono", url: "https://wa.me/258834788141" },
  );

  // Card 2: categoria escolhida.
  await handleGuidedFlow({
    ...ambiente,
    senderId: DONO,
    text: "cat:download",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async () => {},
  });
  assert.deepEqual(
    JSON.parse(donoDe(ambiente.enviadas.at(-1)).buttonParamsJson),
    { display_text: "👑 Dono", url: "https://wa.me/258834788141" },
  );

  // Card 3: função escolhida.
  await handleGuidedFlow({
    ...ambiente,
    senderId: DONO,
    text: "fn:download:tiktok",
    commonFunctions: {},
    sendReply: ambiente.sendReply,
    dispatch: async () => {},
  });
  assert.deepEqual(
    JSON.parse(donoDe(ambiente.enviadas.at(-1)).buttonParamsJson),
    { display_text: "👑 Dono", url: "https://wa.me/258834788141" },
  );

  // O WhatsApp aceita no máximo 3 botões por card.
  for (const card of ambiente.enviadas) {
    assert.ok(
      card.interactiveButtons.length <= 3,
      `card com ${card.interactiveButtons.length} botões`,
    );
  }
});

