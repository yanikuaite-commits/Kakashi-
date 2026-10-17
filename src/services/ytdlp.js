/** ws https://upstash.com/docs/redis/using-sdk/com "
 * Serviço de download via yt-dlp (CLI).
 *
 * Por que existe:
 * - o Render (e qualquer host em nuvem) bloqueia/limita as APIs de download
 *   terceiras; o yt-dlp roda dentro do próprio container e cobre YouTube,
 *   TikTok, Instagram, Facebook, X, Pinterest e mais de 1000 sites;
 * - o yt-dlp devolve a duração real da mídia, o que deixa o custo de
 *   créditos preciso (mídia longa gasta mais).
 *
 * Quando o binário não existe (Termux, ambiente de testes, etc.) os serviços
 * que usam este módulo caem no fallback da API GenDownload.
 *
 * Instalação do binário:
 * - Docker/Render: veja o Dockerfile (yt-dlp_linux, sem Python);
 * - outros hosts: `npm run setup:ytdlp` (salva em `bin/yt-dlp`);
 * - Termux: `pkg install yt-dlp` e/ou defina `YTDLP_PATH`.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_FILE_SIZE_BYTES,
  YTDLP_COOKIES_PATH,
  YTDLP_ENABLED,
  YTDLP_EXTRACTOR_ARGS,
  YTDLP_IMPERSONATE,
  YTDLP_JS_RUNTIME,
  YTDLP_PATH,
  YTDLP_PROXY,
  YTDLP_TIMEOUT_MS,
} from "../config.js";
import { infoLog, warningLog } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DOWNLOAD_DIR = path.resolve(ROOT_DIR, "tmp");
const MAX_BUFFER = 32 * 1024 * 1024;

const BOT_CHECK_HINT =
  "O YouTube está pedindo confirmação de que não é um robô (comum em IP de " +
  "datacenter, como o do Render). Configure YTDLP_COOKIES_PATH apontando para um " +
  "arquivo de cookies ou YTDLP_PROXY com um proxy residencial.";

const UNSUPPORTED_URL_HINT =
  "O yt-dlp não reconhece este link. Posts de fotos/carrossel (TikTok, " +
  "Instagram, Facebook) não têm vídeo para baixar — reenvie o link de um vídeo.";

const INSTAGRAM_HINT =
  "O Instagram não liberou este post para o servidor: fotos/carrossel e posts " +
  "restritos exigem login. Reenvie o link de um reel ou vídeo público; se " +
  "continuar, configure YTDLP_COOKIES_PATH com cookies de uma conta que veja o " +
  "post.";

let binaryPromise;

function binaryCandidates() {
  return [YTDLP_PATH, path.join(ROOT_DIR, "bin", "yt-dlp"), "yt-dlp"].filter(
    Boolean,
  );
}

function runBinary(binary, args, options = {}) {
  const { timeout = YTDLP_TIMEOUT_MS, maxBuffer = MAX_BUFFER } = options;

  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, maxBuffer, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

/** Resolver automaticamente o cookies.txt da raiz do projeto quando não
 * há YTDLP_COOKIES_PATH configurado e o ficheiro existir.
 */
function resolveAutoCookiesPath() {
  if (YTDLP_COOKIES_PATH) {
    return YTDLP_COOKIES_PATH;
  }

  if (!fs.existsSync(ROOT_DIR)) {
    return null;
  }

  const candidates = [
    path.resolve(ROOT_DIR, "cookies.txt"),
    path.resolve(ROOT_DIR, "cookies", "cookies.txt"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** Caminho do binário em uso (ou null quando indisponível). O resultado é
 * memorizado: a checagem roda uma única vez por processo.
 */
export async function resolveYtDlpBinary() {
  if (!YTDLP_ENABLED) {
    return null;
  }

  if (!binaryPromise) {
    binaryPromise = (async () => {
      for (const candidate of binaryCandidates()) {
        if (candidate.includes(path.sep) && !fs.existsSync(candidate)) {
          continue;
        }

        try {
          const { stdout } = await runBinary(candidate, ["--version"], {
            timeout: 20 * 1000,
          });
          const version = stdout.trim().split("\n").filter(Boolean).at(-1);

          infoLog(`yt-dlp disponível: ${candidate} (versão ${version})`);

          return candidate;
        } catch {
          // Tenta o próximo candidato.
        }
      }

      warningLog(
        "yt-dlp não encontrado. Os downloads usam a API GenDownload (fallback).",
      );

      return null;
    })();
  }

  return binaryPromise;
}

export async function isYtDlpAvailable() {
  return Boolean(await resolveYtDlpBinary());
}

function commonArgs() {
  const args = ["--no-playlist", "--no-warnings", "--no-progress"];

  const cookiesPath = resolveAutoCookiesPath();
  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  if (YTDLP_PROXY) {
    args.push("--proxy", YTDLP_PROXY);
  }

  if (YTDLP_IMPERSONATE) {
    args.push("--impersonate", YTDLP_IMPERSONATE);
  }

  if (YTDLP_EXTRACTOR_ARGS) {
    args.push("--extractor-args", YTDLP_EXTRACTOR_ARGS);
  }

  if (YTDLP_JS_RUNTIME) {
    args.push("--js-runtimes", YTDLP_JS_RUNTIME);
  }

  return args;
}

function normalizeInfo(info) {
  return {
    title: info?.title || "Mídia",
    artist: info?.uploader || info?.channel || info?.creator || "Artista desconhecido",
    duration: Number(info?.duration) || 0,
    filesize: Number(info?.filesize) || Number(info?.filesize_approx) || 0,
    thumbnail: info?.thumbnail || null,
  };
}

/** Metadados da mídia (duração, título, autor e capa) sem baixar o arquivo. */
export async function getMediaInfo(url) {
  const binary = await resolveYtDlpBinary();

  if (!binary) {
    return null;
  }

  const { stdout } = await runBinary(
    binary,
    ["--dump-single-json", "--skip-download", ...commonArgs(), url],
    { timeout: 60 * 1000 },
  );

  return normalizeInfo(JSON.parse(stdout));
}

/** 
 * Determina o seletor de formatos do yt-dlp.
 *
 * O vídeo retrato (9:16) é o caso que falhava: o TikTok entrega 720x1280 e o
 * yt-dlp chama de `height` o lado vertical (1280), então filtrar apenas por
 * `[height<=720]` não casava com formato nenhum e o download terminava em
 * "Requested format is not available". Por isso o filtro por `width` também é
 * tentado, e as duas últimas alternativas ignoram o limite: melhor entregar
 * uma resolução maior que falhar.
 *
 * @param {number|string} [height] limite desejado (ex: 720) ou "best"
 * @returns {string} seletor para o argumento -f do yt-dlp
 */
export function buildFormatSelector(height) {
  const limit = Number(height);
  const hasLimit =
    Boolean(height) && height !== "best" && Number.isFinite(limit);

  // Sem limite ("best", vazio ou valor inválido) o seletor é o de sempre.
  if (!hasLimit) {
    return ["bv*[ext=mp4]+ba[ext=m4a]", "bv*+ba", "b[ext=mp4]", "b"].join(
      "/",
    );
  }

  const byHeight = `[height<=${limit}]`;
  const byWidth = `[width<=${limit}]`;

  return [
    `bv*[ext=mp4]${byHeight}+ba[ext=m4a]`,
    `bv*${byHeight}+ba`,
    `b[ext=mp4]${byHeight}`,
    `b${byHeight}`,
    `bv*[ext=mp4]${byWidth}+ba[ext=m4a]`,
    `bv*${byWidth}+ba`,
    `b[ext=mp4]${byWidth}`,
    `b${byWidth}`,
    "b[ext=mp4]",
    "b",
  ].join("/");
}

function buildFileName(title, artist, extension) {
  const base = `${title || "Mídia"} - ${artist || "Artista desconhecido"}`;

  return `${base.replace(/[\\/:*?\"<>|]/g, "_").slice(0, 170)}.${extension}`;
}

/** 
 * Traduz o erro cru do yt-dlp em uma mensagem útil para o log e para o grupo.
 *
 * @param {{ stderr?: string, message?: string }} error
 * @returns {string}
 */
export function friendlyError(error) {
  const detail =
    String(error?.stderr || error?.message || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) || "falha ao rodar o yt-dlp";
  const message = detail.replace(/^ERROR:\s*/i, "");

  // Antes do teste de "bot": o link pode conter "bot" em algum parâmetro.
  if (/unsupported url/i.test(message)) {
    return `yt-dlp: ${message}\n\n${UNSUPPORTED_URL_HINT}`;
  }

  // O Instagram responde com um texto enorme (inclusive o template de issue do
  // yt-dlp); aqui vira uma orientação curta.
  if (
    /\[Instagram\]/i.test(message) &&
    /empty media response|login required|rate-?limit|not available/i.test(message)
  ) {
    return `yt-dlp: o post do Instagram não pôde ser lido.\n\n${INSTAGRAM_HINT}`;
  }

  if (/sign in to confirm|bot/i.test(message)) {
    return `yt-dlp: ${message}\n\n${BOT_CHECK_HINT}`;
  }

  return `yt-dlp: ${message}`;
}

async function removeFilesByPrefix(prefix) {
  const entries = await readdir(DOWNLOAD_DIR).catch(() => []);

  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix))
      .map((name) => rm(path.join(DOWNLOAD_DIR, name), { force: true })),
  );
}

async function pickOutputPath(stdout, id) {
  const lines = String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.reverse()) {
    if (!line.includes(id)) {
      continue;
    }

    const exists = await stat(line).then(() => true).catch(() => false);

    if (exists) {
      return line;
    }
  }

  const entries = await readdir(DOWNLOAD_DIR).catch(() => []);
  const match = entries
    .filter((name) => name.startsWith(`${id}.`) && !name.endsWith(".part"))
    .sort();

  if (!match.length) {
    throw new Error("o yt-dlp não informou o arquivo baixado.");
  }

  return path.resolve(DOWNLOAD_DIR, match.at(-1));
}

/** 
 * Baixa a mídia com o yt-dlp.
 *
 * @param {string} url
 * @param {{ audio?: boolean, height?: number|string }} options
 * @returns {Promise<{ filePath: string, mimetype: string, fileName: string,
 *   title: string, artist: string, thumbnail: string|null, fileSize: number,
 *   duration: number }>}
 */
export async function downloadWithYtDlp(url, { audio = false, height } = {}) {
  const binary = await resolveYtDlpBinary();

  if (!binary) {
    throw new Error("yt-dlp não está disponível neste ambiente.");
  }

  await mkdir(DOWNLOAD_DIR, { recursive: true });

  const id = `ytdlp-${randomUUID()}`;
  const template = path.join(DOWNLOAD_DIR, `${id}.%(ext)s`);
  // Os metadados são opcionais: sem eles o download continua, só o custo por
  // duração perde precisão.
  const info = await getMediaInfo(url).catch(() => null);

  const args = [
    ...commonArgs(),
    "--max-filesize",
    String(MAX_FILE_SIZE_BYTES),
    "-o",
    template,
    "--print",
    "after_move:filepath",
  ];

  if (audio) {
    // MP3 sai com tags ID3 (título, artista e capa embutidas) para os
    // metadados aparecerem em qualquer player, não só na legenda do chat.
    // Falhar em embutir não derruba o download (era o comportamento sem as
    // flags): o yt-dlp só loga um aviso quando a capa não está disponível.
    args.push(
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--embed-metadata",
      "--embed-thumbnail",
    );
  } else {
    args.push("--merge-output-format", "mp4", "-N", "4", "-f", buildFormatSelector(height));
  }

  args.push(url);

  try {
    const { stdout } = await runBinary(binary, args);
    const filePath = await pickOutputPath(stdout, id);
    const { size } = await stat(filePath);

    if (size > MAX_FILE_SIZE_BYTES) {
      throw new Error("O arquivo excede o limite de 100 MB do WhatsApp.");
    }

    const extension = path.extname(filePath).slice(1).toLowerCase();
    const mimetype = audio || extension === "mp3"
      ? "audio/mpeg"
      : extension === "m4a"
        ? "audio/mp4"
        : "video/mp4";

    return {
      filePath,
      mimetype,
      fileName: buildFileName(info?.title, info?.artist, extension),
      title: info?.title || "Mídia",
      artist: info?.artist || "Artista desconhecido",
      thumbnail: info?.thumbnail || null,
      fileSize: size,
      duration: info?.duration || 0,
    };
  } catch (error) {
    await removeFilesByPrefix(id);

    if (error.message?.includes("100 MB")) {
      throw error;
    }

    throw new Error(friendlyError(error), { cause: error });
  }
}
