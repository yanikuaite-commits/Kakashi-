import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_VIDEO_HEIGHT,
  DOWNLOAD_TIMEOUT_MS,
  MAX_FILE_SIZE_BYTES,
  PENDING_DOWNLOAD_TTL_MS,
  TEMP_DIR,
} from "../config.js";

const pendingResolutions = new Map();

function ensureSource(source) {
  const value = String(source || "").trim();
  if (!value) throw new Error("Você precisa informar um link ou termo de busca.");
  return value;
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("O download demorou mais de 5 minutos e foi cancelado."));
    }, DOWNLOAD_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      console.error("yt-dlp:", stderr.trim());
      reject(new Error("Não consegui baixar esta mídia. Verifique o link e tente novamente."));
    });
  });
}

async function runDownload(source, { audio = false, height = DEFAULT_VIDEO_HEIGHT } = {}) {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  let metadata = {};
  if (audio) {
    try {
      const result = await runYtDlp([
        "--no-playlist",
        "--no-warnings",
        "--dump-single-json",
        "--skip-download",
        ensureSource(source),
      ]);
      metadata = JSON.parse(result.stdout.trim());
    } catch (error) {
      console.error("Não foi possível obter metadados do áudio:", error.message);
    }
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const template = path.join(TEMP_DIR, `takeshi-${id}.%(ext)s`);
  const args = ["--no-playlist", "--no-warnings", "--restrict-filenames", "-o", template];

  if (audio) {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else {
    const format = height === "best"
      ? "bv*+ba/b"
      : `bv*[height<=${height}]+ba/b[height<=${height}]/b`;
    args.push("-f", format, "--merge-output-format", "mp4");
  }

  args.push(ensureSource(source));
  await runYtDlp(args);
  const files = (await fs.readdir(TEMP_DIR))
    .filter((file) => file.startsWith(`takeshi-${id}.`))
    .map((file) => path.join(TEMP_DIR, file));
  if (!files.length) throw new Error("O download terminou sem gerar um arquivo.");
  const filePath = files[0];
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    await fs.rm(filePath, { force: true });
    const error = new Error("O arquivo excede o limite de 100 MB do WhatsApp. Tente uma resolução menor ou a versão em áudio.");
    error.code = "FILE_TOO_LARGE";
    throw error;
  }
  const title = metadata.title || "musica";
  const artist = metadata.artist || metadata.creator || metadata.uploader || "Artista desconhecido";
  const safeName = `${title} - ${artist}`.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
  return {
    filePath,
    size: stat.size,
    title,
    artist,
    thumbnail: metadata.thumbnail || null,
    fileName: `${safeName}.mp3`,
  };
}

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
  return runDownload(source, { height });
}

export async function downloadAudio(source) {
  return runDownload(source, { audio: true });
}

export async function downloadSearch(term, type = "video", height = DEFAULT_VIDEO_HEIGHT) {
  const source = `ytsearch1:${ensureSource(term)}`;
  return type === "audio" ? downloadAudio(source) : downloadVideo(source, height);
}

export async function downloadByCommand(command, value) {
  const source = ensureSource(value);
  if (["play-audio", "tik-tok-audio", "yt-mp3"].includes(command)) {
    return downloadAudio(command === "play-audio" ? `ytsearch1:${source}` : source);
  }
  const mediaSource = ["play-video"].includes(command) ? `ytsearch1:${source}` : source;
  return downloadVideo(mediaSource, DEFAULT_VIDEO_HEIGHT);
}

export async function getSearchResult(term) {
  const result = await runYtDlp(["--flat-playlist", "--print", "%(title)s\n%(webpage_url)s\n%(duration_string)s", "ytsearch1:" + ensureSource(term)]);
  const [title = "", url = "", duration = ""] = result.stdout.trim().split(/\r?\n/);
  return { title, url, duration };
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