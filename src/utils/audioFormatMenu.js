/**
 * Menu de formato do áudio (play-audio e fluxo guiado do YouTube Áudio).
 *
 * Dois modos:
 * 1. "payload" (direto .play audio): o MP3 já baixa no comando; a pendência
 *    guarda o ficheiro e envia a LISTA single-select de 4 formatos. Escolher
 *    (`fmt:audio|ptt|doc|docname`) entrega no formato pedido.
 * 2. "source" (fluxo guiado): a pendência guarda SÓ o link; escolher o formato
 *    é o gatilho do download (créditos incluídos), que é entregue no formato
 *    escolhido. Conguências passam por `withCreditsContext`.
 *
 * Nunca mais card com quick_reply: a lista é enviada direto (o WhatsApp
 * descarta quick_reply em silêncio). Fallback numerado 1-4 em texto.
 *
 * Os tokens (`fmt:*`) chegam pelo `fullMessage` (extractDataFromMessage já lê
 * o `selected_row_id` das respostas do native flow).
 *
 * @author Dev Gui
 */
import fs from "node:fs/promises";
import { RODAPE, downloadMessage } from "./formatMessage.js";
import {
  numberedFallback as buildNumberedFallback,
  sendInteractiveWithFallback,
  singleSelectList,
} from "./interactive.js";
import { errorLog, infoLog } from "./logger.js";
import { withCreditsContext } from "../services/credits.js";
import { downloadByCommand } from "../services/downloader.js";

// TTL da pendência: 2 minutos para escolher o formato.
export const AUDIO_FORMAT_TTL_MS = 2 * 60 * 1000;

const CHOICES = [
  {
    token: "fmt:audio",
    number: "1",
    title: "🎧 Áudio no chat",
    description: "Manda o MP3 solto no chat",
    confirm: "✅ Áudio enviado no chat!",
  },
  {
    token: "fmt:ptt",
    number: "2",
    title: "🎙️ Nota de voz",
    description: "Manda como nota de voz (PTT)",
    confirm: "✅ Nota de voz enviada!",
  },
  {
    token: "fmt:doc",
    number: "3",
    title: "📄 Documento MP3",
    description: "Documento com o nome do ficheiro",
    confirm: "✅ Documento enviado!",
  },
  {
    token: "fmt:docname",
    number: "4",
    title: "📄 Documento com título",
    description: "O título será usado como nome do ficheiro .mp3",
    confirm: "✅ Documento enviado!",
  },
];

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

function formatListMessage(textoLista) {
  const rows = CHOICES.map((choice) => ({
    title: choice.title,
    description: choice.description,
    rowId: choice.token,
  }));

  return singleSelectList({
    text: textoLista,
    title: "Formato do áudio",
    footer: RODAPE,
    buttonText: "Selecionar",
    sections: [
      {
        title: "Áudio",
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

function legendOf(pending, extraPrompt) {
  return downloadMessage({
    titulo: pending.kind === "source"
      ? "Áudio — escolhe o formato"
      : pending.payload?.title || "Áudio",
    canal: pending.kind === "source" ? "" : pending.payload?.artist,
    duracao: pending.kind === "source"
      ? ""
      : formatDuration(pending.payload?.duration),
    plataforma: pending.kind === "source"
      ? /youtube\.com|youtu\.be/i.test(pending.source || "")
        ? "YouTube"
        : "Link direto"
      : pending.payload?.platform,
    usuario: pending.ownerName,
    extra: extraPrompt,
  });
}

function normalizePayload(payload) {
  return {
    filePath: payload?.filePath || "",
    fileName: payload?.fileName || "",
    title: payload?.title || "",
    artist: payload?.artist || "",
    thumbnail: payload?.thumbnail || "",
    mimetype: payload?.mimetype || "audio/mpeg",
    duration: payload?.duration,
    platform: payload?.platform || "",
  };
}

/**
 * Guarda o MP3 baixado como pendência e envia a LISTA de formatos
 * (single_select, sem quick_reply). Cai na resposta numerada em texto se o
 * envio da lista falhar.
 *
 * @returns {Promise<boolean>} true se a lista (ou o fallback) foi enviada.
 */
export async function startAudioFormatMenu({
  socket,
  chatId,
  ownerLid,
  ownerName,
  sendReply,
  payload,
  url = "",
  onFinished,
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
    kind: "payload",
    payload: normalizePayload(payload),
    onFinished,
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

  infoLog(
    `[afmt] lista de formato (modo payload) enviada para "${chatId}" (owner ${ownerId})`,
  );

  const sent = await sendInteractiveWithFallback({
    socket,
    chatId,
    // A LISTA É O PRÓPRIO CONTEÚDO (listMessage): sem quick_reply.
    content: formatListMessage(
      legendOf(pending, "✨ Escolhe o formato na lista!"),
    ),
    fallbackText: numberedFallback(),
    sendReply,
    onSendError: (error) =>
      errorLog(`Erro ao enviar a lista de formato do áudio: ${error.message}`),
  });
  if (!sent) {
    dropPending(pending);
    await removeFile(pending.payload?.filePath);
  }
  return Boolean(sent);
}

/**
 * Modo do fluxo guiado: guarda SÓ o link; a escolha do formato baixa e
 * entrega o áudio. Devolve true se a lista (ou fallback) foi enviada.
 */
export async function startAudioSourceMenu({
  socket,
  chatId,
  ownerLid,
  ownerName,
  sendReply,
  source,
  jid,
  onFinished,
}) {
  const ownerId = getOwnerId(chatId, ownerLid);
  if (!ownerId) {
    await sendReply("🚫 Não consegui confirmar quem fez o pedido. Envia o comando novamente.");
    return false;
  }

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
    kind: "source",
    source,
    jid,
    payload: null,
    onFinished,
  };

  pending.cleanupTimer = setTimeout(() => {
    if (pendingFormats.get(key) !== pending) return;
    pendingFormats.delete(key);
    removeFile(pending.payload?.filePath);
    pending
      .sendReply(
        "⏳ Tempo esgotado! Nada foi baixado. Usa .menu ou o comando play audio novamente.",
      )
      .catch(() => {});
  }, AUDIO_FORMAT_TTL_MS);
  pending.cleanupTimer.unref?.();

  pendingFormats.set(key, pending);

  infoLog(
    `[afmt] lista de formato (modo source) enviada para "${chatId}" (owner ${ownerId}; download só na escolha)`,
  );

  const sent = await sendInteractiveWithFallback({
    socket,
    chatId,
    content: formatListMessage(
      legendOf(pending, "✨ O download acontece só depois da escolha!"),
    ),
    fallbackText: numberedFallback(),
    sendReply,
    onSendError: (error) =>
      errorLog(`Erro ao enviar a lista de formato do áudio: ${error.message}`),
  });
  if (!sent) {
    dropPending(pending);
  }
  return Boolean(sent);
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

async function deliverAndConfirm(pending, choice, helpers, sendReply, sendErrorReply, onFinished) {
  try {
    await deliverFormat(pending, choice, helpers);
    await removeFile(pending.payload?.filePath);
    if (choice.confirm) {
      await sendReply(choice.confirm).catch(() => {});
    }
    infoLog(
      `[afmt] áudio entregue em ${choice.token}; a chamar onFinished`,
    );
    await (pending.onFinished || onFinished)?.({
      choice,
      ok: true,
    }).catch(() => {});
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
 * Intercepta escolhas da lista (tokens `fmt:*`) e respostas numeradas (1-4)
 * enquanto existe uma pendência de formato no chat.
 *
 * @returns {Promise<boolean>} true se a mensagem foi tratada por aqui.
 */
export async function handleAudioFormatReply({
  chatId,
  senderLid,
  senderName,
  text,
  socket,
  jid,
  sendReply,
  sendErrorReply,
  sendAudioFromFile,
  sendAudioDocumentFromFile,
  onFinished,
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

  infoLog(`[afmt] escolha recebida "${value}" de ${senderId || "sem-id"}`);

  if (value === "fmt:menu") {
    // Compatibilidade: antigo token do card com quick_reply; manda a lista.
    await sendInteractiveWithFallback({
      socket,
      chatId,
      content: formatListMessage(
        legendOf(pending, "✨ Escolhe o formato na lista!"),
      ),
      fallbackText: numberedFallback(),
      sendReply,
      onSendError: (error) =>
        errorLog(`Erro ao reenviar a lista de formato: ${error.message}`),
    });
    return true;
  }

  const choice = choiceFromText(value);
  if (!choice) return false;

  const helpers = { sendAudioFromFile, sendAudioDocumentFromFile };

  if (pending.kind === "source") {
    // Download só na escolha; a pendência fica viva enquanto o download corre.
    if (pending.downloading) return true;
    pending.downloading = true;
    try {
      await sendReply("⬇️ Baixando o áudio...").catch(() => {});
      const data = await withCreditsContext(pending.jid, () =>
        downloadByCommand("play-audio", pending.source),
      );
      pending.payload = normalizePayload(data);
      dropPending(pending);
      await deliverAndConfirm(pending, choice, helpers, sendReply, sendErrorReply, onFinished);
    } catch (error) {
      pending.downloading = false;
      errorLog(`[afmt] falha no download (source): ${error.message}`);
      await (sendErrorReply || sendReply)(
        `❌ Não consegui baixar o áudio: ${error.message}`,
      ).catch(() => {});
    }
    return true;
  }

  dropPending(pending);
  await deliverAndConfirm(pending, choice, helpers, sendReply, sendErrorReply, onFinished);
  return true;
}
