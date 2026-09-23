import fs from "node:fs/promises";
import { DEFAULT_VIDEO_HEIGHT, PENDING_DOWNLOAD_TTL_MS } from "../config.js";
import { downloadWithCobalt } from "../utils/cobaltDownloader.js";
import { searchYouTube } from "./youtube-search.js";

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

export async function downloadVideo(source, height = DEFAULT_VIDEO_HEIGHT) {
  return downloadWithCobalt(source, { height });
}

export async function downloadAudio(source) {
  const result = await downloadWithCobalt(source, { audio: true });
  return { ...result, title: "Música", artist: "", thumbnail: null, fileName: "musica.mp3" };
}

export async function downloadByCommand(command, value, search = searchYouTube) {
  let source = value;
  let match;
  if (["play-audio", "play-video"].includes(command) && !/^https?:\/\//i.test(value)) {
    [match] = await search(value, 1);
    if (!match) throw new Error("Nenhum vídeo encontrado para esta pesquisa.");
    source = match.url;
  }

  if (["play-audio", "tik-tok-audio", "yt-mp3"].includes(command)) {
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

export async function handlePendingResolution({ chatId, text, sendReply, sendVideoFromFile }) {
  const value = String(text || "").trim();
  if (!/^[1-5]$/.test(value)) return false;
  const pending = takePendingResolution(chatId, value);
  if (!pending) return false;
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
}

export function resolutionMenu() {
  return "Qual resolução você quer?\n1. 360p\n2. 480p\n3. 720p (recomendado)\n4. 1080p\n5. Best\nResponda com o número";
}
