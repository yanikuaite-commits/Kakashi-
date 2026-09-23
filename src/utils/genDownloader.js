import axios from "axios";
import fs from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { DOWNLOAD_TIMEOUT_MS, MAX_FILE_SIZE_BYTES } from "../config.js";

const TEMP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tmp");

function selectFormat(formats, { audio = false, height } = {}) {
  if (!Array.isArray(formats)) return null;
  if (audio) {
    const audioFormats = formats.filter((format) => format.type === "audio" && format.url);
    return audioFormats.find((format) => format.ext === "mp3") ||
      audioFormats.find((format) => format.ext === "m4a") || null;
  }

  const videos = formats
    .filter((format) => format.type === "video" && format.ext === "mp4" && format.url)
    .sort((first, second) => parseInt(second.label, 10) - parseInt(first.label, 10));
  if (!videos.length) return null;
  const candidates = !height || height === "best"
    ? videos
    : videos.filter((format) => parseInt(format.label, 10) <= height);
  const eligible = candidates.length ? candidates : [videos.at(-1)];
  return eligible.find((format) => !format.filesize || Number(format.filesize) <= MAX_FILE_SIZE_BYTES) || eligible[0];
}

function apiError(data) {
  return data?.error?.message || data?.error?.code ||
    (typeof data?.error === "string" ? data.error : null) ||
    data?.message || "O GenDownload não conseguiu processar este link.";
}

export async function downloadWithGenDownload(url, options = {}) {
  let source;
  try {
    source = new URL(url);
    if (!["http:", "https:"].includes(source.protocol)) throw new Error();
  } catch {
    throw new Error("Envie uma URL válida (http ou https) para baixar a mídia.");
  }

  console.log(`Iniciando download com GenDownload para URL: ${source.href}`);
  let filePath;
  try {
    const { data } = await axios.post(
      process.env.GENDOWNLOAD_API_URL || "https://gendownload.com/api/extract",
      { url: source.href },
      {
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        timeout: DOWNLOAD_TIMEOUT_MS,
      },
    );
    const format = selectFormat(data?.formats, options);
    if (!format) throw new Error(data?.error ? apiError(data) : "Nenhum formato de mídia compatível foi encontrado para este link.");
    if (Number(format.filesize) > MAX_FILE_SIZE_BYTES) {
      throw new Error("O arquivo excede o limite de 100 MB do WhatsApp.");
    }

    const extension = format.ext;
    const mimetype = extension === "mp3" ? "audio/mpeg" : extension === "m4a" ? "audio/mp4" : "video/mp4";
    const response = await axios.get(format.url, { responseType: "stream", timeout: DOWNLOAD_TIMEOUT_MS });
    if (Number(response.headers["content-length"]) > MAX_FILE_SIZE_BYTES) {
      response.data.destroy();
      throw new Error("O arquivo excede o limite de 100 MB do WhatsApp.");
    }
    const contentType = String(response.headers["content-type"] || "").split(";")[0].toLowerCase();
    const expectedType = options.audio ? "audio/" : "video/";
    if (contentType && !contentType.startsWith(expectedType) && contentType !== "application/octet-stream") {
      response.data.destroy();
      throw new Error("O GenDownload não retornou um arquivo de mídia compatível com este comando.");
    }

    await mkdir(TEMP_DIR, { recursive: true });
    filePath = path.join(TEMP_DIR, `gendownload-${randomUUID()}.${extension}`);
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_FILE_SIZE_BYTES) {
          callback(new Error("O arquivo excede o limite de 100 MB do WhatsApp."));
        } else {
          callback(null, chunk);
        }
      },
    });
    await pipeline(response.data, limit, fs.createWriteStream(filePath));
    console.log("Download concluído, enviando...");
    const title = data.title || "Mídia";
    const artist = data.author || "Artista desconhecido";
    const fileName = `${title} - ${artist}`.replace(/[\\/:*?"<>|]/g, "_").slice(0, 170) + `.${extension}`;
    return { filePath, mimetype, fileName, title, artist, thumbnail: data.thumbnail || null };
  } catch (error) {
    if (filePath) await rm(filePath, { force: true });
    const details = error.response?.data;
    throw new Error(details && typeof details === "object" ? apiError(details) : error.message, { cause: error });
  }
}
