/**
 * Fluxo guiado em 4 passos (menu → categoria → função → execução).
 *
 * IDs usados nos botões/linhas:
 *   menu:main            → card principal
 *   menu:categories[:n]  → lista de categorias (com paginação)
 *   cat:<id>             → card da categoria
 *   fnlist:<cat>[:n]     → lista de funções da categoria (paginação)
 *   fn:<cat>:<funcao>    → card da função + estado pendente
 *   back:<cat>           → volta às funções da categoria
 *   run:<cat>:<funcao>   → executa função sem entrada (`aceita: "nenhum"`)
 *   cancel               → cancela o estado pendente
 *
 * O estado fica num Map por `chatId:ownerId`, com TTL de 2 minutos. A execução
 * reaproveita os comandos existentes: quem chama passa `dispatch`, que monta a
 * mensagem sintética e corre o `dynamicCommand` (prefixo, permissões, créditos,
 * erros e refluxo). Nada de lógica de download/IA é duplicada aqui.
 *
 * @author Dev Gui
 */
import { PREFIX } from "../config.js";
import { getPrefix } from "../utils/database.js";
import {
  RODAPE,
  formatMessage,
  loadingMessage,
} from "../utils/formatMessage.js";
import {
  INTERACTIVE_MENU_TTL_MS,
  numberedFallback,
  quickReplyButton,
  sendInteractiveWithFallback,
  singleSelectList,
  urlButton,
} from "../utils/interactive.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { isAdmin, isBotOwner, isOwnerInPrivateChat } from "../middlewares/index.js";
import {
  CATEGORIES,
  canAccess,
  getCategory,
  getFunction,
  listCategories,
  listFunctions,
} from "./menuRegistry.js";

export const GUIDED_TTL_MS = INTERACTIVE_MENU_TTL_MS;

const CHANNEL_URL = "https://www.youtube.com/@devgui_?sub_confirmation=1";

const IDS = {
  main: "menu:main",
  categories: "menu:categories",
  cancel: "cancel",
};

const TOKEN_PREFIXES = [
  "menu:",
  "cat:",
  "fn:",
  "fnlist:",
  "back:",
  "run:",
  "cancel",
];

/** Sessões abertas: `chatId:ownerId` → sessão. */
const sessions = new Map();

function keyOf(chatId, ownerId) {
  return `${chatId}:${ownerId}`;
}

function findSessionInChat(chatId) {
  for (const session of sessions.values()) {
    if (session.chatId === chatId) return session;
  }
  return null;
}

function sanitizeName(value) {
  return String(value || "")
    .replace(/[\r\n*_`@]/g, "")
    .slice(0, 32);
}

function dropSession(session) {
  if (!session) return;
  if (sessions.get(session.key) === session) sessions.delete(session.key);
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
}

function clearPending(session) {
  if (session) session.pending = null;
}

function touch(session) {
  if (session.timer) clearTimeout(session.timer);

  session.timer = setTimeout(() => {
    if (sessions.get(session.key) !== session) return;
    dropSession(session);
    Promise.resolve(
      session.sendReply?.(
        "⏳ O tempo deste menu terminou. Envia o comando novamente para recomeçar.",
      ),
    ).catch(() => {});
  }, GUIDED_TTL_MS);
  session.timer.unref?.();
}

function ensureSession({ chatId, ownerId, ownerName, sendReply, permissions }) {
  const key = keyOf(chatId, ownerId);
  let session = sessions.get(key);

  if (!session) {
    session = {
      key,
      chatId,
      ownerId,
      ownerName: sanitizeName(ownerName) || "dono do pedido",
      sendReply,
      permissions: permissions || { isOwner: false, isAdmin: false },
      options: new Map(),
      pending: null,
      timer: null,
    };
    sessions.set(key, session);
  } else {
    if (sendReply) session.sendReply = sendReply;
    if (ownerName) session.ownerName = sanitizeName(ownerName);
    if (permissions) session.permissions = permissions;
  }

  touch(session);
  return session;
}

/**
 * Calcula as permissões do utilizador (dono do bot, admin do grupo).
 * Em conversa privada sem LID, o próprio JID do chat é o autor.
 */
export async function resolvePermissions({
  socket,
  chatId,
  senderId,
  webMessage,
}) {
  const isOwner =
    isBotOwner({ userLid: senderId }) || isOwnerInPrivateChat(webMessage);

  if (isOwner) return { isOwner: true, isAdmin: true };

  let isAdminUser = false;

  if (chatId.endsWith("@g.us")) {
    try {
      isAdminUser = await isAdmin({ remoteJid: chatId, userLid: senderId, socket });
    } catch (error) {
      // Sem metadata do grupo o usuário fica como membro; nada quebra.
      errorLog(
        `[fluxo] não foi possível verificar admin em ${chatId}: ${error.message}`,
      );
    }
  }

  return { isOwner: false, isAdmin: Boolean(isAdminUser) };
}

function prefixOf(chatId) {
  return getPrefix(chatId) || PREFIX;
}

function isUrlLike(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text) && !/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text)) {
    return false;
  }

  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.hostname.includes(".") && url.hostname.length > 3;
  } catch {
    return false;
  }
}

function paginate(items, page, size) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const atual = Math.min(Math.max(Number(page) || 0, 0), pages - 1);
  return {
    rows: items.slice(atual * size, atual * size + size),
    page: atual,
    pages,
  };
}

/**
 * Envia um card com botões ou lista, com fallback numerado e log do formato.
 */
async function deliver({ socket, session, content, options, label }) {
  const fallbackText = numberedFallback(options);

  session.options = new Map(
    options.map(({ number, id }) => [String(number), id]),
  );

  let fallbackUsed = false;
  session.cardFallback = false;
  const sent = await sendInteractiveWithFallback({
    socket,
    chatId: session.chatId,
    content,
    fallbackText,
    sendReply: session.sendReply,
    onSendError: (error) => {
      fallbackUsed = true;
      errorLog(
        `[fluxo] card "${label}" falhou (${error.message || error}); a usar fallback em texto`,
      );
    },
  });

  session.cardFallback = fallbackUsed;

  infoLog(
    `[fluxo] ${label} enviado como ${
      fallbackUsed ? "fallback em texto" : "mensagem interativa"
    }`,
  );

  if (sent) touch(session);
  return sent;
}

/* ═══════════ PASSOS 1 E 2 · MENU E CATEGORIAS ═══════════ */

export async function sendMainCard({ socket, session }) {
  const categorias = listCategories(session.permissions).filter(
    (categoria) => categoria.id !== "dono" || session.permissions.isOwner,
  );

  const options = [];
  const buttons = [];

  if (session.permissions.isOwner) {
    options.push({ number: "1", title: "👑 Dono", id: "cat:dono" });
    buttons.push(quickReplyButton("👑 Dono", "cat:dono"));
  }

  options.push({
    number: String(options.length + 1),
    title: "📚 Ver Menus",
    id: IDS.categories,
  });
  buttons.push(quickReplyButton("📚 Ver Menus", IDS.categories));

  const canal = urlButton("📢 Canal", CHANNEL_URL);
  if (canal) buttons.push(canal);

  const content = {
    text: formatMessage({
      icone: "🌐",
      titulo: "Menu",
      campos: [
        `👤 *Usuário:* ${session.ownerName}`,
        "🟢 *Status:* Online",
        `📱 *Chat:* ${session.chatId.endsWith("@g.us") ? "Grupo" : "Privado"}`,
        "",
        "📚 *Categorias disponíveis*",
        ...categorias.map((categoria) => `${categoria.icone} ${categoria.titulo}`),
        "",
        "💡 Toque em *Ver Menus* para começar.",
      ],
    }),
    interactiveButtons: buttons,
    viewOnce: true,
  };

  return deliver({ socket, session, content, options, label: IDS.main });
}

export async function sendCategoriesCard({ socket, session, page = 0 }) {
  const categorias = listCategories(session.permissions);
  const { rows, page: atual, pages } = paginate(categorias, page, 8);

  const linhas = rows.map((categoria) => ({
    title: `${categoria.icone} ${categoria.titulo}`,
    description: categoria.descricao,
    rowId: `cat:${categoria.id}`,
  }));

  const options = linhas.map((linha, index) => ({
    number: String(index + 1),
    title: linha.title,
    id: linha.rowId,
  }));

  if (pages > 1) {
    const proxima = atual + 1 >= pages ? 0 : atual + 1;
    linhas.push({
      title: proxima === 0 ? "🔄 Voltar ao início" : "➡️ Mais categorias",
      description: `Página ${proxima + 1} de ${pages}`,
      rowId: `${IDS.categories}:${proxima}`,
    });
    options.push({
      number: String(options.length + 1),
      title: "Mais categorias",
      id: `${IDS.categories}:${proxima}`,
    });
  }

  const content = singleSelectList({
    text: formatMessage({
      icone: "📚",
      titulo: "Categorias",
      campos: [
        "Escolhe a categoria para ver as funções:",
        "",
        ...rows.map(
          (categoria) => `${categoria.icone} *${categoria.titulo}* — ${categoria.descricao}`,
        ),
      ],
    }),
    title: "Categorias",
    footer: RODAPE,
    buttonText: "Abrir categoria",
    sections: [{ title: "Categorias", rows: linhas }],
  });

  return deliver({
    socket,
    session,
    content,
    options,
    label: `${IDS.categories} (página ${atual + 1})`,
  });
}

export async function sendCategoryCard({ socket, session, categoria }) {
  const funcoes = listFunctions(categoria.id);
  const prefixo = prefixOf(session.chatId);

  const options = [];
  const buttons = [];

  if (funcoes.length) {
    options.push({
      number: "1",
      title: "📂 Abrir Funções",
      id: `fnlist:${categoria.id}:0`,
    });
    buttons.push(
      quickReplyButton("📂 Abrir Funções", `fnlist:${categoria.id}:0`),
    );
  }

  options.push({
    number: String(options.length + 1),
    title: "🏠 Menu Principal",
    id: IDS.main,
  });
  buttons.push(quickReplyButton("🏠 Menu Principal", IDS.main));

  const canal = urlButton("📢 Canal", CHANNEL_URL);
  if (canal) buttons.push(canal);

  const resumo = `${funcoes.length} ${
    funcoes.length === 1 ? "função" : "funções"
  } • Prefixo [ ${prefixo} ]`;

  const content = {
    text: formatMessage({
      icone: categoria.icone,
      titulo: categoria.titulo,
      campos: [
        categoria.descricao,
        "",
        `📦 *Resumo:* ${resumo}`,
        funcoes.length
          ? "💡 Toque em *Abrir Funções* e escolha."
          : `💡 Ainda não há funções guiadas aqui. Use *${prefixo}menu* ou o comando direto.`,
      ],
    }),
    interactiveButtons: buttons,
    viewOnce: true,
  };

  return deliver({
    socket,
    session,
    content,
    options,
    label: `cat:${categoria.id}`,
  });
}

export async function sendFunctionsCard({
  socket,
  session,
  categoria,
  page = 0,
}) {
  const funcoes = listFunctions(categoria.id);
  if (!funcoes.length) {
    return sendCategoryCard({ socket, session, categoria });
  }

  const { rows, page: atual, pages } = paginate(funcoes, page, 7);

  const linhas = rows.map((funcao) => ({
    title: `${funcao.icone} ${funcao.titulo}`,
    description: funcao.descricao,
    rowId: `fn:${categoria.id}:${funcao.id}`,
  }));

  const options = linhas.map((linha, index) => ({
    number: String(index + 1),
    title: linha.title,
    id: linha.rowId,
  }));

  if (pages > 1) {
    const proxima = atual + 1 >= pages ? 0 : atual + 1;
    linhas.push({
      title: proxima === 0 ? "🔄 Voltar ao início" : "➡️ Mais funções",
      description: `Página ${proxima + 1} de ${pages}`,
      rowId: `fnlist:${categoria.id}:${proxima}`,
    });
    options.push({
      number: String(options.length + 1),
      title: "Mais funções",
      id: `fnlist:${categoria.id}:${proxima}`,
    });
  }

  linhas.push({
    title: "🏠 Menu Principal",
    description: "Voltar ao início",
    rowId: IDS.main,
  });
  options.push({
    number: String(options.length + 1),
    title: "Menu Principal",
    id: IDS.main,
  });

  const content = singleSelectList({
    text: formatMessage({
      icone: categoria.icone,
      titulo: `${categoria.titulo} · Funções`,
      campos: [
        categoria.descricao,
        "",
        ...rows.map(
          (funcao) => `${funcao.icone} *${funcao.titulo}* — ${funcao.descricao}`,
        ),
      ],
    }),
    title: `${categoria.titulo} · Funções`,
    footer: RODAPE,
    buttonText: "Escolher função",
    sections: [{ title: "Funções", rows: linhas }],
  });

  return deliver({
    socket,
    session,
    content,
    options,
    label: `fnlist:${categoria.id} (página ${atual + 1})`,
  });
}

/* ═══════════ PASSO 3 · CARD DA FUNÇÃO ═══════════ */

export async function sendFunctionCard({ socket, session, categoria, funcao }) {
  session.pending = { categoriaId: categoria.id, funcaoId: funcao.id };
  touch(session);

  const prefixo = prefixOf(session.chatId);
  const atalho =
    `${prefixo}${funcao.comando}${funcao.args ? ` ${funcao.args}` : ""}${
      funcao.aceita === "nenhum" ? "" : ` ${funcao.exemplo || ""}`
    }`.trim();

  const options = [];
  const buttons = [];

  if (funcao.aceita === "nenhum") {
    options.push({
      number: "1",
      title: "▶️ Executar",
      id: `run:${categoria.id}:${funcao.id}`,
    });
    buttons.push(
      quickReplyButton("▶️ Executar", `run:${categoria.id}:${funcao.id}`),
    );
  }

  options.push({
    number: String(options.length + 1),
    title: "🔙 Voltar às Funções",
    id: `back:${categoria.id}`,
  });
  buttons.push(
    quickReplyButton("🔙 Voltar às Funções", `back:${categoria.id}`),
  );

  options.push({
    number: String(options.length + 1),
    title: "🏠 Menu Principal",
    id: IDS.main,
  });
  buttons.push(quickReplyButton("🏠 Menu Principal", IDS.main));

  if (funcao.aceita !== "nenhum") {
    options.push({
      number: String(options.length + 1),
      title: "❌ Cancelar",
      id: IDS.cancel,
    });
    buttons.push(quickReplyButton("❌ Cancelar", IDS.cancel));
  }

  const content = {
    text: formatMessage({
      icone: funcao.icone,
      titulo: funcao.titulo,
      campos: [
        funcao.descricao,
        "",
        `📎 *Envie:* ${funcao.guia}`,
        `⚡ *Ou use:* ${atalho}`,
        "",
        funcao.aceita === "nenhum"
          ? "💡 Toca em *Executar* para rodar agora."
          : "💡 Envia a mensagem abaixo que eu continuo daqui.",
      ],
    }),
    interactiveButtons: buttons,
    viewOnce: true,
  };

  return deliver({
    socket,
    session,
    content,
    options,
    label: `fn:${categoria.id}:${funcao.id}`,
  });
}

async function sendInvalidInput({ socket, session, categoria, funcao, motivo }) {
  const alvo =
    motivo === "midia"
      ? "uma mídia"
      : motivo === "texto"
        ? "um texto válido"
        : "um link";

  const options = [
    { number: "1", title: "❌ Cancelar", id: IDS.cancel },
    { number: "2", title: "🏠 Menu Principal", id: IDS.main },
  ];

  const content = {
    text: formatMessage({
      icone: "⚠️",
      titulo: "Entrada inválida",
      campos: [
        `Isso não parece ${alvo} de *${funcao.titulo}*.`,
        "Tenta de novo ou toca em Cancelar.",
      ],
    }),
    interactiveButtons: [
      quickReplyButton("❌ Cancelar", IDS.cancel),
      quickReplyButton("🏠 Menu Principal", IDS.main),
    ],
    viewOnce: true,
  };

  // O estado continua pendente para o utilizador tentar outra vez.
  return deliver({
    socket,
    session,
    content,
    options,
    label: `inválido:${categoria.id}:${funcao.id}`,
  });
}

/* ═══════════ RESULTADO, CANCELAMENTO E TIMEOUT ═══════════ */

function retryLabel(funcao) {
  if (funcao.aceita === "link") return "🔁 Outro link";
  if (funcao.aceita === "midia") return "🔁 Outra mídia";
  if (funcao.aceita === "texto") return "🔁 Outro pedido";
  return "🔁 Repetir";
}

export async function sendResultButtons({
  socket,
  session,
  categoria,
  funcao,
}) {
  const options = [
    {
      number: "1",
      title: retryLabel(funcao),
      id: `fn:${categoria.id}:${funcao.id}`,
    },
    {
      number: "2",
      title: "🔙 Voltar às Funções",
      id: `back:${categoria.id}`,
    },
    { number: "3", title: "🏠 Menu Principal", id: IDS.main },
  ];

  const content = {
    text: formatMessage({
      icone: "✅",
      titulo: "Pronto",
      campos: ["✨ Queres fazer mais alguma coisa?"],
    }),
    interactiveButtons: [
      quickReplyButton(retryLabel(funcao), `fn:${categoria.id}:${funcao.id}`),
      quickReplyButton("🔙 Voltar às Funções", `back:${categoria.id}`),
      quickReplyButton("🏠 Menu Principal", IDS.main),
    ],
    viewOnce: true,
  };

  return deliver({
    socket,
    session,
    content,
    options,
    label: `resultado:${categoria.id}:${funcao.id}`,
  });
}

async function sendCanceled({ socket, session }) {
  const options = [{ number: "1", title: "🏠 Menu Principal", id: IDS.main }];

  const content = {
    text: formatMessage({
      icone: "❌",
      titulo: "Cancelado",
      campos: ["Tudo bem! O pedido foi cancelado.", "", "Podes recomeçar quando quiseres."],
    }),
    interactiveButtons: [quickReplyButton("🏠 Menu Principal", IDS.main)],
    viewOnce: true,
  };

  return deliver({
    socket,
    session,
    content,
    options,
    label: "cancel",
  });
}

/* ═══════════ PASSO 4 · VALIDAÇÃO E EXECUÇÃO ═══════════ */

function validateInput(funcao, value, commonFunctions) {
  const texto = String(value ?? "").trim();

  if (funcao.aceita === "link") {
    if (!isUrlLike(texto)) return { ok: false, motivo: "link" };
    if (funcao.validador && !funcao.validador(texto)) {
      return { ok: false, motivo: "link" };
    }
    return { ok: true, input: texto };
  }

  if (funcao.aceita === "texto") {
    if (texto.length < 2) return { ok: false, motivo: "texto" };
    if (funcao.validador && !funcao.validador(texto)) {
      return { ok: false, motivo: "texto" };
    }
    return { ok: true, input: texto };
  }

  if (funcao.aceita === "midia") {
    const temMidia =
      commonFunctions?.isImage ||
      commonFunctions?.isVideo ||
      commonFunctions?.isAudio ||
      commonFunctions?.isSticker;

    if (!temMidia) return { ok: false, motivo: "midia" };
    return { ok: true, input: "" };
  }

  if (funcao.aceita === "nenhum") {
    return { ok: true, input: "" };
  }

  return { ok: false, motivo: "texto" };
}

async function runFunction({
  socket,
  session,
  categoria,
  funcao,
  input,
  dispatch,
}) {
  clearPending(session);
  touch(session);

  await session
    .sendReply(loadingMessage({ usuario: session.ownerName }))
    .catch(() => {});

  try {
    await dispatch({
      comando: funcao.comando,
      categoria: categoria.id,
      funcao: funcao.id,
      input,
      args: funcao.args || "",
    });
  } catch (error) {
    errorLog(
      `[fluxo] erro ao executar ${funcao.comando} (${funcao.id}): ${error.message}`,
    );
    await session
      .sendReply(`❌ Não consegui executar ${funcao.titulo}: ${error.message}`)
      .catch(() => {});
  }

  await sendResultButtons({ socket, session, categoria, funcao });
}

/* ═══════════ HANDLER CENTRAL ═══════════ */

/**
 * Lê a resposta (botão nativo, item de lista ou número) e despacha pelo prefixo
 * do ID. Quando há estado pendente, a próxima mensagem de texto/mídia é a
 * entrada da função.
 *
 * @returns {Promise<boolean>} true se a mensagem foi tratada pelo fluxo.
 */
export async function handleGuidedFlow({
  socket,
  chatId,
  senderId,
  senderName,
  text,
  webMessage,
  commonFunctions,
  sendReply,
  dispatch,
  permissions,
}) {
  const value = String(text ?? "").trim();
  if (!value || value === "#auto-command") return false;
  if (!chatId || !sendReply) return false;

  const ownerId = senderId || (chatId.endsWith("@g.us") ? "" : chatId);
  if (!ownerId) return false;

  const own = sessions.get(keyOf(chatId, ownerId)) || null;
  const prefixo = prefixOf(chatId);
  const pareceComando =
    (prefixo && value.startsWith(prefixo)) || value.startsWith("!");

  // Regra 4: comando digitado com prefixo cancela o estado e corre normalmente.
  if (pareceComando) {
    if (own?.pending) {
      clearPending(own);
      await sendReply("❌ Pedido cancelado. A executar o comando...").catch(
        () => {},
      );
    }
    return false;
  }

  const looksToken = TOKEN_PREFIXES.some((prefix) => value.startsWith(prefix));
  const numero = /^\d{1,2}$/.test(value);

  // No fallback em texto (sem botões) os números navegam; com botões, o número
  // é a entrada da função pendente (ex.: 1/0 das proteções).
  const numeroDeNavegacao =
    numero && own?.cardFallback ? own.options.get(value) : null;

  // Passo 4: a próxima mensagem é a entrada da função pendente.
  if (own?.pending && !looksToken && !numeroDeNavegacao) {
    const categoria = getCategory(own.pending.categoriaId);
    const funcao = getFunction(own.pending.categoriaId, own.pending.funcaoId);

    if (!categoria || !funcao) {
      dropSession(own);
      return false;
    }

    if (!canAccess(categoria, own.permissions)) {
      clearPending(own);
      await sendReply("🚫 Esta categoria é restrita a administradores.").catch(
        () => {},
      );
      return true;
    }

    const validacao = validateInput(funcao, value, commonFunctions);

    if (!validacao.ok) {
      await sendInvalidInput({
        socket,
        session: own,
        categoria,
        funcao,
        motivo: validacao.motivo,
      });
      return true;
    }

    await runFunction({
      socket,
      session: own,
      categoria,
      funcao,
      input: validacao.input,
      dispatch,
    });
    return true;
  }

  // Resolve número de fallback ou token de botão/lista.
  const id = numeroDeNavegacao || (numero ? own?.options.get(value) : value);
  if (!id || !TOKEN_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return false;
  }

  const session = own || findSessionInChat(chatId);

  if (!session) {
    await sendReply(
      "⏳ Este menu expirou. Envia o comando novamente para recomeçar.",
    ).catch(() => {});
    return true;
  }

  if (!own) {
    const mentions =
      session.ownerId && session.ownerId !== chatId
        ? [session.ownerId]
        : undefined;
    await sendReply(
      `🚫 Este menu é de @${session.ownerName}.`,
      mentions,
    ).catch(() => {});
    return true;
  }

  if (permissions) session.permissions = permissions;

  if (id === IDS.main) {
    await sendMainCard({ socket, session });
    return true;
  }

  if (id.startsWith(IDS.categories)) {
    const page = Number(id.split(":")[2] || 0);
    await sendCategoriesCard({ socket, session, page });
    return true;
  }

  if (id === IDS.cancel) {
    clearPending(session);
    await sendCanceled({ socket, session });
    return true;
  }

  const [namespace, first, second] = id.split(":");

  if (namespace === "cat") {
    const categoria = getCategory(first);
    if (!categoria || !canAccess(categoria, session.permissions)) {
      await sendReply(
        "🚫 Não tens permissão para abrir esta categoria.",
      ).catch(() => {});
      return true;
    }
    await sendCategoryCard({ socket, session, categoria });
    return true;
  }

  if (namespace === "fnlist" || namespace === "back") {
    const categoria = getCategory(first);
    if (!categoria || !canAccess(categoria, session.permissions)) {
      await sendReply("🚫 Não tens permissão para abrir esta categoria.").catch(
        () => {},
      );
      return true;
    }

    if (namespace === "back") {
      clearPending(session);
      await sendFunctionsCard({ socket, session, categoria });
      return true;
    }

    await sendFunctionsCard({ socket, session, categoria, page: Number(second || 0) });
    return true;
  }

  if (namespace === "fn" || namespace === "run") {
    const categoria = getCategory(first);
    const funcao = getFunction(first, second);

    if (!categoria || !funcao || !canAccess(categoria, session.permissions)) {
      await sendReply("⚠️ Esta função não está disponível para ti.").catch(
        () => {},
      );
      return true;
    }

    if (namespace === "run") {
      const validacao = validateInput(funcao, "", commonFunctions);
      if (!validacao.ok) {
        await sendInvalidInput({
          socket,
          session,
          categoria,
          funcao,
          motivo: validacao.motivo,
        });
        return true;
      }
      await runFunction({
        socket,
        session,
        categoria,
        funcao,
        input: validacao.input,
        dispatch,
      });
      return true;
    }

    await sendFunctionCard({ socket, session, categoria, funcao });
    return true;
  }

  await sendReply("⚠️ Opção desconhecida. Toca em Menu Principal.").catch(
    () => {},
  );
  return true;
}

/**
 * Abre o fluxo guiado (usado pelo comando `.menu`).
 *
 * @returns {Promise<boolean>} true se o card foi enviado.
 */
export async function startGuidedMenu({
  socket,
  chatId,
  ownerId,
  ownerName,
  sendReply,
  webMessage,
  section = "",
  permissions,
}) {
  const authorId = ownerId || (chatId.endsWith("@g.us") ? "" : chatId);

  if (!authorId) {
    await sendReply(
      "🚫 Não consegui confirmar quem fez o pedido. Envia o comando novamente.",
    ).catch(() => {});
    return false;
  }

  const perms =
    permissions ||
    (await resolvePermissions({
      socket,
      chatId,
      senderId: authorId,
      webMessage,
    }));

  const session = ensureSession({
    chatId,
    ownerId: authorId,
    ownerName,
    sendReply,
    permissions: perms,
  });

  const chave = String(section || "").trim();

  if (chave) {
    const categoria = CATEGORIES.find(
      (item) =>
        item.id === chave.toLowerCase() ||
        item.aliases.includes(chave.toLowerCase()),
    );

    if (!categoria) return false;

    if (!canAccess(categoria, perms)) {
      await sendReply(
        "🚫 Não tens permissão para abrir esta categoria.",
      ).catch(() => {});
      return true;
    }

    return sendCategoryCard({ socket, session, categoria });
  }

  return sendMainCard({ socket, session });
}

/**
 * Abre (ou reutiliza) a sessão guiada de um utilizador no chat.
 * Usado pelo card principal (`src/utils/mainMenu.js`) para partilhar TTL,
 * ownership e as opções numéricas com o resto do fluxo.
 *
 * @returns {Promise<object|null>} sessão ou null se não der para confirmar o autor.
 */
export async function openGuidedSession({
  socket,
  chatId,
  ownerId,
  ownerName,
  sendReply,
  permissions,
  webMessage,
}) {
  const authorId = ownerId || (chatId.endsWith("@g.us") ? "" : chatId);
  if (!authorId) return null;

  const perms =
    permissions ||
    (await resolvePermissions({
      socket,
      chatId,
      senderId: authorId,
      webMessage,
    }));

  return ensureSession({
    chatId,
    ownerId: authorId,
    ownerName,
    sendReply,
    permissions: perms,
  });
}

/**
 * Regista as opções numéricas do card recém-enviado (fallback sem botões).
 *
 * @param {object} session sessão guiada
 * @param {Array<{number: string, title: string, id: string}>} options
 */
export function registerGuidedOptions(session, options) {
  if (!session) return;
  session.options = new Map(
    options.map(({ number, id }) => [String(number), id]),
  );
  touch(session);
}

/** Limpa todas as sessões (usado nos testes). */
export function resetGuidedSessions() {
  for (const session of sessions.values()) {
    if (session.timer) clearTimeout(session.timer);
  }
  sessions.clear();
}

/** Introspeção usada nos testes. */
export function getGuidedSession(chatId, ownerId) {
  return sessions.get(keyOf(chatId, ownerId)) || null;
}
