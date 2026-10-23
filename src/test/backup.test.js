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
