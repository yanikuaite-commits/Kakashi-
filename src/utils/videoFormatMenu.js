/**
 * Menu de qualidade do vídeo do play-video.
 *
 * Fluxo:
 * 1. `.play video <nome ou link>` resolve o vídeo e, em vez de pedir só um
 *    número, manda o card "📥 Download" (molde padrão + rodapé) com os botões
 *    [🎛️ Escolher Qualidade], [📢 Canal] e [📋 Copiar link] (os dois últimos
 *    quando fazem sentido).
 * 2. Tocar em "Escolher Qualidade" (token `vfmt:menu`) abre a lista
 *    single-select com as 5 qualidades. Se a lista falhar, cai para resposta
 *    numerada 1-5.
 * 3. A escolha fica numa pendência por chat + utilizador (TTL de 2 minutos).
 *    Só aí o vídeo é baixado, no `height` escolhido.
 * 4. Quem não pediu tocar/responder → 🚫 "Este menu é de @usuario",
 *    sem consumir a pendência de quem pediu.
 * 5. Timeout → "⏳ Tempo esgotado..." (nada foi baixado ainda).
 *
 * Os tokens (`vfmt:menu`, `vfmt:720`...) chegam pelo `fullMessage`, que já
 * extrai rowId/buttonId de listas e botões interativos (extractDataFromMessage).
 *
 * Este menu NÃO usa o registo genérico de `interactive.js`: a escolha dispara
 * um download, não um comando, por isso `handleVideoFormatReply` é chamado
 * antes de `handleInteractiveMenuReply` no middleware.
 *
 * ATENÇÃO: não funciona no WhatsApp Business (limitação do próprio WA).
 *
 * @author Dev Gui
 */
import fs from "node:fs/promises";
import {
  INTERACTIVE_MENU_TTL_MS,
  copyButton,
  numberedFallback as buildNumberedFallback,
  quickReplyButton,
  sendInteractiveWithFallback,
  singleSelectList,
  urlButton,
} from "./interactive.js";
import { RODAPE, downloadMessage, formatMessage } from "./formatMessage.js";
import { errorLog } from "./logger.js";
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

const MENU_TOKEN = "vfmt:menu";
const DEFAULT_CHANNEL_URL =
  "https://www.youtube.com/@devgui_?sub_confirmation=1";

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

function formatListMessage() {
  const rows = CHOICES.map((choice) => ({
    title: choice.title,
    description: choice.description,
    rowId: choice.token,
  }));

  return singleSelectList({
    text: formatMessage({
      icone: "🎬",
      titulo: "Qualidade do vídeo",
      campos: ["Escolhe em que qualidade queres baixar:"],
      rodape: null,
    }),
    title: "Qualidade do vídeo",
    footer: RODAPE,
    buttonText: "Selecionar",
    sections: [
      {
        title: "Qualidades",
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
 * Guarda a origem do vídeo como pendência e envia o card com os botões.
 * Se o envio falhar, cai para a resposta numerada em texto.
 *
 * @returns {Promise<boolean>} true se o card (ou o fallback) foi enviado.
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
  channelUrl = DEFAULT_CHANNEL_URL,
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
  };

  pending.cleanupTimer = setTimeout(() => {
    if (pendingFormats.get(key) !== pending) return;
    pendingFormats.delete(key);
    pending
      .sendReply(
        "⏳ Tempo esgotado! Nada foi baixado. Usa o comando play video novamente.",
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
    extra: "✨ Escolhe a qualidade desejada abaixo!",
  });

  const interactiveButtons = [
    quickReplyButton("🎛️ Escolher Qualidade", MENU_TOKEN),
  ];
  const channelButton = urlButton("📢 Canal", channelUrl);
  if (channelButton) interactiveButtons.push(channelButton);

  if (url) {
    interactiveButtons.push(copyButton("📋 Copiar link", url));
  }

  const content = { interactiveButtons, viewOnce: true };

  if (thumbnail) {
    content.image = { url: thumbnail };
    content.caption = caption;
  } else {
    content.text = caption;
  }

  // Sem `ownerId`: a pendência é tratada aqui, não pelo registo genérico de
  // `interactive.js` (a escolha baixa o vídeo em vez de disparar um comando).
  const sent = await sendInteractiveWithFallback({
    socket,
    chatId,
    content,
    fallbackText: numberedFallback(),
    sendReply,
    onSendError: (error) =>
      errorLog(`Erro ao enviar o card de qualidade do vídeo: ${error.message}`),
  });

  if (!sent) {
    dropPending(pending);
  }

  return sent;
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
 * Intercepta toques de botão/lista (tokens `vfmt:*`) e respostas numeradas
 * (1-5) enquanto existe uma pendência de qualidade no chat.
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

  if (value === MENU_TOKEN) {
    await sendInteractiveWithFallback({
      socket,
      chatId,
      content: formatListMessage(),
      fallbackText: numberedFallback(),
      sendReply,
      onSendError: (error) =>
        errorLog(`Erro ao enviar a lista de qualidade: ${error.message}`),
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
