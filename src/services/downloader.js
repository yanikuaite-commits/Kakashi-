import fs from "node:fs/promises";
import { DEFAULT_VIDEO_HEIGHT, PENDING_DOWNLOAD_TTL_MS } from "../config.js";
import { downloadWithGenDownload } from "../utils/genDownloader.js";
import { errorLog } from "../utils/logger.js";
import { chargeMediaCredits } from "./credits.js";
import { searchYouTube } from "./youtube-search.js";
import { downloadWithYtDlp, isYtDlpAvailable } from "./ytdlp.js";

const pendingDocOffers = new Map();

export function isYouTubeUrl(value) {
  return /(?:youtube\.com|youtu\.be)/i.test(value);
}

/**
 * Pergunta pós-áudio: guarda os dados do MP3 até o usuário decidir se quer
 * também a versão documento. Sem resposta no TTL, o arquivo é apagado.
 */
export function setPendingDocOffer(chatId, payload) {
  const offer = { ...payload, expiresAt: Date.now() + PENDING_DOWNLOAD_TTL_MS };
  pendingDocOffers.set(chatId, offer);
  offer.cleanupTimer = setTimeout(() => {
    const current = pendingDocOffers.get(chatId);
    if (current === offer) {
      pendingDocOffers.delete(chatId);
      if (offer.filePath) fs.rm(offer.filePath, { force: true }).catch(() => {});
    }
  }, PENDING_DOWNLOAD_TTL_MS);
  offer.cleanupTimer.unref?.();
}

function takePendingDocOffer(chatId) {
  const offer = pendingDocOffers.get(chatId);
  pendingDocOffers.delete(chatId);
  if (offer?.cleanupTimer) clearTimeout(offer.cleanupTimer);
  if (!offer || offer.expiresAt < Date.now()) {
    if (offer?.filePath) fs.rm(offer.filePath, { force: true }).catch(() => {});
    return null;
  }
  return offer;
}

/**
 * Responde "1" (manda como documento) ou "2" (envia o arquivo MP3 solto
 * no chat). Consome a oferta em qualquer caso e apaga o arquivo temporário.
 */
export async function handlePendingDocOffer({
  chatId,
  text,
  sendReply,
  sendAudioDocumentFromFile,
}) {
  const value = String(text || "").trim();
  if (value !== "1" && value !== "2" && !/^(sim|nao|não)$/i.test(value)) return false;
  const offer = takePendingDocOffer(chatId);
  if (!offer) return false;

  const wantsDoc = value === "1" || /^sim$/i.test(value);
  if (wantsDoc) {
    await sendReply("📄 Transformando em documento...");
    try {
      await sendAudioDocumentFromFile(
        offer.filePath,
        offer.fileName,
        offer.title,
        offer.artist,
        offer.thumbnail,
        true,
        offer.mimetype,
      );
    } catch (error) {
      errorLog(`Erro ao enviar documento do áudio pendente: ${error.message}`);
      await sendReply("❌ Não consegui enviar o documento agora. Peça de novo com .play audio.");
    }
  } else {
    await sendReply("👍 Tudo certo, fico com a versão em áudio mesmo!");
  }

  if (offer.filePath) await fs.rm(offer.filePath, { force: true }).catch(() => {});
  return true;
}

/**
 * Mídias longas/pesadas gastam créditos extras depois do download.
 * Fora de uma sessão de usuário (ex: dono do bot) nada é cobrado.
 */
async function settleMediaCredits(command, result) {
  await chargeMediaCredits({
    command,
    bytes: result?.fileSize,
    seconds: result?.duration,
  });

  return result;
}

/**
 * Escolhe o downloader: yt-dlp (local, recomendado no Render/Docker) quando
 * disponível, com fallback automático para a API GenDownload.
 */
async function downloadMedia(source, options) {
  if (await isYtDlpAvailable()) {
    try {
      return await downloadWithYtDlp(source, options);
    } catch (error) {
      errorLog(
        `Falha no yt-dlp (${error.message}). Tentando a API GenDownload...`,
      );
    }
  }

  return downloadWithGenDownload(source, options);
}

export async function downloadVideo(source, height = DEFAULT_VIDEO_HEIGHT) {
  const result = await downloadMedia(source, { height });

  return settleMediaCredits("vídeo", result);
}

export async function downloadAudio(source) {
  const result = await downloadMedia(source, { audio: true });

  return settleMediaCredits("áudio", result);
}

export async function resolveDownloadSource(command, value, search = searchYouTube) {
  let source = value;
  let match;
  if (["play-audio", "play-video"].includes(command) && !/^https?:\/\//i.test(value)) {
    [match] = await search(value, 1);
    if (!match) throw new Error("Nenhum vídeo encontrado para esta pesquisa.");
    source = match.url;
  }
  return { source, match };
}

export async function downloadByCommand(command, value, search = searchYouTube) {
  const { source, match } = await resolveDownloadSource(command, value, search);
  if (["play-audio", "tik-tok-audio"].includes(command)) {
    const result = await downloadAudio(source);
    return match ? {
      ...result,
      title: match.title,
      artist: match.artist,
      thumbnail: match.thumbnail,
      url: match.url,
    } : result;
  }
  return downloadVideo(source);
}

