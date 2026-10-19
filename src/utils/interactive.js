/** Helpers para montar e enviar mensagens interativas com fallback em texto. */
import { randomUUID } from "node:crypto";
import { ensureFrame, withFooter } from "./formatMessage.js";
import { errorLog } from "./logger.js";

export const INTERACTIVE_MENU_TTL_MS = 2 * 60 * 1000;

const pendingMenus = new Map();

export function createInteractiveActionId() {
  return `kmenu:${randomUUID()}`;
}

export function urlButton(label, url) {
  try {
    if (new URL(url).protocol !== "https:") return null;
  } catch {
    return null;
  }

  return {
    name: "cta_url",
    buttonParamsJson: JSON.stringify({ display_text: label, url }),
  };
}

export function copyButton(label, value) {
  return {
    name: "cta_copy",
    buttonParamsJson: JSON.stringify({ display_text: label, copy_code: value }),
  };
}

/**
 * Botão nativeFlow `single_select`: abre a lista de opções direto do card.
 *
 * @param {string} label texto do botão
 * @param {Array<{title: string, rows: Array<{id: string, title: string, description?: string}>}>} sections
 * @param {{title?: string}} [options] título interno da lista
 */
export function singleSelectButton(label, sections, { title } = {}) {
  if (!Array.isArray(sections) || !sections.some((section) => section.rows?.length)) {
    return null;
  }

  return {
    name: "single_select",
    buttonParamsJson: JSON.stringify({
      title: title || label,
      sections,
    }),
  };
}

export function singleSelectList({
  text,
  title,
  footer,
  buttonText = "Selecionar",
  sections,
  viewOnce = true,
}) {
  return { text, title, footer, buttonText, sections, viewOnce };
}

export function numberedFallback(options, prompt = "Responde apenas com o número 👇") {
  return [
    "Não consegui abrir o menu interativo 😕",
    "",
    ...options.map(({ number, title }) => `${number}. ${title}`),
    "",
    prompt,
  ].join("\n");
}

function idsFromContent(content) {
  const ids = [];

  for (const button of content.buttons || []) {
    const id = button?.buttonId || button?.id;
    if (id) ids.push(String(id));
  }

  for (const button of content.interactiveButtons || []) {
    try {
      const params = JSON.parse(button?.buttonParamsJson || "{}");
      const id = params.id || params.selectedId || params.selectedRowId;
      if (id) ids.push(String(id));
    } catch {
      // Botões externos não têm ID de resposta.
    }
  }

  for (const section of content.sections || []) {
    for (const row of section.rows || []) {
      const id = row?.rowId || row?.id;
      if (id) ids.push(String(id));
    }
  }

  return ids;
}

function pendingKey(chatId, ownerId) {
  return `${chatId}:${ownerId}`;
}

function clearPendingMenu(menu) {
  if (!menu) return;
  if (pendingMenus.get(menu.key) === menu) pendingMenus.delete(menu.key);
  clearTimeout(menu.cleanupTimer);
}

export function clearInteractiveMenu(chatId, ownerId) {
  if (!ownerId) return;
  clearPendingMenu(pendingMenus.get(pendingKey(chatId, ownerId)));
}

function registerMenu({
  chatId,
  ownerId,
  ids,
  responseMappings = [],
  fallbackActions = [],
  sendReply,
}) {
  if (!ownerId || (!ids.length && !fallbackActions.length)) return;

  const key = pendingKey(chatId, ownerId);
  const previous = pendingMenus.get(key);
  if (previous) clearTimeout(previous.cleanupTimer);

  const menu = {
    key,
    chatId,
    ownerId,
    ids: new Set([...(previous?.ids || []), ...ids]),
    responseMappings: new Map(previous?.responseMappings || []),
    fallbackActions: new Map(previous?.fallbackActions || []),
    sendReply,
  };

  for (const mapping of responseMappings) {
    menu.responseMappings.set(String(mapping.id), String(mapping.target));
  }

  for (const action of fallbackActions) {
    menu.fallbackActions.set(String(action.number), {
      id: action.id ? String(action.id) : null,
      reply: action.reply ? String(action.reply) : null,
    });
  }

  menu.cleanupTimer = setTimeout(() => {
    if (pendingMenus.get(key) !== menu) return;
    pendingMenus.delete(key);
    Promise.resolve(
      menu.sendReply?.("⏳ O tempo deste menu terminou. Abre-o novamente para escolher."),
    ).catch(() => {});
  }, INTERACTIVE_MENU_TTL_MS);
  menu.cleanupTimer.unref?.();

  pendingMenus.set(key, menu);
}

/** Restringe IDs de menus ao autor e converte fallback numérico no ID original. */
export async function handleInteractiveMenuReply({
  chatId,
  senderId,
  text,
  sendReply,
}) {
  const value = String(text || "").trim();
  const chatMenus = [...pendingMenus.values()].filter((menu) => menu.chatId === chatId);
  if (!chatMenus.length) {
    if (!value.startsWith("kmenu:")) return null;
    await sendReply("⏳ Esta opção expirou. Abre o menu novamente para escolher.");
    return { handled: true };
  }

  const own = senderId
    ? pendingMenus.get(pendingKey(chatId, senderId))
    : null;
  const ownTokenMenu = own?.ids.has(value) ? own : null;
  const tokenMenu =
    ownTokenMenu || chatMenus.find((menu) => menu.ids.has(value));
  const numberMenu =
    own?.fallbackActions.has(value)
      ? own
      : chatMenus.find((menu) => menu.fallbackActions.has(value));
  const numberAction = numberMenu?.fallbackActions.get(value);
  const menu = tokenMenu || (numberAction ? numberMenu : null);
  if (!menu) {
    if (value.startsWith("kmenu:")) {
      await sendReply("⏳ Esta opção expirou. Abre o menu novamente para escolher.");
      return { handled: true };
    }
    return null;
  }

  if (!own || menu.ownerId !== senderId) {
    await sendReply("🚫 Este menu pertence a quem fez o pedido. Só essa pessoa pode escolher.");
    return { handled: true };
  }

  if (tokenMenu) {
    const selectedId = tokenMenu.responseMappings.get(value);
    clearPendingMenu(tokenMenu);
    if (selectedId) return { handled: false, selectedId };
    if (value.startsWith("kmenu:")) return { handled: true };
    return { handled: false };
  }

  if (numberAction) {
    clearPendingMenu(own);
    if (numberAction.reply) {
      await sendReply(numberAction.reply);
      return { handled: true };
    }
    if (numberAction.id) {
      return { handled: false, selectedId: numberAction.id };
    }
  }

  return null;
}

export async function sendInteractiveWithFallback({
  socket,
  chatId,
  content,
  fallbackText,
  sendReply,
  onSendError,
  ownerId,
  responseMappings = [],
  fallbackActions = [],
}) {
  /**
   * Envia o conteúdo (card nativeFlow com `interactiveButtons` só com
   * `single_select` + `cta_url`, ou lista clássica) e devolve o resultado do
   * `socket.sendMessage` (objeto com `key.id`), para os logs do fluxo guiado.
   * No fallback em texto devolve `true`.
   */
  try {
    const sent = await socket.sendMessage(chatId, content);
    registerMenu({
      chatId,
      ownerId,
      ids: idsFromContent(content),
      responseMappings,
      sendReply,
    });
    return sent || true;
  } catch (error) {
    if (onSendError) {
      onSendError(error);
    } else {
      errorLog(
        `Falha ao enviar mensagem interativa para ${chatId}: ${error.message || error}`,
      );
    }
    if (!sendReply || !fallbackText) return false;

    try {
      if (!sendReply) throw new Error("sendReply indisponível");
      await sendReply(fallbackText);
      registerMenu({
        chatId,
        ownerId,
        ids: idsFromContent(content),
        responseMappings,
        fallbackActions,
        sendReply,
      });
      return true;
    } catch (replyError) {
      errorLog(
        `O fallback via sendReply falhou para ${chatId}: ${replyError.message || replyError}; a tentar envio direto.`,
      );

      try {
        await socket.sendMessage(chatId, {
          text: withFooter(ensureFrame(fallbackText)),
        });
        registerMenu({
          chatId,
          ownerId,
          ids: idsFromContent(content),
          responseMappings,
          fallbackActions,
          sendReply,
        });
        return true;
      } catch (fallbackError) {
        errorLog(
          `O fallback direto também falhou para ${chatId}: ${fallbackError.message || fallbackError}`,
        );
        throw new Error(
          `Falha no menu interativo e no fallback: ${fallbackError.message || fallbackError}`,
          { cause: fallbackError },
        );
      }
    }
  }
}