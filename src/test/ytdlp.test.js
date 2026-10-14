import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const TMP_DIR = path.join(ROOT_DIR, "tmp");
const creditsFile = path.join(ROOT_DIR, "database", "credits.json");

// O binário é falso: nenhum teste aqui acessa a internet.
const fakeDir = path.join(TMP_DIR, `fake-ytdlp-${randomUUID()}`);
const fakeBinary = path.join(fakeDir, "yt-dlp");
const cookiesFile = path.join(fakeDir, "cookies.txt");
const argsLog = path.join(fakeDir, "args.log");

const fakeSource = `#!/usr/bin/env node
import fs from "node:fs";

const args = process.argv.slice(2);
const url = args.at(-1) || "";

if (process.env.FAKE_YTDLP_LOG) {
  fs.appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(args) + "\\n");
}

if (args.includes("--version")) {
  console.log("2026.08.19");
  process.exit(0);
}

if (url.includes("bot-check")) {
  process.stderr.write("ERROR: Sign in to confirm you're not a bot. Use --cookies.\\n");
  process.exit(1);
}

const duration = url.includes("longo") ? 700 : 60;

if (args.includes("--dump-single-json")) {
  console.log(
    JSON.stringify({
      title: "Vídeo de Teste",
      uploader: "Canal de Teste",
      duration,
      thumbnail: "https://exemplo.test/capa.jpg",
      filesize: 1024,
    }),
  );
  process.exit(0);
}

const template = args[args.indexOf("-o") + 1];
const extension = args.includes("-x") ? "mp3" : "mp4";
const filePath = template.replace("%(ext)s", extension);

fs.writeFileSync(filePath, Buffer.alloc(32, 97));
console.log(filePath);
`;

// As variáveis precisam existir antes de qualquer import que leia src/config.js.
process.env.YTDLP_PATH = fakeBinary;
process.env.YTDLP_COOKIES_PATH = cookiesFile;
process.env.YTDLP_PROXY = "http://proxy.exemplo:8080";
process.env.YTDLP_IMPERSONATE = "chrome";
process.env.FAKE_YTDLP_LOG = argsLog;

await mkdir(fakeDir, { recursive: true });
await writeFile(fakeBinary, fakeSource);
await chmod(fakeBinary, 0o755);
await writeFile(cookiesFile, "# Netscape HTTP Cookie File\n");

const {
  downloadWithYtDlp,
  getMediaInfo,
  isYtDlpAvailable,
  resolveYtDlpBinary,
} = await import("../services/ytdlp.js");
const { downloadVideo } = await import("../services/downloader.js");
const { accountBalance, getAccount, withCreditsContext } = await import(
  "../services/credits.js"
);

let previousCreditsFile;

before(async () => {
  previousCreditsFile = await readFile(creditsFile).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
});

after(async () => {
  if (previousCreditsFile === null) {
    await rm(creditsFile, { force: true });
  } else {
    await writeFile(creditsFile, previousCreditsFile);
  }

  // Nenhum arquivo de mídia ou binário falso deve sobrar em tmp/.
  const leftovers = (await readdir(TMP_DIR).catch(() => [])).filter(
    (name) => name.startsWith("ytdlp-") || name === path.basename(fakeDir),
  );

  await Promise.all(
    leftovers.map((name) => rm(path.join(TMP_DIR, name), { recursive: true, force: true })),
  );
});

async function loggedArgs() {
  const raw = await readFile(argsLog, "utf8");

  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("yt-dlp é detectado pelo YTDLP_PATH", async () => {
  assert.equal(await resolveYtDlpBinary(), fakeBinary);
  assert.equal(await isYtDlpAvailable(), true);
});

test("metadados trazem título, autor, duração e capa sem baixar", async () => {
  const info = await getMediaInfo("https://exemplo.test/video-longo");

  assert.equal(info.title, "Vídeo de Teste");
  assert.equal(info.artist, "Canal de Teste");
  assert.equal(info.duration, 700);
  assert.equal(info.thumbnail, "https://exemplo.test/capa.jpg");

  const [args] = (await loggedArgs()).filter((entry) => entry.includes("--dump-single-json"));
  assert.ok(args.includes("--dump-single-json"));
  assert.ok(args.includes("--skip-download"));
  assert.ok(args.includes("--no-playlist"));
  assert.deepEqual(args.slice(args.indexOf("--cookies"), args.indexOf("--cookies") + 2), [
    "--cookies",
    cookiesFile,
  ]);
  assert.deepEqual(args.slice(args.indexOf("--proxy"), args.indexOf("--proxy") + 2), [
    "--proxy",
    "http://proxy.exemplo:8080",
  ]);
  assert.deepEqual(args.slice(args.indexOf("--js-runtimes"), args.indexOf("--js-runtimes") + 2), [
    "--js-runtimes",
    "node",
  ]);
});

test("download de vídeo gera mp4 com limite de altura e arquivo em tmp", async () => {
  const result = await downloadWithYtDlp("https://exemplo.test/video", { height: 480 });

  assert.equal(result.mimetype, "video/mp4");
  assert.equal(result.duration, 60);
  assert.equal(result.title, "Vídeo de Teste");
  assert.equal(result.fileName, "Vídeo de Teste - Canal de Teste.mp4");
  assert.equal(result.fileSize, 32);
  assert.match(result.filePath, /tmp[\\/]ytdlp-/);
  assert.equal((await readFile(result.filePath)).length, 32);

  const args = (await loggedArgs()).at(-1);
  assert.ok(args.includes("--max-filesize"));
  assert.ok(args.includes("--print") && args.includes("after_move:filepath"));
  assert.ok(args.includes("--merge-output-format") && args.includes("mp4"));
  assert.ok(args.includes("--impersonate") && args.includes("chrome"));
  assert.ok(!args.includes("-x"));
  assert.match(args[args.indexOf("-f") + 1], /height<=480/);
  assert.ok(args[args.indexOf("-o") + 1].startsWith(TMP_DIR));
  assert.equal(args.at(-1), "https://exemplo.test/video");

  await rm(result.filePath, { force: true });
});

test("download de áudio extrai mp3", async () => {
  const result = await downloadWithYtDlp("https://exemplo.test/video", { audio: true });

  assert.equal(result.mimetype, "audio/mpeg");
  assert.match(result.fileName, /\.mp3$/);
  assert.match(result.filePath, /\.mp3$/);

  const args = (await loggedArgs()).at(-1);
  assert.ok(args.includes("-x"));
  assert.deepEqual(args.slice(args.indexOf("--audio-format"), args.indexOf("--audio-format") + 2), [
    "--audio-format",
    "mp3",
  ]);
  assert.ok(!args.includes("--merge-output-format"));

  await rm(result.filePath, { force: true });
});

test("bloqueio do YouTube explica cookies/proxy e não deixa arquivo para trás", async () => {
  await assert.rejects(
    downloadWithYtDlp("https://exemplo.test/bot-check", { height: 720 }),
    (error) => {
      assert.match(error.message, /not a bot/i);
      assert.match(error.message, /YTDLP_COOKIES_PATH/);
      assert.match(error.message, /YTDLP_PROXY/);
      return true;
    },
  );

  const leftovers = (await readdir(TMP_DIR)).filter((name) => name.startsWith("ytdlp-"));

  assert.deepEqual(leftovers, []);
});

test("o downloader usa o yt-dlp e cobra o extra de mídia longa", async () => {
  const jid = `ytdlp-credits-${randomUUID().slice(0, 8)}@lid`;
  const before = accountBalance(getAccount(jid));

  const result = await withCreditsContext(jid, () =>
    downloadVideo("https://exemplo.test/video-longo", 480));

  assert.equal(result.duration, 700);
  // 700s (10 a 30 min) => +4 créditos extras.
  assert.equal(accountBalance(getAccount(jid)), before - 4);

  await rm(result.filePath, { force: true });
});
