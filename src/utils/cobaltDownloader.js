import axios from "axios";
import fs from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { DOWNLOAD_TIMEOUT_MS, MAX_FILE_SIZE_BYTES } from "../config.js";

const TEMP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tmp");

function cobaltError(data) {
  const error = data?.error;
  return error?.message || error?.code || (typeof error === "string" ? error : null) ||
    data?.message || "Não foi possível baixar esta mídia pelo Cobalt.";
}

export async function downloadWithCobalt(url, options = {}) {
  let source;
  try {
    source = new URL(url);
    if (!["http:", "https:"].includes(source.protocol)) throw new Error();
  } catch {
    throw new Error("Envie uma URL válida (http ou https) para baixar a mídia.");
  }

  console.log(`Iniciando download com Cobalt para URL: ${source.href}`);
  const apiUrl = process.env.COBALT_API_URL || "https://api.cobalt.tools/api/json";
  const request = { url: source.href };
  if (options.audio) {
    request.downloadMode = "audio";
    request.audioFormat = "mp3";
  } else if (options.height) {
    request.videoQuality = options.height === "best" ? "max" : String(options.height);
  }

  let filePath;
  try {
    const { data } = await axios.post(apiUrl, request, {
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    if (!["stream", "redirect", "tunnel"].includes(data?.status) || !data.url) {
      throw new Error(cobaltError(data));
    }

    const response = await axios.get(data.url, {
      responseType: "stream",
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    if (Number(response.headers["content-length"]) > MAX_FILE_SIZE_BYTES) {
      response.data.destroy();
      throw new Error("O arquivo excede o limite de 100 MB do WhatsApp.");
    }
    // Usamos o tipo do arquivo entregue, não o tipo anunciado pela URL de origem.
    const contentType = String(response.headers["content-type"] || "").split(";")[0].toLowerCase();
    const mediaType = options.audio ? "audio/" : "video/";
    if (contentType && !contentType.startsWith(mediaType) && contentType !== "application/octet-stream") {
      response.data.destroy();
      throw new Error("O Cobalt não retornou um arquivo de mídia compatível com este comando.");
    }
    const mimetype = contentType.startsWith(mediaType)
      ? contentType : options.audio ? "audio/mpeg" : "video/mp4";
    const extension = options.audio ? "mp3" : mimetype === "video/webm" ? "webm" : "mp4";
    await mkdir(TEMP_DIR, { recursive: true });
    filePath = path.join(TEMP_DIR, `cobalt-${randomUUID()}.${extension}`);
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_FILE_SIZE_BYTES) {
          const error = new Error("O arquivo excede o limite de 100 MB do WhatsApp.");
          error.code = "FILE_TOO_LARGE";
          callback(error);
        } else {
          callback(null, chunk);
        }
      },
    });
    await pipeline(response.data, limit, fs.createWriteStream(filePath));
    console.log("Download concluído, enviando...");
    return { filePath, mimetype };
  } catch (error) {
    if (filePath) await rm(filePath, { force: true });
    const message = error.response?.data && typeof error.response.data !== "object"
      ? error.message
      : error.response?.data ? cobaltError(error.response.data) : error.message;
    throw new Error(message, { cause: error });
  }
}
