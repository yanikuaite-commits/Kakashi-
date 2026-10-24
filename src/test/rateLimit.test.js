import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  COMMAND_COOLDOWN_SECONDS,
  MAX_COMMANDS_PER_DAY,
} from "../config.js";
import {
  checkRateLimit,
  cooldownRemaining,
  dailyCommandCount,
  isRateLimited,
  pruneRateLimits,
  rateLimitMessage,
  registerCommandUse,
} from "../services/rateLimit.js";
import { activateGroup, setBotEnabled } from "../utils/database.js";
import { dynamicCommand } from "../utils/dynamicCommand.js";
import { extractDataFromMessage } from "../utils/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATABASE_DIR = path.resolve(__dirname, "..", "..", "database");
const RATE_LIMIT_FILE = path.join(DATABASE_DIR, "rate-limit.json");

const runId = randomUUID().slice(0, 8);
const testJid = (name) => `ratelimit-${name}-${runId}@lid`;

const previous = new Map();

before(async () => {
  for (const file of [
    RATE_LIMIT_FILE,
    path.join(DATABASE_DIR, "credits.json"),
    path.join(DATABASE_DIR, "bot-state.json"),
    path.join(DATABASE_DIR, "inactive-groups.json"),
  ]) {
    previous.set(
      file,
      await readFile(file).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    );
  }
});

after(async () => {
  for (const [file, content] of previous) {
    if (content === null) await rm(file, { force: true });
    else await writeFile(file, content);
  }
});

test("anti-flood: só os comandos que gastam recursos são limitados", () => {
  assert.equal(isRateLimited({ name: "play-video", commands: ["play-video", "pv"] }), true);
  assert.equal(isRateLimited({ name: "tik-tok", commands: ["tik-tok", "ttk"] }), true);
  assert.equal(isRateLimited({ name: "anime", commands: ["anime"] }), true);
  // Um atalho basta para o comando entrar no travão.
  assert.equal(isRateLimited({ name: "youtube", commands: ["play-video"] }), true);
  // Navegação e moderação ficam de fora.
  assert.equal(isRateLimited({ name: "conta", commands: ["conta"] }), false);
  assert.equal(isRateLimited({ name: "menu", commands: ["menu"] }), false);
  assert.equal(isRateLimited({ name: "warn", commands: ["warn"] }), false);
  assert.equal(isRateLimited({ name: "ban", commands: ["ban"] }), false);
  assert.equal(isRateLimited({ name: "ping", commands: ["ping"] }), false);
});

test("anti-flood: o cooldown bloqueia a repetição imediata e libera depois", () => {
  const jid = testJid("cooldown");
  const agora = Date.now();

  assert.deepEqual(checkRateLimit(jid, { now: agora }), { ok: true });

  registerCommandUse(jid, { now: agora });

  const travado = checkRateLimit(jid, { now: agora + 1000 });
  assert.equal(travado.ok, false);
  assert.equal(travado.reason, "cooldown");
  assert.equal(travado.retryInSeconds, COMMAND_COOLDOWN_SECONDS - 1);

  // Passado o intervalo, volta a poder.
  assert.equal(
    checkRateLimit(jid, { now: agora + COMMAND_COOLDOWN_SECONDS * 1000 + 1 }).ok,
    true,
  );
  assert.equal(cooldownRemaining(jid, agora + COMMAND_COOLDOWN_SECONDS * 1000 + 1), 0);
});

test("anti-flood: o teto diário trava e o contador renova no dia seguinte", () => {
  const jid = testJid("daily");
  const agora = Date.now();

  // Enche o dia até ao limite.
  for (let i = 0; i < MAX_COMMANDS_PER_DAY; i += 1) {
    registerCommandUse(jid, { now: agora });
  }

  assert.equal(dailyCommandCount(jid, agora), MAX_COMMANDS_PER_DAY);

  const travado = checkRateLimit(jid, { now: agora + COMMAND_COOLDOWN_SECONDS * 1000 + 1 });
  assert.equal(travado.ok, false);
  assert.equal(travado.reason, "daily");
  assert.equal(travado.limit, MAX_COMMANDS_PER_DAY);

  // Dia seguinte: o contador conta como zero e o comando volta a passar.
  const amanha = agora + 24 * 60 * 60 * 1000;
  assert.equal(dailyCommandCount(jid, amanha), 0);
  assert.equal(checkRateLimit(jid, { now: amanha }).ok, true);
});

test("anti-flood: o dono não é limitado", () => {
  const agora = Date.now();
  const dono = testJid("dono");

  for (let i = 0; i < MAX_COMMANDS_PER_DAY + 5; i += 1) {
    registerCommandUse(dono, { now: agora });
  }

  assert.equal(checkRateLimit(dono, { now: agora + 1 }).ok, false);
  assert.equal(checkRateLimit(dono, { now: agora + 1, isOwner: true }).ok, true);
  // Sem conta (dono), o dispatcher nem chama: aqui confirma-se que não trava.
  assert.equal(checkRateLimit(null, { now: agora }).ok, true);
});

test("anti-flood: a mensagem distingue cooldown de teto diário", () => {
  const cooldown = rateLimitMessage({
    commandName: "play-video",
    reason: "cooldown",
    retryInSeconds: 4,
  });
  assert.match(cooldown, /Devagar/);
  assert.match(cooldown, /play-video/);
  assert.match(cooldown, /4 s/);

  const diario = rateLimitMessage({
    commandName: "play-video",
    reason: "daily",
    count: 200,
    limit: 200,
  });
  assert.match(diario, /Limite diário/);
  assert.match(diario, /200\/200/);
});

test("anti-flood: o dispatcher real trava o flood e não cobra o travado", async () => {
  const remoteJid = `ratelimit-${runId}@g.us`;
  const membro = testJid("gate");

  activateGroup(remoteJid);
  setBotEnabled(true);

  const respostas = [];

  const correr = async (texto) => {
    const webMessage = {
      key: { remoteJid, participant: membro },
      pushName: "Teste",
      message: { conversation: texto },
    };

    await dynamicCommand(
      {
        ...extractDataFromMessage(webMessage),
        userLid: membro,
        webMessage,
        sendReply: async (m) => respostas.push(String(m)),
        sendWarningReply: async (m) => respostas.push(String(m)),
        sendErrorReply: async (m) => respostas.push(String(m)),
        sendSuccessReply: async (m) => respostas.push(String(m)),
        sendWaitReply: async (m) => respostas.push(String(m)),
        sendReact: async () => {},
        sendSuccessReact: async () => {},
        sendWaitReact: async () => {},
        sendStickerFromURL: async () => {},
        sendImageFromFile: async () => {},
      },
      Date.now(),
    );
  };

  try {
    // `.brat` é limitado e existe na base: a primeira passa, a segunda é travada.
    await correr(".brat ola");
    const depoisDaPrimeira = dailyCommandCount(membro);

    respostas.length = 0;
    await correr(".brat de novo");

    const texto = respostas.join("\n");
    assert.match(texto, /Devagar/, "a repetição imediata deve ser travada");
    assert.equal(
      dailyCommandCount(membro),
      depoisDaPrimeira,
      "quem é travado não gasta o teto diário",
    );

    // Um comando isento não é travado, mesmo logo a seguir.
    respostas.length = 0;
    await correr(".ping");
    assert.ok(!/Devagar/.test(respostas.join("\n")), "comando isento não passa pelo travão");
  } finally {
    activateGroup(remoteJid);
  }
});

test("anti-flood: a limpeza remove registos antigos", () => {
  const jid = testJid("limpeza");
  const agora = Date.now();

  registerCommandUse(jid, { now: agora - 40 * 24 * 60 * 60 * 1000 });
  assert.equal(pruneRateLimits({ now: agora, days: 30 }) >= 1, true);
  assert.equal(dailyCommandCount(jid, agora), 0);
});
