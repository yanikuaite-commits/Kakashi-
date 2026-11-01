/**
 * Preparação de mídia para o WhatsApp.
 *
 * PORQUÊ: um MP4 só toca no WhatsApp se os metadados (`moov`) estiverem ANTES
 * do `mdat`. O yt-dlp entrega o `moov` no FIM (medido: `ftyp`, `free`, `mdat`),
 * o que faz o player responder "vídeo não está disponível" — o ficheiro está
 * intacto, só o índice está no sítio errado. O defeito aparecia apenas nos
 * envios como VÍDEO (≤ 100 MB): acima disso o ficheiro vai como documento, que
 * o WhatsApp só descarrega, e por isso nunca falhava.
 *
 * O segundo problema é o codec: o seletor do yt-dlp filtra o CONTENTOR
 * (`[ext=mp4]`), não o codec, por isso um `av01`/`vp09` dentro de um `.mp4`
 * passa. O WhatsApp só reproduz H.264 (`avc1`).
 *
 * COMO: com H.264 basta um remux (`-c copy`), que reescreve só o contentor em
 * segundos. Com outro codec é preciso reconverter para H.264, mais lento mas
 * inevitável. Sem ffmpeg disponível nada disto corre e a mídia segue como está:
 * a degradação é preferível a falhar o envio.
 *
 * @author Dev Yanik
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TEMP_DIR, VIDEO_FIX_ENABLED, VIDEO_FIX_TIMEOUT_MS } from "../config.js";
import { errorLog, infoLog, warningLog } from "../utils/logger.js";

const CODECS_WHATSAPP = new Set(["h264", "avc1"]);

let ffmpegPromise = null;

function run(binary, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
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

/** Binário do ffmpeg em uso (ou null). Memorizado: corre uma vez por processo. */
export function resolveFfmpegBinary() {
  if (!ffmpegPromise) {
    ffmpegPromise = run("ffmpeg", ["-version"], 20 * 1000)
      .then(() => "ffmpeg")
      .catch(() => {
        warningLog(
          "[media] ffmpeg não encontrado: os vídeos seguem sem remux/transcode",
        );
        return null;
      });
  }

  return ffmpegPromise;
}

/** Lista os primeiros átomos de topo do ficheiro (`ftyp`, `moov`, `mdat`, ...). */
export function firstAtoms(buffer, limit = 4) {
  const atoms = [];
  let offset = 0;

  while (offset + 8 <= buffer.length && atoms.length < limit) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);

    atoms.push(type);

    if (size < 8) {
      break;
    }

    offset += size;
  }

  return atoms;
}

/**
 * `true` quando o índice (`moov`) vem antes dos dados (`mdat`) — o único
 * arranjo que o WhatsApp reproduz em streaming.
 *
 * @param {Buffer} buffer primeiros bytes do ficheiro
 * @returns {boolean}
 */
export function hasFaststart(buffer) {
  const atoms = firstAtoms(buffer, 4);
  const moov = atoms.indexOf("moov");
  const mdat = atoms.indexOf("mdat");

  return moov !== -1 && (mdat === -1 || moov < mdat);
}

/** `true` quando o codec não é reproduzível pelo WhatsApp (ex.: `av01`, `vp09`). */
export function needsH264Transcode(codec) {
  return !CODECS_WHATSAPP.has(String(codec || "").toLowerCase());
}

/** Lê os primeiros bytes do ficheiro para inspecionar os átomos. */
function readHead(filePath, bytes = 64) {
  const fd = fs.openSync(filePath, "r");

  try {
    const buffer = Buffer.alloc(bytes);
    const lidos = fs.readSync(fd, buffer, 0, bytes, 0);

    return buffer.subarray(0, lidos);
  } finally {
    fs.closeSync(fd);
  }
}

/** Codec de vídeo do ficheiro, lido com ffprobe (ou null quando não dá para saber). */
async function probeVideoCodec(filePath, binary) {
  try {
    const { stdout } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name",
        "-of",
        "default=nw=1:nk=1",
        filePath,
      ],
      30 * 1000,
    );

    return stdout.trim().split("\n").filter(Boolean)[0] || null;
  } catch {
    // Sem ffprobe resta o `ffmpeg -i`, que escreve a informação no stderr.
    try {
      const { stderr } = await run(binary, ["-hide_banner", "-i", filePath], 30 * 1000);

      return stderr.match(/Video:\s*([a-z0-9_]+)/i)?.[1] || null;
    } catch (error) {
      // `ffmpeg -i` sai com código != 0 quando só mostra a informação: o
      // stderr que interessa já vem no erro.
      return error.stderr?.match(/Video:\s*([a-z0-9_]+)/i)?.[1] || null;
    }
  }
}

function tempPath(extension) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  return path.join(
    TEMP_DIR,
    `prep-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`,
  );
}

/**
 * Garante que o vídeo toca no WhatsApp: `moov` no início e codec H.264.
 *
 * Devolve o caminho a enviar — o original quando já está bom, ou um ficheiro
 * temporário em `assets/temp` que o chamador deve apagar (`temporary: true`).
 *
 * @param {string} filePath
 * @returns {Promise<{filePath: string, temporary: boolean, action: "skip"|"remux"|"transcode"}>}
 */
export async function prepareVideoForWhatsApp(filePath) {
  const original = { filePath, temporary: false, action: "skip" };

  if (!VIDEO_FIX_ENABLED) {
    return original;
  }

  let head;

  try {
    head = readHead(filePath);
  } catch (error) {
    warningLog(`[media] não consegui ler "${filePath}": ${error.message}`);
    return original;
  }

  // Já está no arranjo certo: não vale a pena tocar. A leitura dos átomos é
  // barata e evita um remux por cada envio de um ficheiro já corrigido.
  const faststart = hasFaststart(head);

  const binary = await resolveFfmpegBinary();

  if (!binary) {
    return original;
  }

  const codec = await probeVideoCodec(filePath, binary);
  const precisaTranscode = needsH264Transcode(codec);

  if (faststart && !precisaTranscode) {
    return original;
  }

  // H.264 com o índice no fim: `-c copy` só reescreve o contentor. Outro codec
  // tem de ser descodificado e recodificado em H.264.
  const output = tempPath("mp4");
  const args = precisaTranscode
    ? [
        "-y",
        "-i",
        filePath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-sn",
        "-dn",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        output,
      ]
    : [
        "-y",
        "-i",
        filePath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-sn",
        "-dn",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        output,
      ];

  const inicio = Date.now();

  try {
    await run(binary, args, VIDEO_FIX_TIMEOUT_MS);
  } catch (error) {
    fs.rmSync(output, { force: true });
    errorLog(
      `[media] ${
        precisaTranscode ? "transcode" : "remux"
      } falhou (${error.message.slice(0, 120)}); a enviar o original`,
    );
    return original;
  }

  // Um remux/transcode que não produz bytes é pior que o original.
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
    fs.rmSync(output, { force: true });
    warningLog("[media] conversão devolveu ficheiro vazio; a enviar o original");
    return original;
  }

  infoLog(
    `[media] ${
      precisaTranscode ? `transcode ${codec || "?"} → h264` : "remux faststart"
    } em ${((Date.now() - inicio) / 1000).toFixed(1)}s`,
  );

  return {
    filePath: output,
    temporary: true,
    action: precisaTranscode ? "transcode" : "remux",
  };
}

/**
 * Envia um vídeo já preparado, garantindo a limpeza do temporário.
 *
 * Evita repetir "prepara, envia, apaga" em cada comando que envia vídeo.
 *
 * @template T
 * @param {string} filePath caminho do vídeo baixado
 * @param {(path: string) => Promise<T>} enviar recebe o caminho pronto a enviar
 * @returns {Promise<T>}
 */
export async function withPreparedVideo(filePath, enviar) {
  const preparado = await prepareVideoForWhatsApp(filePath);

  try {
    return await enviar(preparado.filePath);
  } finally {
    if (preparado.temporary) {
      await fs.promises.rm(preparado.filePath, { force: true }).catch(() => {});
    }
  }
}

/**
 * Torna uma imagem renderizável no WhatsApp.
 *
 * O CDN do Megacine serve só WebP, e a biblioteca que o Baileys usa para gerar
 * a miniatura (jimp) não descodifica WebP: a imagem chega sem miniatura e com
 * um `mimetype` que não corresponde aos bytes. Converter para JPEG resolve os
 * dois. Outros formatos seguem por URL, sem download.
 *
 * @param {string|null} url
 * @returns {Promise<{image: string|null, temporary: boolean}>}
 */
export async function prepareImageForWhatsApp(url) {
  const original = { image: url || null, temporary: false };

  if (!url || !/\.webp(\?|$)/i.test(url)) {
    return original;
  }

  const binary = await resolveFfmpegBinary();

  if (!binary) {
    return original;
  }

  const entrada = tempPath("webp");
  const saida = tempPath("jpg");

  try {
    const resposta = await fetch(url);

    if (!resposta.ok) {
      return original;
    }

    fs.writeFileSync(entrada, Buffer.from(await resposta.arrayBuffer()));
    await run(binary, ["-y", "-i", entrada, "-frames:v", "1", saida], 60 * 1000);

    if (!fs.existsSync(saida) || fs.statSync(saida).size === 0) {
      fs.rmSync(saida, { force: true });
      return original;
    }

    return { image: saida, temporary: true };
  } catch (error) {
    fs.rmSync(saida, { force: true });
    warningLog(`[media] webp → jpeg falhou (${error.message.slice(0, 80)})`);

    return original;
  } finally {
    fs.rmSync(entrada, { force: true });
  }
}
