import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, mock, test } from "node:test";
import { BOT_NAME, MAIN_MENU_FOOTER } from "../config.js";
import {
  buildMainMenuBody,
  buildMainMenuButtons,
  buildMainMenuSections,
  loadMainMenuImage,
  mainMenuClock,
  mainMenuOwnerUrl,
  mainMenuVelocity,
  sendMainMenu,
} from "../utils/mainMenu.js";
import {
  getGuidedSession,
  handleGuidedFlow,
  resetGuidedSessions,
} from "../interactive/flow.js";
import menuCommand from "../commands/member/menu.js";
import { extractDataFromMessage } from "../utils/index.js";

const GROUP = "grupo@g.us";
const AGORA = Date.parse("2026-12-25T21:30:06Z");
const TIMESTAMP_MENSAGEM = AGORA / 1000 - 0.25;

function criarAmbiente({ chatId = GROUP } = {}) {
  const cards = [];
  const replies = [];

  const socket = {
    sendMessage: async (_chatId, content) => {
      cards.push(content);
    },
  };

  const sendReply = async (text, mentions) => {
    replies.push({ text, mentions });
  };

  return { chatId, socket, sendReply, cards, replies };
}

function abrirMenu(ambiente, extras = {}) {
  return sendMainMenu(ambiente.socket, ambiente.chatId, {
    ownerId: "membro@lid",
    ownerName: "Membro",
    sendReply: ambiente.sendReply,
    permissions: { isOwner: false, isAdmin: false },
    timestamp: TIMESTAMP_MENSAGEM,
    now: AGORA,
    ...extras,
  });
}

afterEach(() => {
  try {
    mock.timers.reset();
  } catch {
    // Só o teste de timeout usa timers mockados.
  }
  resetGuidedSessions();
});

/* ═══════════ VALORES DINÂMICOS ═══════════ */

test("relógio usa o fuso Africa/Maputo com data, hora e dia da semana", () => {
  assert.deepEqual(mainMenuClock(new Date(AGORA)), {
    data: "25/12/2026",
    hora: "23:30:06",
    diaSemana: "Sexta",
  });

  assert.deepEqual(mainMenuClock(new Date("2026-12-27T22:05:09Z")), {
    data: "28/12/2026",
    hora: "00:05:09",
    diaSemana: "Segunda",
  });
});

test("velocidade mostra segundos com 4 casas decimais", () => {
  assert.equal(mainMenuVelocity(1000, 1_000_750), "0.7500s");
  assert.equal(mainMenuVelocity(TIMESTAMP_MENSAGEM, AGORA), "0.2500s");
  assert.equal(mainMenuVelocity(undefined, AGORA), "0.0000s");
  assert.equal(mainMenuVelocity("inválido", AGORA), "0.0000s");
});

test("corpo do card segue o molde e injeta as variáveis", () => {
  const body = buildMainMenuBody({
    usuario: "Fulano",
    data: "25/12/2026",
    hora: "23:30:06",
    diaSemana: "Sexta",
    velocidade: "0.2500s",
  });

  assert.ok(body.startsWith("┏━━━༺ 🌐 ༻━━━┓"));
  assert.match(body, new RegExp(`\\s${BOT_NAME.toUpperCase()}\\s`));
  assert.match(body, /╭─『 🌙 INFORMAÇÕES 』─╮/);
  assert.match(body, /👤 You Name: @Fulano/);
  assert.match(body, /📅 Data: 25\/12\/2026/);
  assert.match(body, /🕒 Horário: 23:30:06/);
  assert.match(body, /📆 Hoje é: Sexta/);
  assert.match(body, /⚡ Velocidade: 0\.2500s/);
  assert.match(body, /👑 Criador: Yanik Uaite/);
  assert.ok(body.includes(MAIN_MENU_FOOTER));
  assert.match(body, /『 ⚡ Desenvolvido por Yanik Uaite 』/);
});

/* ═══════════ BOTÕES ═══════════ */

test("botões Dono e Canal são cta_url e Ver Menus é a lista de categorias", () => {
  const botoes = buildMainMenuButtons({
    ownerNumber: "+258 (84) 123-4567",
    channelUrl: "https://example.com/canal",
    categories: [
      { id: "geral", titulo: "Geral", icone: "🌐", descricao: "Comandos básicos" },
      { id: "downloads", titulo: "Downloads", icone: "📥", descricao: "Mídia" },
    ],
  });

  assert.equal(botoes.length, 3);
  assert.equal(botoes[0].name, "cta_url");
  assert.deepEqual(JSON.parse(botoes[0].buttonParamsJson), {
    display_text: "👑 Dono",
    url: "https://wa.me/258841234567",
  });

  assert.equal(botoes[1].name, "single_select");
  const lista = JSON.parse(botoes[1].buttonParamsJson);
  assert.equal(lista.title, "Ver Menus");
  assert.deepEqual(lista.sections[0].rows, [
    {
      id: "cat:geral",
      title: "🌐 Geral",
      description: "Comandos básicos",
    },
    {
      id: "cat:downloads",
      title: "📥 Downloads",
      description: "Mídia",
    },
  ]);

  assert.equal(botoes[2].name, "cta_url");
  assert.equal(
    JSON.parse(botoes[2].buttonParamsJson).url,
    "https://example.com/canal",
  );

  // Sem número do dono/canal e sem categorias resta o quick_reply de sempre.
  assert.deepEqual(
    buildMainMenuButtons({ ownerNumber: "", channelUrl: "" }).map(
      (botao) => botao.name,
    ),
    ["quick_reply"],
  );
  assert.equal(mainMenuOwnerUrl(""), "");
});

test("categorias são divididas em seções de no máximo 10 linhas", () => {
  const categorias = Array.from({ length: 12 }, (_, index) => ({
    id: `c${index}`,
    titulo: `Categoria ${index}`,
    icone: "•",
    descricao: `descrição ${index}`,
  }));

  const secoes = buildMainMenuSections(categorias);

  assert.deepEqual(
    secoes.map((secao) => secao.rows.length),
    [10, 2],
  );
  assert.equal(secoes[0].title, "Categorias");
  assert.equal(secoes[1].title, "Mais categorias");
  assert.deepEqual(secoes[0].rows[0], {
    id: "cat:c0",
    title: "• Categoria 0",
    description: "descrição 0",
  });
  assert.deepEqual(buildMainMenuSections([]), []);
});

/* ═══════════ IMAGEM ═══════════ */

test("imagem aceita URL, caminho local e falha sem derrubar o menu", async (t) => {
  assert.deepEqual(loadMainMenuImage("https://example.com/menu.png"), {
    url: "https://example.com/menu.png",
  });

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "main-menu-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const arquivo = path.join(dir, "menu.png");
  await fs.writeFile(arquivo, "png");

  assert.deepEqual(loadMainMenuImage(arquivo), Buffer.from("png"));
  assert.equal(loadMainMenuImage(path.join(dir, "nao-existe.png")), null);
  assert.equal(loadMainMenuImage(""), null);
});

/* ═══════════ ENVIO E FALLBACKS ═══════════ */

test("card principal vai com imagem, rodapé, menção e sessão de 2 minutos", async () => {
  const ambiente = criarAmbiente();

  assert.equal(await abrirMenu(ambiente), true);

  const card = ambiente.cards.at(-1);
  assert.ok(Buffer.isBuffer(card.image) || card.image?.url, "cabeçalho de imagem");
  assert.match(card.caption, /You Name: @Membro/);
  assert.match(card.caption, /Horário: 23:30:06/);
  assert.match(card.caption, /Velocidade: 0\.2500s/);
  assert.equal(card.footer, MAIN_MENU_FOOTER);
  assert.deepEqual(card.mentions, ["membro@lid"]);

  const lista = card.interactiveButtons.find(
    (botao) => botao.name === "single_select",
  );
  const rows = JSON.parse(lista.buttonParamsJson).sections[0].rows;
  assert.equal(rows[0].id, "cat:geral");
  assert.ok(rows.length >= 2);

  const session = getGuidedSession(GROUP, "membro@lid");
  assert.ok(session);
  assert.equal(session.options.get("1"), "cat:geral");
  assert.equal(session.cardFallback, false);
});

test("se a imagem falhar reenvia o card sem cabeçalho", async () => {
  const cards = [];
  const socket = {
    sendMessage: async (_chatId, content) => {
      if (content.image) throw new Error("imagem inválida");
      cards.push(content);
    },
  };

  const sent = await sendMainMenu(socket, GROUP, {
    ownerId: "membro@lid",
    ownerName: "Membro",
    sendReply: async () => {},
    permissions: { isOwner: false, isAdmin: false },
    timestamp: TIMESTAMP_MENSAGEM,
    now: AGORA,
  });

  assert.equal(sent, true);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].image, undefined);
  assert.match(cards[0].text, /You Name: @Membro/);
  assert.ok(cards[0].interactiveButtons.length >= 1);
});

test("fallbacks: card → lista clássica → texto numerado", async () => {
  const replies = [];
  const tentativas = [];
  let falharCards = true;

  const socket = {
    sendMessage: async (_chatId, content) => {
      tentativas.push(content);
      if (falharCards) throw new Error("sem botões");
      replies.push({ text: "ok" });
    },
  };

  const sent = await sendMainMenu(socket, GROUP, {
    ownerId: "membro@lid",
    ownerName: "Membro",
    sendReply: async (text) => replies.push({ text }),
    permissions: { isOwner: false, isAdmin: false },
    timestamp: TIMESTAMP_MENSAGEM,
    now: AGORA,
  });

  assert.equal(sent, true);
  // Tentou card com imagem, card sem imagem e lista clássica.
  assert.equal(tentativas.length >= 3, true);
  const lista = tentativas.find((tentativa) => tentativa.sections);
  assert.ok(lista);
  assert.ok(
    lista.sections.every((secao) => secao.rows.length <= 10),
    "lista clássica respeita 10 linhas por seção",
  );
  assert.match(replies.at(-1).text, /You Name: @Membro/);
  assert.match(replies.at(-1).text, /1\. 🌐 Geral/);
  assert.match(replies.at(-1).text, /Responde com o número 👇/);

  // Resposta numérica abre a categoria (fallback também numerado).
  falharCards = true;
  assert.equal(
    await handleGuidedFlow({
      socket,
      chatId: GROUP,
      senderId: "membro@lid",
      text: "1",
      commonFunctions: {},
      sendReply: async (text) => replies.push({ text }),
      dispatch: async () => {},
    }),
    true,
  );
  // Abriu o card da categoria "Geral" (que também caiu no fallback em texto).
  assert.match(replies.at(-1).text, /Abrir Funções/);
});

test("escolher uma categoria da lista abre as funções dela", async () => {
  const ambiente = criarAmbiente();
  await abrirMenu(ambiente);

  // Resposta real do single_select: interactiveResponseMessage com paramsJson.
  const resposta = extractDataFromMessage({
    key: { remoteJid: GROUP },
    message: {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          name: "single_select",
          paramsJson: JSON.stringify({ id: "cat:download" }),
        },
      },
    },
  });

  assert.equal(resposta.fullMessage, "cat:download");

  assert.equal(
    await handleGuidedFlow({
      ...ambiente,
      senderId: "membro@lid",
      text: resposta.fullMessage,
      commonFunctions: {},
      dispatch: async () => {},
    }),
    true,
  );

  assert.match(ambiente.cards.at(-1).text, /DOWNLOADS/);
  assert.match(ambiente.cards.at(-1).text, /Abrir Funções/);
});

test("só o autor do menu pode escolher na lista", async () => {
  const ambiente = criarAmbiente();
  await abrirMenu(ambiente);

  assert.equal(
    await handleGuidedFlow({
      ...ambiente,
      senderId: "outro@lid",
      text: "menu:categories",
      commonFunctions: {},
      dispatch: async () => {},
    }),
    true,
  );

  assert.match(ambiente.replies.at(-1).text, /Este menu é de @Membro/);
  assert.deepEqual(ambiente.replies.at(-1).mentions, ["membro@lid"]);
  assert.ok(getGuidedSession(GROUP, "membro@lid"));
});

test("estado do menu principal expira em 2 minutos", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const ambiente = criarAmbiente();
  await abrirMenu(ambiente);

  assert.ok(getGuidedSession(GROUP, "membro@lid"));
  mock.timers.tick(2 * 60 * 1000);

  assert.equal(getGuidedSession(GROUP, "membro@lid"), null);
  assert.match(ambiente.replies.at(-1).text, /O tempo deste menu terminou/);
});

test(".menu envia o card novo e mantém .menu <categoria>", async () => {
  const ambiente = criarAmbiente();

  await menuCommand.handle({
    socket: ambiente.socket,
    remoteJid: GROUP,
    fullArgs: "",
    webMessage: { pushName: "Membro" },
    userLid: "membro@lid",
    sendReply: ambiente.sendReply,
    isOwner: false,
    messageTimestamp: TIMESTAMP_MENSAGEM,
  });

  const card = ambiente.cards.at(-1);
  assert.match(card.caption || card.text, /You Name: @Membro/);
  assert.equal(card.footer, MAIN_MENU_FOOTER);

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
});
