/**
 * Menu de formato do áudio do play-audio.
 *
 * Fluxo:
 * 1. `.play <música>` baixa o MP3 e, em vez de enviar direto, manda o card com
 *    o molde padrão + rodapé e os botões [🎛️ Escolher Formato] e
 *    [📋 Copiar link] (cta_copy, só quando existe link).
 * 2. Tocar em "Escolher Formato" (token `fmt:menu`) abre a lista single-select
 *    com os 4 formatos. Se a lista falhar, cai para resposta numerada 1-4.
 * 3. A escolha fica numa pendência por chat + utilizador (TTL de 2 minutos).
 *    Envia no formato pedido e apaga o MP3 temporário.
 * 4. Quem não pediu tocar/responder → 🚫 "Este menu é de @usuario",
 *    sem consumir a pendência de quem pediu.
 * 5. Timeout → "⏳ Tempo esgotado..." + limpeza do ficheiro.
 *
 * Os tokens (`fmt:menu`, `fmt:audio`...) chegam pelo `fullMessage`, que já
 * extrai rowId/buttonId de listas e botões interativos (extractDataFromMessage).
 *
 * ATENÇÃO: não funciona no WhatsApp Business (limitação do próprio WA).
 *
 * @author Dev Gui
 */
import fs from "node:fs/promises";
import { RODAPE, downloadMessage, formatMessage } from "./formatMessage.js";
import {
  copyButton,
  numberedFallback as buildNumberedFallback,
  quickReplyButton,
  sendInteractiveWithFallback,
  singleSelectList,
  urlButton,
} from "./interactive.js";
import { errorLog } from "./logger.js";

// TTL da pendência: 2 minutos para escolher o formato.
export const AUDIO_FORMAT_TTL_MS = 2 * 60 * 1000;

const CHOICES = [
  {
    token: "fmt:audio",
    number: "1",
    title: "🎧 Áudio no chat",
    description: "Manda o MP3 solto no chat",
    fallback: "Responde apenas com o número 👇",
    confirm: "✅ Áudio enviado no chat!",
  },
  {
    token: "fmt:ptt",
    number: "2",
    title: "🎙️ Nota de voz",
    description: "Manda como nota de voz (PTT)",
    fallback: "Responde apenas com o número 👇",
    confirm: "✅ Nota de voz enviada!",
  },
  {
    token: "fmt:doc",
    number: "3",
    title: "📄 Documento MP3",
    description: "Documento com o nome do ficheiro",
    fallback: "Responde apenas com o número 👇",
    confirm: null,
  },
  {
    token: "fmt:docname",
    number: "4",
    title: "📄 Documento com título",
    description: "O título será usado como nome do ficheiro .mp3",
    fallback: "Responde apenas com o número 👇",
    confirm: null,
  },
];

const MENU_TOKEN = "fmt:menu";
const DEFAULT_CHANNEL_URL =
  "https://www.youtube.com/@devgui_?sub_confirmation=1";

// Pendências por `${chatId}:${ownerLid}`.
const pendingFormats = new Map();

function pendingKey(chatId, ownerLid) {
  return `${chatId}:${ownerLid || "sem-lid"}`;
}

function sanitizeName(value) {
  return String(value || "")
    .replace(/[\r\n*_`@]/g, "")
    .slice(0, 32);
}

function findFirstInChat(chatId) {
  const prefix = `${chatId}:`;
  for (const [key, pending] of pendingFormats) {
    if (key.startsWith(prefix)) return pending;
  }
  return null;
}

function dropPending(pending) {
  if (!pending) return;
  if (pendingFormats.get(pending.key) === pending) {
    pendingFormats.delete(pending.key);
  }
  if (pending.cleanupTimer) {
    clearTimeout(pending.cleanupTimer);
    pending.cleanupTimer = null;
  }
}

function removeFile(filePath) {
  if (!filePath) return Promise.resolve();
  return fs.rm(filePath, { force: true }).catch(() => {});
}

function numberedFallback() {
  return buildNumberedFallback(CHOICES);
}

function formatListMessage() {
  const rows = CHOICES.map((choice) => ({
    title: choice.title,
    description: choice.description,
    rowId: choice.token,
  }));

  return singleSelectList({
    text: formatMessage({
      icone: "🎵",
      titulo: "Formato do áudio",
      campos: ["Escolhe como queres receber:"],
      rodape: null,
    }),
    title: "Formato do áudio",
    footer: RODAPE,
    buttonText: "Selecionar",
    sections: [
      {
        title: "Formatos",
        rows,
      },
    ],
  });
}

function safeAudioFileName(title) {
  const name = String(title || "Áudio")
    .replace(/\.mp3$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim()
    .slice(0, 120);
  return `${name || "audio"}.mp3`;
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function getOwnerId(chatId, ownerLid) {
  if (ownerLid) return ownerLid;
  return chatId.endsWith("@g.us") ? "" : chatId;
}

/**
 * Guarda o MP3 baixado como pendência e envia o card com os botões.
 * Se o envio do card falhar, cai para a resposta numerada em texto.
 *
 * @returns {Promise<boolean>} true se o card (ou o fallback) foi enviado.
 */
export async function startAudioFormatMenu({
  socket,
  chatId,
  ownerLid,
  ownerName,
  sendReply,
  payload,
  url = "",
  channelUrl = DEFAULT_CHANNEL_URL,
}) {
  const ownerId = getOwnerId(chatId, ownerLid);
  if (!ownerId) {
    await removeFile(payload?.filePath);
    await sendReply("🚫 Não consegui confirmar quem fez o pedido. Envia o comando novamente.");
    return false;
  }

  // Um novo pedido substitui o anterior do mesmo utilizador no mesmo chat.
  const key = pendingKey(chatId, ownerId);
  const previous = pendingFormats.get(key);
  if (previous) {
    dropPending(previous);
    await removeFile(previous.payload?.filePath);
  }

  const pending = {
    key,
    chatId,
    ownerLid: ownerId,
    ownerName: sanitizeName(ownerName) || "dono do pedido",
    sendReply,
    payload: { ...payload },
    url,
  };

  pending.cleanupTimer = setTimeout(() => {
    if (pendingFormats.get(key) !== pending) return;
    pendingFormats.delete(key);
    removeFile(pending.payload?.filePath);
    pending
      .sendReply(
        "⏳ Tempo esgotado! Apaguei o áudio temporário. Usa o comando novamente.",
      )
      .catch(() => {});
  }, AUDIO_FORMAT_TTL_MS);
  pending.cleanupTimer.unref?.();

  pendingFormats.set(key, pending);

  const caption = downloadMessage({
    titulo: payload.title || "Áudio",
    canal: payload.artist,
    duracao: formatDuration(payload.duration),
    plataforma: payload.platform,
    usuario: pending.ownerName,
    extra: "✨ Escolhe o formato desejado abaixo!",
  });

  const interactiveButtons = [quickReplyButton("🎛️ Escolher Formato", MENU_TOKEN)];
  const channelButton = urlButton("📢 Canal", channelUrl);
  if (channelButton) interactiveButtons.push(channelButton);

  if (url) {
    interactiveButtons.push(copyButton("📋 Copiar link", url));
  }

  const content = { interactiveButtons, viewOnce: true };

  if (payload.thumbnail) {
    content.image = { url: payload.thumbnail };
    content.caption = caption;
  } else {
    content.text = caption;
  }

  const sent = await sendInteractiveWithFallback({
    socket,
    chatId,
    content,
    fallbackText: numberedFallback(),
    sendReply,
    onSendError: (error) =>
      errorLog(`Erro ao enviar o card de formato do áudio: ${error.message}`),
  });
  if (!sent) {
    dropPending(pending);
    await removeFile(pending.payload?.filePath);
  }
  return sent;
}

async function deliverFormat(pending, choice, helpers) {
  const { filePath, fileName, title, artist, thumbnail, mimetype } =
    pending.payload;

  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
  if (!exists) throw new Error("arquivo temporário não existe mais");

  switch (choice.token) {
    case "fmt:audio":
      await helpers.sendAudioFromFile(filePath, false, true);
      break;
    case "fmt:ptt":
      await helpers.sendAudioFromFile(filePath, true, true);
      break;
    case "fmt:doc":
      await helpers.sendAudioDocumentFromFile(
        filePath,
        fileName,
        title,
        artist,
        thumbnail,
        true,
        "audio/mpeg",
      );
      break;
    case "fmt:docname": {
      const named = safeAudioFileName(title || fileName);
      await helpers.sendAudioDocumentFromFile(
        filePath,
        named,
        title,
        artist,
        thumbnail,
        true,
        "audio/mpeg",
      );
      break;
    }
    default:
      throw new Error("formato desconhecido");
  }
}

function choiceFromText(value) {
  if (value.startsWith("fmt:")) {
    return CHOICES.find((choice) => choice.token === value) || null;
  }
  if (/^[1-4]$/.test(value)) {
    return CHOICES.find((choice) => choice.number === value) || null;
  }
  return null;
}

/**
 * Intercepta toques de botão/lista (tokens `fmt:*`) e respostas numeradas
 * (1-4) enquanto existe uma pendência de formato no chat.
 *
 * @returns {Promise<boolean>} true se a mensagem foi tratada por aqui.
 */
export async function handleAudioFormatReply({
  chatId,
  senderLid,
  senderName,
  text,
  socket,
  sendReply,
  sendErrorReply,
  sendAudioFromFile,
  sendAudioDocumentFromFile,
}) {
  const value = String(text || "").trim();
  const isToken = value.startsWith("fmt:");
  const isNumber = /^[1-4]$/.test(value);

  if (!isToken && !isNumber) {
    return false;
  }

  const senderId = senderLid || getOwnerId(chatId, "");
  const own = senderId ? pendingFormats.get(pendingKey(chatId, senderId)) : null;
  const pending = own || findFirstInChat(chatId);

  // Nada pendente neste chat: deixa o fluxo normal seguir.
  if (!pending) return false;

  // Outro utilizador tocou num botão/respondeu com número: não consome.
  if (!own) {
    const mentions =
      pending.ownerLid && pending.ownerLid !== chatId ? [pending.ownerLid] : undefined;
    await sendReply(
      `🚫 Este menu de formato é de @${pending.ownerName}! Só quem pediu pode escolher.`,
      mentions,
    ).catch(() => {});
    return true;
  }

  if (value === MENU_TOKEN) {
    await sendInteractiveWithFallback({
      socket,
      chatId,
      content: formatListMessage(),
      fallbackText: numberedFallback(),
      sendReply,
      onSendError: (error) =>
        errorLog(`Erro ao enviar a lista de formato: ${error.message}`),
    });
    return true;
  }

  const choice = choiceFromText(value);
  if (!choice) return false;

  dropPending(pending);

  try {
    await deliverFormat(pending, choice, {
      sendAudioFromFile,
      sendAudioDocumentFromFile,
    });

    await removeFile(pending.payload?.filePath);

    if (choice.confirm) {
      await sendReply(choice.confirm).catch(() => {});
    }
  } catch (error) {
    errorLog(
      `Erro ao enviar o áudio no formato ${choice.token}: ${error.message}`,
    );
    await removeFile(pending.payload?.filePath);

    const expired = /não existe mais|ENOENT/i.test(error.message);
    await (sendErrorReply || sendReply)(
      expired
        ? "❌ O áudio temporário já expirou! Pede de novo com o comando play-audio."
        : `❌ Não consegui enviar no formato escolhido: ${error.message}`,
    ).catch(() => {});
  }

  return true;
}