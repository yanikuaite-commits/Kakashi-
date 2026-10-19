/**
 * Menu de qualidade do vídeo (play-video e fluxo guiado do YouTube Vídeo).
 *
 * Fluxo:
 * 1. O link/termo é guardado como pendância por chat + utilizador (TTL de 2
 *    minutos) e a LISTA single-select de qualidades é enviada direto — nunca
 *    mais um card com botões quick_reply (que o WhatsApp descarta em silêncio).
 * 2. Escolher a qualidade (token `vfmt:height`, ex. `vfmt:720`) baixa o vídeo
 *    nesse height e envia. Se a lista falhar, cai para resposta numerada 1-5.
 * 3. Só quem pediu escolhe; timeout → "⏳ Tempo esgotado..." (nada baixado).
 * 4. Depois do envio com sucesso, `onFinished` (ligado pelo middleware ao fluxo
 *    guiado) manda o resumo e mantém a função ativa por mais 2 minutos.
 *
 * Os tokens (`vfmt:720`...) chegam pelo `fullMessage`, que já extrai
 * `selected_row_id` das respostas do native flow (extractDataFromMessage).
 *
 * Este menu NÃO usa o registo genérico de `interactive.js`: a escolha dispara
 * um download, não um comando, por isso `handleVideoFormatReply` é chamado
 * antes de `handleInteractiveMenuReply` no middleware (e depois do fluxo
 * guiado, que ignora tokens `vfmt:*`).
 *
 * @author Dev Gui
 */
import fs from "node:fs/promises";
import {
  INTERACTIVE_MENU_TTL_MS,
  numberedFallback as buildNumberedFallback,
  sendInteractiveWithFallback,
  singleSelectList,
} from "./interactive.js";
import { RODAPE, downloadMessage } from "./formatMessage.js";
import { errorLog, infoLog } from "./logger.js";
import { withCreditsContext } from "../services/credits.js";
import { downloadVideo } from "../services/downloader.js";

// TTL da pendência: 2 minutos para escolher a qualidade.
export const VIDEO_FORMAT_TTL_MS = INTERACTIVE_MENU_TTL_MS;

const CHOICES = [
  {
    token: "vfmt:360",
    number: "1",
    height: 360,
    label: "360p",
    title: "📱 360p",
    description: "Leve, gasta menos dados",
  },
  {
    token: "vfmt:480",
    number: "2",
    height: 480,
    label: "480p",
    title: "📺 480p",
    description: "Equilíbrio entre tamanho e qualidade",
  },
  {
    token: "vfmt:720",
    number: "3",
    height: 720,
    label: "720p",
    title: "🎬 720p (recomendado)",
    description: "Boa qualidade em HD",
  },
  {
    token: "vfmt:1080",
    number: "4",
    height: 1080,
    label: "1080p",
    title: "🖥️ 1080p",
    description: "Full HD, ficheiro maior",
  },
  {
    token: "vfmt:best",
    number: "5",
    height: "best",
    label: "Best",
    title: "🏆 Best",
    description: "Melhor qualidade disponível",
  },
];

// Pendências por `${chatId}:${ownerId}`.
const pendingFormats = new Map();

function pendingKey(chatId, ownerId) {
  return `${chatId}:${ownerId}`;
}

function sanitizeName(value) {
  return String(value || "")
    .replace(/[\r\n*_`@]/g, "")
    .slice(0, 32);
}

function getOwnerId(chatId, ownerLid) {
  if (ownerLid) return ownerLid;
  return chatId.endsWith("@g.us") ? "" : chatId;
}

function findFirstInChat(chatId) {
  for (const pending of pendingFormats.values()) {
    if (pending.chatId === chatId) return pending;
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
    title: "Qualidade do vídeo",
    footer: RODAPE,
    buttonText: "Selecionar",
    sections: [
      {
        title: "Vídeo",
        rows,
      },
    ],
  });
}

function platformOf(source) {
  return /youtube\.com|youtu\.be/i.test(String(source || ""))
    ? "YouTube"
    : "Link direto";
}

/**
 * Guarda a origem do vídeo como pendência e envia a LISTA de qualidades
 * (single_select, sem quick_reply). Se o envio falhar, cai para a resposta
 * numerada em texto.
 *
 * @returns {Promise<boolean>} true se a lista (ou o fallback) foi enviada.
 */
export async function startVideoFormatMenu({
  socket,
  chatId,
  ownerLid,
  ownerName,
  sendReply,
  source,
  title = "",
  artist = "",
  duration = "",
  thumbnail = "",
  url = "",
  channelUrl,
  onFinished,
}) {
  const ownerId = getOwnerId(chatId, ownerLid);
  if (!ownerId) {
    await sendReply(
      "🚫 Não consegui confirmar quem fez o pedido. Envia o comando novamente.",
    ).catch(() => {});
    return false;
  }

  // Um novo pedido substitui o anterior do mesmo utilizador no mesmo chat.
  const key = pendingKey(chatId, ownerId);
  dropPending(pendingFormats.get(key));

  const pending = {
    key,
    chatId,
    ownerId,
    ownerName: sanitizeName(ownerName) || "dono do pedido",
    sendReply,
    source,
    onFinished,
  };

  pending.cleanupTimer = setTimeout(() => {
    if (pendingFormats.get(key) !== pending) return;
    pendingFormats.delete(key);
    pending
      .sendReply(
        "⏳ Tempo esgotado! Nada foi baixado. Usa .menu ou o comando play video novamente.",
      )
      .catch(() => {});
  }, VIDEO_FORMAT_TTL_MS);
  pending.cleanupTimer.unref?.();

  pendingFormats.set(key, pending);

  const caption = downloadMessage({
    titulo: title || "Vídeo",
    canal: artist,
    duracao: duration,
    plataforma: platformOf(source),
    usuario: pending.ownerName,
    extra: "✨ Escolhe a qualidade na lista!",
  });

  infoLog(
    `[vfmt] lista de qualidade enviada para "${chatId}" (owner ${ownerId}, fonte "${platformOf(source)}")`,
  );

  const sent = await sendInteractiveWithFallback({
    socket,
    chatId,
    // A LISTA É O PRÓPRIO CONTEÚDO (listMessage): sem quick_reply.
    content: formatListMessage(caption),
    fallbackText: numberedFallback(),
    sendReply,
    onSendError: (error) =>
      errorLog(`Erro ao enviar a lista de qualidade do vídeo: ${error.message}`),
  });

  if (!sent) {
    dropPending(pending);
  }

  return Boolean(sent);
}

function choiceFromText(value) {
  if (value.startsWith("vfmt:")) {
    return CHOICES.find((choice) => choice.token === value) || null;
  }
  if (/^[1-5]$/.test(value)) {
    return CHOICES.find((choice) => choice.number === value) || null;
  }
  return null;
}

/**
 * Intercepta escolhas da lista (tokens `vfmt:*`) e respostas numeradas (1-5)
 * enquanto existe uma pendência de qualidade no chat. A escolha do menu de
 * qualidade BAIXA e envia o vídeo (um número do card guiado nunca é a resposta
 * da qualidade e vice-versa: o fluxo guiado ignora tokens vfmt:*).
 *
 * @returns {Promise<boolean>} true se a mensagem foi tratada por aqui.
 */
export async function handleVideoFormatReply({
  chatId,
  senderLid,
  senderName,
  text,
  socket,
  jid,
  sendReply,
  sendErrorReply,
  sendVideoFromFile,
  onFinished,
  download = (source, height) => downloadVideo(source, height),
}) {
  const value = String(text || "").trim();
  const isToken = value.startsWith("vfmt:");
  const isNumber = /^[1-5]$/.test(value);

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
      pending.ownerId && pending.ownerId !== chatId
        ? [pending.ownerId]
        : undefined;
    await sendReply(
      `🚫 Este menu de qualidade é de @${pending.ownerName}! Só quem pediu pode escolher.`,
      mentions,
    ).catch(() => {});
    return true;
  }

  infoLog(`[vfmt] escolha recebida "${value}" de ${senderId || "sem-id"}`);

  if (value === "vfmt:menu") {
    // Compatibilidade: antigo token do card com quick_reply. A lista direta já
    // foi enviada no talo do menu; manda a lista de novo.
    const caption = downloadMessage({
      titulo: "Vídeo",
      plataforma: platformOf(pending.source),
      usuario: pending.ownerName,
      extra: "✨ Escolhe a qualidade na lista!",
    });
    await sendInteractiveWithFallback({
      socket,
      chatId,
      content: formatListMessage(caption),
      fallbackText: numberedFallback(),
      sendReply,
      onSendError: (error) =>
        errorLog(`Erro ao reenviar a lista de qualidade: ${error.message}`),
    });
    return true;
  }

  const choice = choiceFromText(value);
  if (!choice) return false;

  dropPending(pending);

  await sendReply("⬇️ Baixando o vídeo...").catch(() => {});

  let result;
  try {
    // Mantém o utilizador no contexto para cobrar a mídia longa.
    result = await withCreditsContext(jid, () =>
      download(pending.source, choice.height),
    );
    await sendVideoFromFile(result.filePath, `🎬 Vídeo em ${choice.label}`);

    infoLog(
      `[vfmt] vídeo em ${choice.label} enviado (id ${result?.filePath || "?"}); a chamar onFinished`,
    );
    await (pending.onFinished || onFinished)?.({
      choice,
      ok: true,
    }).catch(() => {});
  } catch (error) {
    errorLog(
      `Erro ao baixar o vídeo na qualidade ${choice.token}: ${error.message}`,
    );
    await (sendErrorReply || sendReply)(
      `❌ Não consegui baixar o vídeo: ${error.message}`,
    ).catch(() => {});
  } finally {
    if (result?.filePath) {
      await fs.rm(result.filePath, { force: true }).catch(() => {});
    }
  }

  return true;
}
