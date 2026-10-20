/**
 * Redução de resolução de vídeo com ffmpeg (downscale).
 *
 * PORQUÊ EXISTE: alguns providers de animes (o `anikoto`, o único que responde a
 * IPs de datacenter) publicam no master.m3u8 **uma única variante**, em 1080p.
 * Não há 480p para escolher, por isso o seletor do yt-dlp não encontra nenhum
 * formato abaixo do limite, cai na última alternativa (o melhor disponível) e
 * baixa 1080p — ~350 MB por episódio, acima do teto de 200 MB.
 *
 * Também não resolve baixar menos: o `--max-filesize` do yt-dlp é ignorado em
 * HLS (comprovado: com `--max-filesize 100M` o download chegou a 352 MB). A
 * única forma de entregar 480p é baixar o que existe e reduzir localmente.
 *
 * O ffmpeg é instalado pelo `Dockerfile` (imagem oficial). Quando falta, quem
 * chama decide o que fazer — aqui devolvemos `null`/erro em vez de rebentar.
 *
 * @author Dev Gui
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FFMPEG_PATH, FFMPEG_TIMEOUT_MS } from "../config.js";
import { infoLog, warningLog } from "../utils/logger.js";

const MAX_BUFFER = 8 * 1024 * 1024;

let binaryPromise;

function runBinary(binary, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout, maxBuffer: MAX_BUFFER, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

/** Caminho do ffmpeg (memorizado). `null` quando não existe no host. */
export async function resolveFfmpegBinary() {
  if (!binaryPromise) {
    binaryPromise = (async () => {
      for (const candidato of [FFMPEG_PATH, "ffmpeg"].filter(Boolean)) {
        if (candidato.includes(path.sep) && !fs.existsSync(candidato)) continue;

        try {
          await runBinary(candidato, ["-version"], 20 * 1000);
          infoLog(`ffmpeg disponível: ${candidato}`);
          return candidato;
        } catch {
          // Tenta o próximo candidato.
        }
      }

      warningLog(
        "ffmpeg não encontrado; não é possível reduzir a resolução dos animes.",
      );

      return null;
    })();
  }

  return binaryPromise;
}

export async function isFfmpegAvailable() {
  return Boolean(await resolveFfmpegBinary());
}

/** Argumentos do ffprobe para ler a altura do primeiro stream de vídeo. */
export function buildProbeArgs(inputPath) {
  return [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=height",
    "-of",
    "json",
    inputPath,
  ];
}

/**
 * Altura do vídeo a partir da saída JSON do ffprobe.
 *
 * @param {string} stdout
 * @returns {number|null}
 */
export function parseProbeHeight(stdout) {
  try {
    const altura = Number(JSON.parse(String(stdout || ""))?.streams?.[0]?.height);
    return Number.isFinite(altura) && altura > 0 ? altura : null;
  } catch {
    return null;
  }
}

/**
 * Argumentos do ffmpeg para reduzir o vídeo a `height` (largura automática).
 *
 * `-2` na largura mantém a proporção com um valor par (o H.264 exige dimensões
 * pares). `veryfast` + `crf 28` é o compromisso usado na validação manual:
 * 1080p→480p de um episódio de 24 min dá ~70 MB, dentro do teto de 200 MB.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} height
 * @returns {string[]}
 */
export function buildDownscaleArgs(inputPath, outputPath, height) {
  return [
    "-y",
    "-nostdin",
    "-i",
    inputPath,
    "-vf",
    `scale=-2:${height}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

/**
 * Altura do vídeo em `filePath`, ou `null` se o ffprobe não puder ser usado.
 *
 * @param {string} filePath
 * @returns {Promise<number|null>}
 */
export async function probeVideoHeight(filePath) {
  const binary = await resolveFfmpegBinary();
  if (!binary) return null;

  const ffprobe = binary.replace(/ffmpeg$/, "ffprobe");

  try {
    const { stdout } = await runBinary(ffprobe, buildProbeArgs(filePath), 30 * 1000);
    return parseProbeHeight(stdout);
  } catch {
    return null;
  }
}

/**
 * Reduz o vídeo para `height`, devolvendo o caminho do novo ficheiro.
 *
 * O ficheiro de origem NÃO é apagado aqui: quem chama decide quando (o download
 * ainda pode precisar dele se a redução falhar).
 *
 * @param {string} filePath
 * @param {number} height
 * @returns {Promise<string>}
 */
export async function downscaleVideo(filePath, height) {
  const binary = await resolveFfmpegBinary();
  if (!binary) throw new Error("ffmpeg não está disponível neste servidor.");

  const ext = path.extname(filePath) || ".mp4";
  const outputPath = `${filePath.slice(0, -ext.length)}.${height}p${ext}`;

  await runBinary(binary, buildDownscaleArgs(filePath, outputPath, height), FFMPEG_TIMEOUT_MS);

  return outputPath;
}
