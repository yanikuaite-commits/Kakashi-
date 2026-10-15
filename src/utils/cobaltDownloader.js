import axios from "axios";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { MAX_FILE_SIZE_BYTES } from "../config.js";

const COBALT_API_URL = process.env.COBALT_API_URL;

function getApiErrorMessage(data, fallback) {
  const message =
    data?.error?.message ||
    data?.error?.code ||
    data?.message ||
    data?.text ||
    data?.error;
  return typeof message === "string" ? message : fallback;
}

export async function downloadWithCobalt(url) {
  if (!COBALT_API_URL) {
    throw new Error(
      "Configure COBALT_API_URL com uma instância Cobalt que você tem autorização para usar.",
    );
  }

  const parsedUrl = new URL(url);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("A URL precisa usar HTTP ou HTTPS.");
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (process.env.COBALT_API_KEY) {
    headers.Authorization = `Api-Key ${process.env.COBALT_API_KEY}`;
  }

  let cobaltResponse;
  try {
    cobaltResponse = await axios.post(
      COBALT_API_URL,
      { url },
      { headers, timeout: 120_000 },
    );
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error.response?.data, error.message),
      { cause: error },
    );
  }

  const result = cobaltResponse.data;
  if (result?.status === "error") {
    throw new Error(
      getApiErrorMessage(result, "A API do Cobalt retornou um erro."),
    );
  }
  if (!["tunnel", "redirect"].includes(result?.status) || !result.url) {
    throw new Error(
      getApiErrorMessage(result, "A API do Cobalt não retornou um vídeo válido."),
    );
  }

  const temporaryDirectory = path.join(os.tmpdir(), "kakashi-cobalt");
  await mkdir(temporaryDirectory, { recursive: true });

  const extension = path.extname(new URL(result.url).pathname).toLowerCase();
  const safeExtension = /^\.(mp4|webm|mov|m4v)$/.test(extension)
    ? extension
    : ".mp4";
  const filePath = path.join(
    temporaryDirectory,
    `cobalt-${randomUUID()}${safeExtension}`,
  );

  try {
    const videoResponse = await axios.get(result.url, {
      responseType: "stream",
      timeout: 120_000,
    });
    await pipeline(videoResponse.data, createWriteStream(filePath));
    const fileSize = (await stat(filePath)).size;
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      const error = new Error(
        "O arquivo excede o limite de 100 MB do WhatsApp.",
      );
      error.code = "FILE_TOO_LARGE";
      throw error;
    }

    return {
      filePath,
      size: fileSize,
      mimetype:
        videoResponse.headers["content-type"]?.split(";")[0] || "video/mp4",
    };
  } catch (error) {
    await rm(filePath, { force: true });
    throw new Error(getApiErrorMessage(error.response?.data, error.message), {
      cause: error,
    });
  }
}