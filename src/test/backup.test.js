import assert from "node:assert";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { DATABASE_DIR } from "../config.js";
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

test("backup para repositório público é recusado", async () => {
  const { publicDestinationError } = await import("../services/backup.js");
  const error = publicDestinationError("dono/repo", false, { allowPublic: false });
  assert.ok(error, "um repositório público não pode receber o backup");
  assert.match(error.message, /PÚBLICO/);
  assert.match(error.message, /privado/, "a mensagem deve indicar a saída");
});

test("backup para repositório privado é permitido", async () => {
  const { publicDestinationError } = await import("../services/backup.js");
  assert.equal(publicDestinationError("dono/repo", true, { allowPublic: false }), null);
});

test("GITHUB_BACKUP_ALLOW_PUBLIC=true assume o risco de propósito", async () => {
  const { publicDestinationError } = await import("../services/backup.js");
  assert.equal(publicDestinationError("dono/repo", false, { allowPublic: true }), null);
});

test("sem GITHUB_BACKUP_ALLOW_PUBLIC o destino público é recusado", async () => {
  const { publicDestinationError } = await import("../services/backup.js");
  const anterior = process.env.GITHUB_BACKUP_ALLOW_PUBLIC;
  delete process.env.GITHUB_BACKUP_ALLOW_PUBLIC;
  try {
    // Sem a opção explícita, o padrão é proteger: a leitura do ambiente
    // acontece na chamada, por isso o teste não precisa de reiniciar o módulo.
    assert.ok(publicDestinationError("dono/repo", false));
  } finally {
    if (anterior !== undefined) process.env.GITHUB_BACKUP_ALLOW_PUBLIC = anterior;
  }
});

/* ════════════ BACKUP AUTOMÁTICO (a cada 2h) ════════════ */

test("o intervalo padrão é de 2 horas", async () => {
  const { backupIntervalMs } = await import("../services/backup.js");
  const { BACKUP_INTERVAL_HOURS } = await import("../config.js");
  assert.equal(BACKUP_INTERVAL_HOURS, 2);
  assert.equal(backupIntervalMs(), 2 * 60 * 60 * 1000);
});

test("BACKUP_INTERVAL_HOURS=0 desliga o agendamento", async () => {
  const { backupIntervalMs } = await import("../services/backup.js");
  assert.equal(backupIntervalMs(0), 0);
  assert.equal(backupIntervalMs("0"), 0);
  assert.equal(backupIntervalMs(-1), 0, "um valor negativo não faz sentido: desliga");
  assert.equal(backupIntervalMs("abc"), 0, "um valor inválido desliga em vez de rebentar");

  // Num subprocesso: `BACKUP_INTERVAL_HOURS` é lida na importação do config,
  // e chamar o agendador aqui dentro com o valor padrão faria um backup REAL.
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { startBackupScheduler } = await import(${JSON.stringify(
        new URL("../services/backup.js", import.meta.url).href,
      )});
       process.stdout.write("RESULT=" + String(startBackupScheduler()));`,
    ],
    { env: { ...process.env, BACKUP_INTERVAL_HOURS: "0" } },
  );
  // O subprocesso também escreve o log; a linha do resultado é a última.
  assert.match(
    stdout.trimEnd(),
    /RESULT=null$/,
    "desligado devolve null e não agenda nada",
  );
});

test("só faz backup quando o intervalo já passou", async () => {
  const { shouldBackupNow } = await import("../services/backup.js");
  const agora = Date.now();
  const intervalo = 2 * 60 * 60 * 1000;
  const haUmaHora = new Date(agora - 60 * 60 * 1000).toISOString();
  const haTresHoras = new Date(agora - 3 * 60 * 60 * 1000).toISOString();

  assert.equal(
    shouldBackupNow({ lastBackupAt: haUmaHora, intervalMs: intervalo, now: agora }),
    false,
    "uma hora depois ainda não é hora de fazer backup",
  );
  assert.equal(
    shouldBackupNow({ lastBackupAt: haTresHoras, intervalMs: intervalo, now: agora }),
    true,
    "três horas depois o intervalo de 2h já passou",
  );
});

test("sem backup anterior faz um no arranque; com intervalo desligado nunca", async () => {
  const { shouldBackupNow } = await import("../services/backup.js");
  const intervalo = 2 * 60 * 60 * 1000;
  assert.equal(
    shouldBackupNow({ lastBackupAt: undefined, intervalMs: intervalo }),
    true,
    "instalação nova deve fazer o primeiro backup",
  );
  assert.equal(
    shouldBackupNow({ lastBackupAt: "data-ilegivel", intervalMs: intervalo }),
    true,
    "um estado corrompido conta como 'nunca houve backup'",
  );
  assert.equal(
    shouldBackupNow({ lastBackupAt: undefined, intervalMs: 0 }),
    false,
    "desligado não faz backup nenhum",
  );
});

test("o agendador grava o estado e não envia a sessão do WhatsApp", async () => {
  const { startBackupScheduler } = await import("../services/backup.js");
  const database = await import("../utils/database.js");
  const stateFile = path.join(DATABASE_DIR, "backup-state.json");
  const anterior = await fs.readFile(stateFile, "utf8").catch(() => null);

  const chamadas = [];
  let timer = null;

  try {
    await fs.rm(stateFile, { force: true });

    timer = startBackupScheduler({
      runBackup: async (options) => {
        chamadas.push(options);
        return { github: true, destination: "dono/repo/backups/kakashi.tar.gz" };
      },
    });

    // O backup inicial corre fora do temporizador; dá-lhe tempo de terminar.
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(chamadas.length, 1, "sem backup anterior, corre logo um no arranque");
    assert.equal(
      chamadas[0].includeAuth,
      false,
      "um backup automático NUNCA pode levar as chaves privadas do número",
    );

    const state = database.readBackupState();
    assert.equal(state.lastBackupOk, true);
    assert.equal(state.lastDestination, "dono/repo/backups/kakashi.tar.gz");
    assert.ok(Date.parse(state.lastBackupAt), "o estado guarda quando foi o último backup");
  } finally {
    if (timer) clearInterval(timer);
    if (anterior === null) await fs.rm(stateFile, { force: true });
    else await fs.writeFile(stateFile, anterior);
  }
});

test("uma falha no backup é registada e não derruba o agendador", async () => {
  const { startBackupScheduler } = await import("../services/backup.js");
  const database = await import("../utils/database.js");
  const stateFile = path.join(DATABASE_DIR, "backup-state.json");
  const anterior = await fs.readFile(stateFile, "utf8").catch(() => null);

  let timer = null;

  try {
    await fs.rm(stateFile, { force: true });

    timer = startBackupScheduler({
      runBackup: async () => {
        throw new Error("GitHub retornou HTTP 401.");
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const state = database.readBackupState();
    assert.equal(state.lastBackupOk, false, "a falha fica registada para o dono ver");
    assert.match(state.lastBackupError, /401/);
    assert.ok(
      Date.parse(state.lastBackupAt),
      "mesmo em falha o horário é gravado, para não repetir a cada arranque",
    );
  } finally {
    if (timer) clearInterval(timer);
    if (anterior === null) await fs.rm(stateFile, { force: true });
    else await fs.writeFile(stateFile, anterior);
  }
});

test("um restart recente não dispara um backup imediato", async () => {
  const { startBackupScheduler } = await import("../services/backup.js");
  const database = await import("../utils/database.js");
  const stateFile = path.join(DATABASE_DIR, "backup-state.json");
  const anterior = await fs.readFile(stateFile, "utf8").catch(() => null);

  const chamadas = [];
  let timer = null;

  try {
    // Simula um backup feito agora mesmo: o bot acabou de arrancar.
    database.saveBackupState({ lastBackupAt: new Date().toISOString() });

    timer = startBackupScheduler({
      runBackup: async (options) => {
        chamadas.push(options);
        return { github: true, destination: "dono/repo/backups/kakashi.tar.gz" };
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(
      chamadas.length,
      0,
      "um deploy não pode gerar um commit de backup a cada arranque",
    );
  } finally {
    if (timer) clearInterval(timer);
    if (anterior === null) await fs.rm(stateFile, { force: true });
    else await fs.writeFile(stateFile, anterior);
  }
});
