/**
 * Fluxo guiado em 4 passos (menu → categoria → função → execução).
 *
 * IDs usados nas linhas das listas:
 *   menu:main            → card principal
 *   menu:categories      → lista de categorias
 *   cat:<id>             → card da categoria (com a lista das FUNÇÕES)
 *   fnlist:<cat>         → compatibilidade: alias de cat:<id>
 *   back:<cat>           → volta às funções da categoria
 *   fn:<cat>:<funcao>    → card da função + estado pendente
 *   run:<cat>:<funcao>   → executa função sem entrada (`aceita: "nenhum"`)
 *   cancel               → cancela o estado pendente
 *
 * REGRA DE BOTÕES: nesta base SÓ `single_select` (lista) e `cta_url` renderizam.
 * Cada card = texto + UMA lista single_select + botão cta_url "📢 Canal".
 * `quick_reply`, `buttonsMessage` e `templateButtons` ficam PROIBIDOS: são
 * silenciosamente descartados pelo WhatsApp.
 *
 * O estado fica num Map por `chatId:ownerId`, com TTL de 2 minutos. A execução
 * reaproveita os comandos existentes: quem chama passa `dispatch`, que monta a
 * mensagem sintética e corre o `dynamicCommand` (prefixo, permissões, créditos,
 * erros e refluxo). Funções com `opcoes` (qualidade/formato) não usam `dispatch`:
 * guardam o link na sessão e abrem o menu de qualidade/formato em lista
 * (videoFormatMenu / audioFormatMenu), que baixa só depois da escolha.
 *
 * @author Dev Gui
 */
import { PREFIX } from "../config.js";
import { getPrefix } from "../utils/database.js";
import { RODAPE, formatMessage } from "../utils/formatMessage.js";
import {
  INTERACTIVE_MENU_TTL_MS,
  numberedFallback,
  ownerButton,
  sendInteractiveWithFallback,
  singleSelectButton,
  singleSelectList,
  urlButton,
} from "../utils/interactive.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { isAdmin, isBotOwner, isOwnerInPrivateChat } from "../middlewares/index.js";
import { resolveDownloadSource } from "../services/downloader.js";
import { startVideoFormatMenu } from "../utils/videoFormatMenu.js";
import { startAudioSourceMenu } from "../utils/audioFormatMenu.js";
import { startAnimeFlow } from "../utils/animeMenu.js";
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

/** Tokens dos menus de qualidade/formato que NÃO são do fluxo guiado. */
const OUTSIDE_TOKEN_PREFIXES = ["vfmt:", "fmt:", "anm:"];

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

/**
 * TTL da sessão. O aviso "⏳ O tempo deste menu terminou" só é enviado quando
 * havia função (ou opção de qualidade/formato) à espera de resposta; caso
 * contrário a sessão fecha em silêncio.
 */
function touch(session) {
  if (session.timer) clearTimeout(session.timer);

  session.timer = setTimeout(() => {
    if (sessions.get(session.key) !== session) return;
    const tinhaPendente = Boolean(session.pending);
    dropSession(session);
    if (!tinhaPendente) return;
    Promise.resolve(
      session.sendReply?.(
        "⏳ O tempo deste menu terminou. Envia .menu para recomeçar.",
      ),
    ).catch(() => {});
  }, GUIDED_TTL_MS);
  session.timer.unref?.();
}

function ensureSession({
  chatId,
  ownerId,
  ownerName,
  sendReply,
  permissions,
  senderJids = [],
}) {
  const key = keyOf(chatId, ownerId);
  let session = sessions.get(key);

  if (!session) {
    session = {
      key,
      chatId,
      ownerId,
      senderJids: senderJids.filter(Boolean),
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
    // Alarga as formas de JID conhecidas do autor (nunca as reduz).
    for (const jid of senderJids.filter(Boolean)) {
      if (!session.senderJids.includes(jid)) session.senderJids.push(jid);
    }
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

/**
 * Divide as linhas em seções de até 10 linhas (limite das listas do WhatsApp).
 * Uma seção a mais só é criada se houver linhas de verdade para lá.
 */
function emSecoes(title, rows, tamanho = 10) {
  if (!rows.length) return [];
  const secoes = [];
  for (let inicio = 0; inicio < rows.length; inicio += tamanho) {
    secoes.push({
      title: secoes.length ? `${title} (continuação)` : title,
      rows: rows.slice(inicio, inicio + tamanho),
    });
  }
  return secoes;
}

function canalButton() {
  return urlButton("📢 Canal", CHANNEL_URL);
}

/**
 * Envia um card (texto + UMA lista single_select + Canal) com fallback numerado.
 * Loga o formato enviado e o id da mensagem devolvida.
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

  const sentId = sent?.key?.id || sent?.message?.key?.id || null;
  infoLog(
    `[fluxo] ${label} enviado como ${
      fallbackUsed ? "fallback em texto" : "mensagem interativa"
    }${sentId ? ` (id ${sentId})` : ""}`,
  );

  if (sent) touch(session);
  return sent;
}

/* ═══════════ PASSO 1 · MENU PRINCIPAL ═══════════ */

export async function sendMainCard({ socket, session }) {
  const categorias = listCategories(session.permissions).filter(
    (categoria) => categoria.id !== "dono" || session.permissions.isOwner,
  );

  const rows = categorias.map((categoria) => ({
    id: `cat:${categoria.id}`,
    title: `${categoria.icone} ${categoria.titulo}`,
    description: categoria.descricao,
  }));

  const options = rows.map((linha, index) => ({
    number: String(index + 1),
    title: linha.title,
    id: linha.id,
  }));

  const buttons = [];

  const verMenus = singleSelectButton("📚 Ver Menus", emSecoes("Categorias", rows), {
    title: "Categorias",
  });
  if (verMenus) buttons.push(verMenus);

  // Dono (se houver número configurado) e Canal são cta_url.
  const dono = ownerButton();
  if (dono) buttons.push(dono);

  const canal = canalButton();
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

export async function sendCategoriesCard({ socket, session }) {
  return sendMainCard({ socket, session });
}

/* ═══════════ PASSO 2 · CARD DA CATEGORIA (COM A LISTA DE FUNÇÕES) ═══════════ */

export async function sendCategoryCard({ socket, session, categoria }) {
  const funcoes = listFunctions(categoria.id);
  const prefixo = prefixOf(session.chatId);

  // Lista das funções da categoria + navegação no fim (regras do pedido).
  const rows = funcoes.map((funcao) => ({
    id: `fn:${categoria.id}:${funcao.id}`,
    title: `${funcao.icone} ${funcao.titulo}`,
    description: funcao.descricao,
  }));

  rows.push({
    id: IDS.categories,
    title: "🔙 Voltar às categorias",
    description: "Ver as outras categorias",
  });
  rows.push({
    id: IDS.main,
    title: "🏠 Menu Principal",
    description: "Voltar ao início",
  });

  const secoes = emSecoes(
    `${categoria.icone} ${categoria.titulo}`,
    rows.slice(0, funcoes.length),
  );
  const navegacao = rows.slice(funcoes.length);
  secoes.push({ title: "Navegação", rows: navegacao });

  const options = rows.map((linha, index) => ({
    number: String(index + 1),
    title: linha.title,
    id: linha.id,
  }));

  const buttons = [];

  const lista = singleSelectButton(
    "📂 Funções",
    secoes,
    { title: `${categoria.titulo} · Funções` },
  );
  if (lista) buttons.push(lista);

  const dono = ownerButton();
  if (dono) buttons.push(dono);

  const canal = canalButton();
  if (canal) buttons.push(canal);

  const content = {
    text: formatMessage({
      icone: categoria.icone,
      titulo: categoria.titulo,
      campos: [
        categoria.descricao,
        "",
        `📦 *Resumo:* ${funcoes.length} ${
          funcoes.length === 1 ? "função" : "funções"
        } • Prefixo [ ${prefixo} ]`,
        "💡 Abre a lista e escolhe a função.",
      ],
    }),
    interactiveButtons: buttons,
    viewOnce: true,
  };

  // Sem funções (categoria recém-criada) o bot durmiente escolhe o card principal.
  if (!lista) {
    return sendMainCard({ socket, session });
  }

  return deliver({
    socket,
    session,
    content,
    options,
    label: `cat:${categoria.id}`,
  });
}

/* ═══════════ COMPATIBILIDADE · LISTA DE FUNÇÕES ═══════════ */

export async function sendFunctionsCard({ socket, session, categoria }) {
  return sendCategoryCard({ socket, session, categoria });
}

/* ═══════════ PASSO 3 · CARD DA FUNÇÃO ═══════════ */

export async function sendFunctionCard({ socket, session, categoria, funcao }) {
  session.pending = { categoriaId: categoria.id, funcaoId: funcao.id, input: null };
  touch(session);

  const prefixo = prefixOf(session.chatId);
  const atalho =
    `${prefixo}${funcao.comando}${funcao.args ? ` ${funcao.args}` : ""}${
      funcao.aceita === "nenhum" ? "" : ` ${funcao.exemplo || ""}`
    }`.trim();

  // Lista ÚNICA com navegação (ou execução, para `nenhum`) + Canal.
  const rows = [];

  if (funcao.aceita === "nenhum") {
    rows.push({
      id: `run:${categoria.id}:${funcao.id}`,
      title: "▶️ Executar",
      description: "Rodar agora",
    });
  }

  rows.push({
    id: `back:${categoria.id}`,
    title: "🔙 Voltar às funções",
    description: categoria.titulo,
  });
  rows.push({
    id: IDS.main,
    title: "🏠 Menu Principal",
    description: "Voltar ao início",
  });
  rows.push({
    id: IDS.cancel,
    title: "❌ Cancelar",
    description: "Sair sem executar",
  });

  const secoes = emSecoes("Opções", rows);
  const options = rows.map((linha, index) => ({
    number: String(index + 1),
    title: linha.title,
    id: linha.id,
  }));

  const buttons = [];

  const lista = singleSelectButton("⚙️ Opções", secoes, {
    title: funcao.titulo,
  });
  if (lista) buttons.push(lista);

  const dono = ownerButton();
  if (dono) buttons.push(dono);

  const canal = canalButton();
  if (canal) buttons.push(canal);

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
          ? "💡 Escolhe *Executar* na lista abaixo."
          : funcao.opcoes
            ? "💡 Envia o link: depois eu pergunto a qualidade."
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

/* ═══════════ RESULTADO, CANCELAMENTO E ERROS ═══════════ */

/** Textos simples de resultado/erro/aviso: sem botões (regra do projeto). */
async function sendSimpleText({ session, texto, mentions }) {
  touch(session);
  await Promise.resolve(session.sendReply?.(texto, mentions)).catch(() => {});
  return true;
}

async function sendInvalidInput({ session, categoria, funcao, motivo }) {
  const alvo =
    motivo === "midia"
      ? "uma mídia"
      : motivo === "texto"
        ? "um texto válido"
        : "um link";

  // O estado continua pendente para o utilizador tentar outra vez.
  infoLog(
    `[fluxo] entrada inválida para ${funcao.id} (cat ${categoria.id}): o que veio não parece ${alvo}`,
  );
  return sendSimpleText({
    session,
    texto: `⚠️ Isso não parece ${alvo} de *${funcao.titulo}*. Envia de novo ou toca no cancelamento no menu.`,
  });
}

export async function sendResultButtons({
  socket,
  session,
  categoria,
  funcao,
}) {
  // Mantém a função ativa por mais 2 minutos (texto simples, sem botões).
  session.pending = funcao.aceita === "nenhum" ? null : {
    categoriaId: categoria.id,
    funcaoId: funcao.id,
    input: null,
  };
  touch(session);

  return sendResultText({ session, categoria, funcao });
}

async function sendResultText({ session, categoria, funcao }) {
  const continua = funcao.aceita !== "nenhum";

  infoLog(
    `[fluxo] ${funcao.id} (cat ${categoria.id}) terminou; ${
      continua ? "função continua ativa por 2 min" : "sem pendência"
    }`,
  );

  return sendSimpleText({
    session,
    texto: continua
      ? "✅ Pronto! Envie outro link ou use .menu para voltar."
      : "✅ Pronto! Usa .menu quando quiseres.",
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

/**
 * Executa a função.
 *
 * - Com `opcoes`: guarda o link na sessão e envia "🎛️ Escolher Qualidade" como
 *   lista (videoFormatMenu / audioFormatMenu). O download só acontece depois
 *   da escolha; a sessão fica ativa até ao resultado.
 * - Sem `opcoes`: "⏳ Já estou a tratar do teu pedido, @usuario..." e baixa.
 */
async function runFunction({
  socket,
  session,
  categoria,
  funcao,
  input,
  dispatch,
}) {
  touch(session);

  // Animes: fluxo próprio (pede o nome → episódios → qualidade). Abre o menu
  // que deixa a sessão em `aguardando_nome`.
  if (funcao.id === "anime") {
    clearPending(session);
    await startAnimeFlow({
      socket,
      chatId: session.chatId,
      ownerLid: session.ownerId,
      ownerName: session.ownerName,
      sendReply: session.sendReply,
      senderLids: session.senderJids || [],
    });
    return;
  }

  if (funcao.opcoes) {
    let source;
    try {
      // Pode ser link ou termo de pesquisa (play-*): resolve para URL.
      source = (await resolveDownloadSource(funcao.comando, input)).source;
    } catch (error) {
      errorLog(`[fluxo] falha ao resolver fonte de ${funcao.id}: ${error.message}`);
      await sendInvalidInput({
        session,
        categoria,
        funcao,
        motivo: "link",
      });
      return;
    }

    // Guarda o link na sessão e envia o menu de qualidade/formato em lista.
    session.pending = {
      categoriaId: categoria.id,
      funcaoId: funcao.id,
      input: source,
    };

    infoLog(
      `[fluxo] ${funcao.id}: link guardado na sessão; a abrir a lista de ${
        funcao.opcoes.tipo === "video" ? "qualidade do vídeo" : "formato do áudio"
      }`,
    );

    const props = {
      socket,
      chatId: session.chatId,
      ownerLid: session.ownerId,
      ownerName: session.ownerName,
      sendReply: session.sendReply,
      source,
      url: input,
    };

    if (funcao.opcoes.tipo === "video") {
      await startVideoFormatMenu(props);
    } else {
      await startAudioSourceMenu({
        socket: props.socket,
        chatId: props.chatId,
        ownerLid: props.ownerLid,
        ownerName: props.ownerName,
        sendReply: props.sendReply,
        source,
        url: props.url,
        jid: session.ownerId,
      });
    }
    return;
  }

  clearPending(session);
  touch(session);

  const mentions =
    session.ownerId && session.ownerId !== session.chatId
      ? [session.ownerId]
      : undefined;
  await session
    .sendReply("⏳ Já estou a tratar do teu pedido, @usuario...", mentions)
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
    await sendSimpleText({
      session,
      texto: `❌ Não consegui executar ${funcao.titulo}: ${error.message}`,
    });
    return;
  }

  // Mantém a função ativa por mais 2 minutos: o próximo texto vira a próxima
  // entrada ("Envie outro link ou use .menu para voltar").
  if (funcao.aceita !== "nenhum") {
    session.pending = {
      categoriaId: categoria.id,
      funcaoId: funcao.id,
      input: null,
    };
  }

  await sendResultText({ session, categoria, funcao });
}

/* ═══════════ RESUMO PÓS-DOWNLOAD (menus de qualidade/formato) ═══════════ */

/**
 * Reabre o texto final depois de um download concluído numa pendência de
 * qualidade/formato (vfmt:/fmt:). Mantém a função ativa por mais 2 minutos.
 * Chamado pelos menus através do middleware.
 */
export async function resumePendingFunction({ chatId, senderId, sendReply }) {
  const own = sessions.get(keyOf(chatId, senderId)) || null;
  if (!own || !own.pending) return false;
  if (sendReply) own.sendReply = sendReply;
  touch(own);
  const categoria = getCategory(own.pending.categoriaId);
  const funcao = getFunction(own.pending.categoriaId, own.pending.funcaoId);
  if (!categoria || !funcao) return false;
  await sendResultText({ session: own, categoria, funcao });
  return true;
}

/* ═══════════ HANDLER CENTRAL ═══════════ */

/**
 * Lê a resposta (linha de lista, com o ID como texto — ex. `cat:download`) e
 * despacha pelo prefixo do ID. Quando há estado pendente, a próxima mensagem
 * de texto/mídia é a entrada da função.
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

  infoLog(
    `[fluxo] mensagem recebida; id="${value}" chat="${chatId}" sender="${ownerId}"`,
  );

  const ownPre = sessions.get(keyOf(chatId, ownerId)) || null;

  // Com link guardado à espera de qualidade/formato (pending.input), números
  // 1-4/1-5 são escolha daquele menu, NÃO navegação do fluxo guiado. Devolve
  // false para que videoFormatMenu/audioFormatMenu os tratem.
  if (
    ownPre?.pending?.input &&
    /^\d{1,2}$/.test(value) &&
    !ownPre.cardFallback
  ) {
    infoLog(
      `[fluxo] número "${value}" é escolha do menu de qualidade/formato; a ignorar aqui`,
    );
    return false;
  }

  const own = sessions.get(keyOf(chatId, ownerId)) || null;

  // Tokens dos menus de qualidade/formato (vfmt:*, fmt:*): tratados por
  // videoFormatMenu/audioFormatMenu depois deste handler — nunca por aqui.
  if (OUTSIDE_TOKEN_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    infoLog(
      `[fluxo] token "${value}" pertence ao menu de qualidade/formato; a ignorar aqui`,
    );
    return false;
  }

  infoLog(
    `[fluxo] sessão ${ownPre ? "encontrada" : "ausente"} para "${ownerId}" em "${chatId}"${
      own?.pending ? ` (pendente: ${own.pending.funcaoId})` : ""
    }`,
  );

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
      errorLog(
        `[fluxo] pendência aponta para ${own.pending.categoriaId}/${own.pending.funcaoId}, que não existe; sessão descartada`,
      );
      dropSession(own);
      return false;
    }

    if (!canAccess(categoria, own.permissions)) {
      clearPending(own);
      infoLog(
        `[fluxo] ${ownerId} ficou sem permissão para ${categoria.id}; pendência cancelada`,
      );
      await sendReply("🚫 Esta categoria é restrita a administradores.").catch(
        () => {},
      );
      return true;
    }

    const validacao = validateInput(funcao, value, commonFunctions);

    if (!validacao.ok) {
      await sendInvalidInput({
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
    infoLog(`[fluxo] "${value}" não é token nem número do fluxo guiado; a ignorar`);
    return false;
  }

  if (!own) {
    // Havia sessão de OUTRA pessoa no chat? O menu não é dela.
    const other = findSessionInChat(chatId);
    if (other) {
      const mentions =
        other.ownerId && other.ownerId !== chatId ? [other.ownerId] : undefined;
      infoLog(
        `[fluxo] ${ownerId} tocou no menu de outra pessoa (dono ${other.ownerId})`,
      );
      await sendReply(
        `🚫 Este menu é de @${other.ownerName}. Só quem fez o pedido pode escolher.`,
        mentions,
      ).catch(() => {});
      return true;
    }
    // Sem sessão no chat: o menu expirou (TTL de 2 minutos) ou recarregou.
    infoLog(`[fluxo] sessão expirada ou inexistente para "${ownerId}"`);
    await sendReply(
      "⏳ Este menu expirou. Envia .menu para recomeçar.",
    ).catch(() => {});
    return true;
  }

  infoLog(
    `[fluxo] a despachar token "${id}" para o dono ${own.ownerId}${
      own.ownerId !== ownerId ? " (dono diferente!)" : ""
    }`,
  );

  if (permissions) session_permissions(own, permissions);

  if (id === IDS.main) {
    await sendMainCard({ socket, session: own });
    return true;
  }

  if (id.startsWith(IDS.categories)) {
    await sendCategoriesCard({ socket, session: own });
    return true;
  }

  if (id === IDS.cancel) {
    const tinhaPendente = Boolean(own.pending);
    clearPending(own);
    infoLog(
      `[fluxo] cancel${tinhaPendente ? " (depois de pendência)" : ""} pedido por ${own.ownerId}`,
    );
    await sendSimpleText({
      session: own,
      texto: "❌ Pedido cancelado. Envie .menu para recomeçar quando quiseres.",
    });
    return true;
  }

  const [namespace, first, second] = id.split(":");

  if (namespace === "cat" || namespace === "fnlist" || namespace === "back") {
    const categoria = getCategory(first);
    const denominacao = namespace === "cat" ? "categoria" : "funções";
    if (!categoria || !canAccess(categoria, own.permissions)) {
      infoLog(
        `[fluxo] ${own.ownerId} sem permissão para a ${denominacao} de "${first}"`,
      );
      await sendReply(
        "🚫 Não tens permissão para abrir esta categoria.",
      ).catch(() => {});
      return true;
    }
    await sendCategoryCard({ socket, session: own, categoria });
    return true;
  }

  if (namespace === "fn" || namespace === "run") {
    const categoria = getCategory(first);
    const funcao = getFunction(first, second);

    if (!categoria || !funcao || !canAccess(categoria, own.permissions)) {
      infoLog(
        `[fluxo] ${own.ownerId} sem permissão para a função "${second}" de "${first}"`,
      );
      await sendReply("⚠️ Esta função não está disponível para ti.").catch(
        () => {},
      );
      return true;
    }

    if (namespace === "run") {
      infoLog(`[fluxo] run em função sem entrada: ${funcao.id}`);
      const validacao = validateInput(funcao, "", commonFunctions);
      if (!validacao.ok) {
        await sendInvalidInput({
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

    await sendFunctionCard({ socket, session: own, categoria, funcao });
    return true;
  }

  await sendReply("⚠️ Opção desconhecida. Toca em Menu Principal.").catch(
    () => {},
  );
  return true;
}

function session_permissions(session, permissions) {
  session.permissions = permissions;
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
    senderJids: [
      webMessage?.key?.participant,
      webMessage?.key?.participantAlt,
    ].filter(Boolean),
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
    senderJids: [
      webMessage?.key?.participant,
      webMessage?.key?.participantAlt,
    ].filter(Boolean),
  });
}

/**
 * Registra as opções numéricas do card recém-enviado (fallback sem botões).
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
