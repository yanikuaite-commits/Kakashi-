import fs from "node:fs/promises";
import { DEFAULT_VIDEO_HEIGHT, PENDING_DOWNLOAD_TTL_MS } from "../config.js";
import { downloadWithGenDownload } from "../utils/genDownloader.js";
import { errorLog } from "../utils/logger.js";
import { chargeMediaCredits, withCreditsContext } from "./credits.js";
import { searchYouTube } from "./youtube-search.js";
import { downloadWithYtDlp, isYtDlpAvailable } from "./ytdlp.js";

const pendingResolutions = new Map();

export function isYouTubeUrl(value) {
  return /(?:youtube\.com|youtu\.be)/i.test(value);
}

export function setPendingResolution(chatId, source) {
  pendingResolutions.set(chatId, { source, expiresAt: Date.now() + PENDING_DOWNLOAD_TTL_MS });
}

export function takePendingResolution(chatId, choice) {
  const pending = pendingResolutions.get(chatId);
  pendingResolutions.delete(chatId);
  if (!pending || pending.expiresAt < Date.now()) return null;
  const heights = [360, 480, 720, 1080, "best"];
  const index = Number(choice) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= heights.length) return null;
  return { source: pending.source, height: heights[index] };
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
    } : result;
  }
  return downloadVideo(source);
}

export async function handlePendingResolution({
  chatId,
  jid,
  text,
  sendReply,
  sendVideoFromFile,
}) {
  const value = String(text || "").trim();
  if (!/^[1-5]$/.test(value)) return false;
  const pending = takePendingResolution(chatId, value);
  if (!pending) return false;

  // Resolução escolhida: mantém o usuário no contexto para cobrar a mídia longa.
  return withCreditsContext(jid, async () => {
    await sendReply("⬇️ Baixando...");
    let result;
    try {
      result = await downloadVideo(pending.source, pending.height);
      await sendVideoFromFile(result.filePath);
    } catch (error) {
      console.error("Erro no download pendente:", error);
      await sendReply(error.message);
    } finally {
      if (result?.filePath) await fs.rm(result.filePath, { force: true }).catch(() => {});
    }
    return true;
  });
}

export function resolutionMenu() {
  return "Qual resolução você quer?\n1. 360p\n2. 480p\n3. 720p (recomendado)\n4. 1080p\n5. Best\nResponda com o número";
}
