import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
  firstAtoms,
  hasFaststart,
  needsH264Transcode,
  prepareImageForWhatsApp,
  prepareVideoForWhatsApp,
  withPreparedVideo,
} from "../services/mediaPrepare.js";

/**
 * Os testes de conversão precisam de ffmpeg/ffprobe. Sem eles, correm só as
 * funções puras: um teste que "passa" por a ferramenta faltar esconderia a
 * regressão.
 */
function hasBinary(name) {
  try {
    execFileSync(name, ["-version"], { stdio: "ignore" });

    return true;
  } catch {
    return false;
  }
}

const TEM_FFMPEG = hasBinary("ffmpeg");

/** Constrói um MP4 sintético com a ordem de átomos e o codec pedidos. */
function makeVideo({ codec = "libx264", faststart = false, dir } = {}) {
  const output = path.join(dir, `${codec}-${faststart ? "fs" : "nf"}.mp4`);
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x120:rate=10",
    "-t",
    "1",
    "-c:v",
    codec,
  ];

  if (codec === "libaom-av1") args.push("-cpu-used", "8");
  if (codec === "libx264") args.push("-pix_fmt", "yuv420p");
  if (faststart) args.push("-movflags", "+faststart");
  args.push(output);

  execFileSync("ffmpeg", args, { stdio: "ignore" });

  return output;
}

function head(filePath) {
  return fs.readFileSync(filePath).subarray(0, 64);
}

function codecOf(filePath) {
  try {
    return execFileSync(
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
      { encoding: "utf8" },
    ).trim();
  } catch {
    // Sem ffprobe (comum em imagens slim) resta o `ffmpeg -i`, que escreve a
    // informação no stderr e sai com código != 0.
  }

  try {
    execFileSync("ffmpeg", ["-hide_banner", "-i", filePath], { stdio: "pipe" });
  } catch (error) {
    const texto = `${error.stderr || ""}${error.stdout || ""}`;

    return texto.match(/Video:\s*([a-z0-9_]+)/i)?.[1] || null;
  }

  return null;
}

test("firstAtoms lista os átomos de topo do ficheiro", () => {
  // ftyp (16 bytes) + moov (8 bytes declarados) + mdat
  const buffer = Buffer.alloc(32);

  buffer.writeUInt32BE(16, 0);
  buffer.write("ftyp", 4);
  buffer.writeUInt32BE(8, 16);
  buffer.write("moov", 20);
  buffer.writeUInt32BE(8, 24);
  buffer.write("mdat", 28);

  assert.deepEqual(firstAtoms(buffer), ["ftyp", "moov", "mdat"]);
});

test("firstAtoms para num tamanho inválido em vez de ciclar", () => {
  const buffer = Buffer.alloc(16);

  buffer.writeUInt32BE(4, 0); // < 8: inválido
  buffer.write("ftyp", 4);

  assert.deepEqual(firstAtoms(buffer), ["ftyp"]);
});

test("hasFaststart exige o moov antes do mdat", () => {
  const build = (...types) => {
    const buffer = Buffer.alloc(types.length * 8 + 8);
    let offset = 0;

    for (const type of types) {
      buffer.writeUInt32BE(8, offset);
      buffer.write(type, offset + 4);
      offset += 8;
    }

    return buffer;
  };

  assert.equal(hasFaststart(build("ftyp", "moov", "mdat")), true);
  assert.equal(hasFaststart(build("ftyp", "free", "mdat", "moov")), false);
  // Sem mdat o moov só pode estar no início: é reproduzível.
  assert.equal(hasFaststart(build("ftyp", "moov")), true);
  assert.equal(hasFaststart(build("ftyp", "mdat")), false);
});

test("needsH264Transcode aceita h264/avc1 e recusa os restantes", () => {
  assert.equal(needsH264Transcode("h264"), false);
  assert.equal(needsH264Transcode("H264"), false);
  assert.equal(needsH264Transcode("avc1"), false);

  for (const codec of ["av1", "av01", "vp9", "vp09", "hevc", "mpeg4", null, ""]) {
    assert.equal(needsH264Transcode(codec), true, `${codec} devia exigir transcode`);
  }
});

test("url não-WebP passa intacta, sem download", async () => {
  const url = "https://exemplo.test/capa.jpg";
  const resultado = await prepareImageForWhatsApp(url);

  assert.equal(resultado.image, url);
  assert.equal(resultado.temporary, false);
  assert.deepEqual(await prepareImageForWhatsApp(null), {
    image: null,
    temporary: false,
  });
});

test(
  "H.264 sem faststart é remuxado e fica reproduzível",
  { skip: !TEM_FFMPEG },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prep-"));

    try {
      const original = makeVideo({ dir, faststart: false });

      assert.equal(hasFaststart(head(original)), false, "pré-condição do teste");

      const resultado = await prepareVideoForWhatsApp(original);

      assert.equal(resultado.action, "remux");
      assert.equal(resultado.temporary, true);
      assert.equal(hasFaststart(head(resultado.filePath)), true);
      // Remux copia os streams: o codec não muda.
      assert.equal(codecOf(resultado.filePath), "h264");

      fs.rmSync(resultado.filePath, { force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "H.264 já com faststart não é tocado",
  { skip: !TEM_FFMPEG },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prep-"));

    try {
      const original = makeVideo({ dir, faststart: true });
      const resultado = await prepareVideoForWhatsApp(original);

      assert.equal(resultado.action, "skip");
      assert.equal(resultado.temporary, false);
      assert.equal(resultado.filePath, original);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "AV1 é reconvertido para H.264",
  { skip: !TEM_FFMPEG },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prep-"));

    try {
      const original = makeVideo({ codec: "libaom-av1", dir });

      assert.equal(codecOf(original), "av1", "pré-condição do teste");

      const resultado = await prepareVideoForWhatsApp(original);

      assert.equal(resultado.action, "transcode");
      assert.equal(resultado.temporary, true);
      assert.equal(codecOf(resultado.filePath), "h264");
      assert.equal(hasFaststart(head(resultado.filePath)), true);

      fs.rmSync(resultado.filePath, { force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "ficheiro ilegível devolve o original em vez de rebentar",
  { skip: !TEM_FFMPEG },
  async () => {
    const resultado = await prepareVideoForWhatsApp(
      path.join(os.tmpdir(), "nao-existe-mesmo.mp4"),
    );

    assert.equal(resultado.action, "skip");
    assert.equal(resultado.temporary, false);
  },
);

test(
  "withPreparedVideo envia o ficheiro preparado e apaga o temporário",
  { skip: !TEM_FFMPEG },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prep-"));

    try {
      const original = makeVideo({ dir, faststart: false });
      let enviado = null;

      await withPreparedVideo(original, async (filePath) => {
        enviado = filePath;
        assert.equal(hasFaststart(head(filePath)), true, "envia já preparado");
      });

      assert.notEqual(enviado, original, "enviou o ficheiro preparado");
      assert.equal(
        fs.existsSync(enviado),
        false,
        "o temporário foi apagado depois do envio",
      );
      // O original pertence ao chamador: não é apagado pelo wrapper.
      assert.equal(fs.existsSync(original), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "withPreparedVideo apaga o temporário mesmo quando o envio falha",
  { skip: !TEM_FFMPEG },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prep-"));

    try {
      const original = makeVideo({ dir, faststart: false });
      let enviado = null;

      await assert.rejects(
        withPreparedVideo(original, async (filePath) => {
          enviado = filePath;
          throw new Error("falha de rede");
        }),
        /falha de rede/,
      );

      assert.equal(
        fs.existsSync(enviado),
        false,
        "sem fuga de ficheiro quando o envio falha",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
