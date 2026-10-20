import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const TMP_DIR = path.join(ROOT_DIR, "tmp");

// Binários falsos: nenhum teste aqui toca na rede nem num ffmpeg real.
const fakeDir = path.join(TMP_DIR, `fake-ffmpeg-${randomUUID()}`);
const fakeFfmpeg = path.join(fakeDir, "ffmpeg");
const fakeFfprobe = path.join(fakeDir, "ffprobe");
const argsLog = path.join(fakeDir, "args.log");

const fakeFfmpegSource = `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
if (process.env.FAKE_FFMPEG_LOG) {
  fs.appendFileSync(process.env.FAKE_FFMPEG_LOG, JSON.stringify({ bin: "ffmpeg", args }) + "\\n");
}
if (args.includes("-version")) { console.log("ffmpeg version 7.1.5"); process.exit(0); }
// Redução: o último argumento é o ficheiro de saída.
const output = args.at(-1);
fs.writeFileSync(output, Buffer.alloc(64, 98));
`;

const fakeFfprobeSource = `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
if (process.env.FAKE_FFMPEG_LOG) {
  fs.appendFileSync(process.env.FAKE_FFMPEG_LOG, JSON.stringify({ bin: "ffprobe", args }) + "\\n");
}
const input = args.at(-1);
// Altura simulada pelo nome: "...-720p.mp4" → 720; senão 1080.
const altura = /-(\\d+)p\\./.exec(input)?.[1] || "1080";
console.log(JSON.stringify({ streams: [{ height: Number(altura) }] }));
`;

process.env.FFMPEG_PATH = fakeFfmpeg;
process.env.FAKE_FFMPEG_LOG = argsLog;

await mkdir(fakeDir, { recursive: true });
await writeFile(fakeFfmpeg, fakeFfmpegSource);
await writeFile(fakeFfprobe, fakeFfprobeSource);
await chmod(fakeFfmpeg, 0o755);
await chmod(fakeFfprobe, 0o755);

const {
  buildDownscaleArgs,
  buildProbeArgs,
  downscaleVideo,
  isFfmpegAvailable,
  parseProbeHeight,
  probeVideoHeight,
  resolveFfmpegBinary,
} = await import("../services/videoDownscale.js");

after(async () => {
  await rm(fakeDir, { recursive: true, force: true });
});

test("ffmpeg é detectado pelo FFMPEG_PATH", async () => {
  assert.equal(await resolveFfmpegBinary(), fakeFfmpeg);
  assert.equal(await isFfmpegAvailable(), true);
});

test("parseProbeHeight lê a altura do JSON do ffprobe", () => {
  assert.equal(parseProbeHeight('{"streams":[{"height":1080}]}'), 1080);
  assert.equal(parseProbeHeight('{"streams":[{"height":480}]}'), 480);
});

test("parseProbeHeight devolve null em JSON inválido ou sem streams", () => {
  assert.equal(parseProbeHeight("não é json"), null);
  assert.equal(parseProbeHeight('{"streams":[]}'), null);
  assert.equal(parseProbeHeight(""), null);
  assert.equal(parseProbeHeight(undefined), null);
});

test("buildProbeArgs pede só a altura do primeiro stream de vídeo", () => {
  const args = buildProbeArgs("/tmp/video.mp4");

  assert.deepEqual(args.slice(0, 2), ["-v", "error"]);
  assert.ok(args.includes("-show_entries"));
  assert.equal(args[args.indexOf("-select_streams") + 1], "v:0");
  assert.equal(args.at(-1), "/tmp/video.mp4");
});

test("buildDownscaleArgs reduz para a altura pedida com escala proporcional", () => {
  const args = buildDownscaleArgs("/tmp/in.mp4", "/tmp/out.mp4", 480);

  assert.equal(args[args.indexOf("-vf") + 1], "scale=-2:480");
  assert.equal(args[args.indexOf("-preset") + 1], "veryfast");
  assert.equal(args[args.indexOf("-crf") + 1], "28");
  assert.equal(args.at(-1), "/tmp/out.mp4");
});

test("probeVideoHeight lê a altura real do ficheiro", async () => {
  const ficheiro = path.join(fakeDir, "episodio-720p.mp4");
  await writeFile(ficheiro, Buffer.alloc(8));

  assert.equal(await probeVideoHeight(ficheiro), 720);
});

test("downscaleVideo gera o ficheiro em 480p e devolve o caminho novo", async () => {
  const origem = path.join(fakeDir, "episodio.mp4");
  await writeFile(origem, Buffer.alloc(128, 97));

  const saida = await downscaleVideo(origem, 480);

  assert.equal(saida, path.join(fakeDir, "episodio.480p.mp4"));
  assert.equal((await readFile(saida)).length, 64);

  const chamadas = (await readFile(argsLog, "utf8"))
    .trim()
    .split("\n")
    .map((linha) => JSON.parse(linha))
    .filter((entrada) => entrada.bin === "ffmpeg" && !entrada.args.includes("-version"));

  assert.ok(chamadas.some((entrada) => entrada.args.includes("scale=-2:480")));
});
