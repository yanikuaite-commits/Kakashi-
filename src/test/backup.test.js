import assert from "node:assert";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { backupEntries } from "../services/backup.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);

test("backup sem pedido explícito NÃO leva a sessão do WhatsApp", async () => {
  const entries = await backupEntries({ includeAuth: false });
  assert.ok(
    !entries.includes("assets/auth/baileys"),
    "a sessão do Baileys é a chave privada do número: só sai com autorização",
  );
  assert.ok(entries.includes("database"), "os dados (créditos incluídos) entram sempre");
});

test("backup com pedido explícito leva a sessão do WhatsApp", async () => {
  const entries = await backupEntries({ includeAuth: true });
  assert.ok(entries.includes("assets/auth/baileys"));
});

test("o arquivo de dados leva os créditos e os pagamentos pendentes", async () => {
  const entries = await backupEntries({ includeAuth: false });
  assert.ok(entries.includes("database"));

  // A pasta `database/` carrega credits.json e pending-recharges.json: as
  // funções abaixo leem exatamente esses ficheiros.
  const database = await import("../utils/database.js");
  assert.equal(typeof database.readCreditsAccounts, "function");
  assert.equal(typeof database.readPendingRecharges, "function");
  assert.equal(typeof database.isBotEnabled, "function");
});

test("backup real produz arquivo com os dados e sem a sessão por padrão", async () => {
  const entries = await backupEntries({ includeAuth: false });
  const archivePath = path.join(os.tmpdir(), `kakashi-backup-test-${Date.now()}.tar.gz`);
  try {
    await execFileAsync("tar", ["-czf", archivePath, "-C", projectRoot, ...entries]);
    const { stdout } = await execFileAsync("tar", ["-tzf", archivePath]);
    const linhas = stdout.trim().split("\n");
    assert.ok(
      linhas.some((linha) => linha.startsWith("database/")),
      "o arquivo deve conter a pasta database/",
    );
    assert.ok(
      !linhas.some((linha) => linha.startsWith("assets/auth/baileys")),
      "o arquivo NÃO deve conter a sessão do WhatsApp",
    );
  } finally {
    await fs.rm(archivePath, { force: true });
  }
});

test("o comando .backup documenta a opção da sessão", async () => {
  const comando = (await import("../commands/owner/backup.js")).default;
  assert.match(comando.usage, /sessao/);
  // Não invocamos handle() aqui: com GITHUB_TOKEN no ambiente ele faria um
  // upload real do backup, incluindo o .env.
});

test("o comando .restore documenta a opção da sessão", async () => {
  const comando = (await import("../commands/owner/restore.js")).default;
  assert.match(comando.usage, /sessao/);
});

/**
 * Constrói um arquivo de backup falso (com sessão e dados) e restaura-o sobre
 * um diretório temporário, exercitando `applyArchive` a sério.
 */
async function arquivoFalso({ comSessao }) {
  const src = path.join(os.tmpdir(), `fake-src-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(path.join(src, "database"), { recursive: true });
  await fs.writeFile(path.join(src, "database", "credits.json"), '{"a":{"balance":5}}');
  if (comSessao) {
    await fs.mkdir(path.join(src, "assets", "auth", "baileys"), { recursive: true });
    await fs.writeFile(path.join(src, "assets", "auth", "baileys", "creds.json"), '{"privada":true}');
  }
  const archivePath = path.join(os.tmpdir(), `fake-${Date.now()}-${Math.random().toString(36).slice(2)}.tar.gz`);
  await execFileAsync("tar", ["-czf", archivePath, "-C", src, ...(comSessao ? ["database", "assets"] : ["database"])]);
  await fs.rm(src, { recursive: true, force: true });
  return archivePath;
}

async function dirTemporario() {
  return fs.mkdtemp(path.join(os.tmpdir(), "restore-target-"));
}

test("restauro sem autorização restaura os dados e IGNORA a sessão do arquivo", async () => {
  const { applyArchive } = await import("../services/backup.js");
  const archivePath = await arquivoFalso({ comSessao: true });
  const target = await dirTemporario();
  try {
    const result = await applyArchive(archivePath, { includeAuth: false, targetRoot: target });

    assert.equal(result.includesSession, false);
    assert.ok(
      await fs.stat(path.join(target, "database", "credits.json")),
      "os dados têm de ser restaurados",
    );
    await assert.rejects(
      fs.access(path.join(target, "assets", "auth", "baileys", "creds.json")),
      "a sessão do arquivo NÃO pode ser restaurada sem autorização",
    );
  } finally {
    await fs.rm(archivePath, { force: true });
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("restauro com autorização restaura também a sessão do arquivo", async () => {
  const { applyArchive } = await import("../services/backup.js");
  const archivePath = await arquivoFalso({ comSessao: true });
  const target = await dirTemporario();
  try {
    const result = await applyArchive(archivePath, { includeAuth: true, targetRoot: target });

    assert.equal(result.includesSession, true);
    assert.ok(await fs.stat(path.join(target, "assets", "auth", "baileys", "creds.json")));
  } finally {
    await fs.rm(archivePath, { force: true });
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("restauro sobre um projeto com sessão já instalada não a apaga", async () => {
  const { applyArchive } = await import("../services/backup.js");
  const archivePath = await arquivoFalso({ comSessao: true });
  const target = await dirTemporario();
  try {
    // Simula o bot já pareado: existe uma sessão local que deve sobreviver.
    await fs.mkdir(path.join(target, "assets", "auth", "baileys"), { recursive: true });
    await fs.writeFile(path.join(target, "assets", "auth", "baileys", "creds.json"), '{"local":true}');

    await applyArchive(archivePath, { includeAuth: false, targetRoot: target });

    const creds = await fs.readFile(path.join(target, "assets", "auth", "baileys", "creds.json"), "utf8");
    assert.match(creds, /local/, "a sessão local do bot não pode ser tocada");
  } finally {
    await fs.rm(archivePath, { force: true });
    await fs.rm(target, { recursive: true, force: true });
  }
});
