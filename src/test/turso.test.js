/**
 * Testes do driver Turso (libSQL).
 *
 * Usa um ficheiro SQLite real (esquema `file:`), que exercita o mesmo código de
 * escrita/leitura que o Turso remoto — `batch` com upsert, `ON CONFLICT` e o
 * parsing das linhas. Um mock não validaria o SQL, que é onde estão os erros
 * que interessam (nome de tabela, sintaxe do upsert, serialização).
 *
 * O esquema remoto (`libsql://`) não é testado aqui porque exigiria uma conta
 * Turso real; o que muda entre os dois é só o transporte do `@libsql/client`.
 *
 * @author Dev Gui
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kakashi-turso-"));
const sqliteFile = path.join(tmpDir, "state.db");

process.env.DATABASE_DIR = tmpDir;
process.env.TURSO_DATABASE_URL = `file:${sqliteFile}`;
process.env.TURSO_AUTH_TOKEN = "token-de-teste";
process.env.AUTH_DIR = path.join(tmpDir, "auth");
process.env.MONGODB_FLUSH_DEBOUNCE_MS = "10";

const database = await import("../utils/database.js");
const store = await import("../services/remoteStore.js");
const turso = await import("../services/turso.js");
const session = await import("../services/sessionStore.js");

const { createClient } = await import("@libsql/client");

/** Cliente direto, para conferir o que ficou gravado. */
async function openInspector() {
  return createClient({ url: `file:${sqliteFile}` });
}

async function resetState() {
  for (const entry of fs.readdirSync(tmpDir)) {
    if (entry !== "state.db" && entry !== "auth") {
      fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
    }
  }

  const client = await openInspector();

  await client.execute("DELETE FROM kakashi_state");
  client.close();
}

async function waitForFlush(timeoutMs = 3000) {
  const started = Date.now();

  while (database.hasPendingFlush() && Date.now() - started < timeoutMs) {
    await database.flushRemoteState();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  await database.flushRemoteState();
}

describe("Turso: espelho do estado", () => {
  before(async () => {
    const ativo = await database.initDatabase();

    assert.equal(ativo, true, "initDatabase devia ativar o espelho");
    assert.equal(turso.isConnected(), true);
  });

  after(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetState();

    // `listBackups` garante que a tabela existe (é criada na primeira
    // utilização), senão o DELETE abaixo falhava numa base nova.
    await turso.listBackups();

    const client = await openInspector();

    await client.execute("DELETE FROM kakashi_backups");
    client.close();
  });

  it("o Turso é o driver ativo quando só ele está configurado", () => {
    assert.equal(store.getActiveDriver().name, "turso");
    assert.equal(store.isRemoteEnabled(), true);
  });

  it("grava o estado alterado no Turso", async () => {
    database.setPrefix("grupo@g.us", "!");

    await waitForFlush();

    const client = await openInspector();
    const result = await client.execute({
      sql: "SELECT data FROM kakashi_state WHERE name = ?",
      args: ["prefix-groups"],
    });
    client.close();

    assert.equal(result.rows.length, 1, "devia existir uma linha");

    const data = JSON.parse(result.rows[0].data);

    assert.equal(data["grupo@g.us"], "!");
  });

  it("restaura o estado do Turso quando o disco está vazio", async () => {
    database.setPrefix("outro@g.us", "#");

    await waitForFlush();

    // Simula um deploy: o disco efémero fica limpo, o Turso mantém o estado.
    for (const entry of fs.readdirSync(tmpDir)) {
      if (entry !== "state.db" && entry !== "auth") {
        fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
      }
    }

    await database.initDatabase();

    assert.equal(
      database.getPrefix("outro@g.us"),
      "#",
      "o prefixo devia ter sido restaurado do Turso",
    );
  });

  it("envia para o Turso o estado que só existe no disco", async () => {
    fs.writeFileSync(
      path.resolve(tmpDir, "credits.json"),
      JSON.stringify({ "utilizador@lid": { credits: 7 } }),
      "utf8",
    );

    await database.initDatabase();
    await waitForFlush();

    const client = await openInspector();
    const result = await client.execute({
      sql: "SELECT data FROM kakashi_state WHERE name = ?",
      args: ["credits"],
    });
    client.close();

    assert.equal(result.rows.length, 1);

    const data = JSON.parse(result.rows[0].data);

    assert.equal(data["utilizador@lid"].credits, 7);
  });

  it("o upsert não duplica a linha ao gravar duas vezes", async () => {
    database.setPrefix("a@g.us", "!");
    await waitForFlush();

    database.setPrefix("b@g.us", "#");
    await waitForFlush();

    const client = await openInspector();
    const result = await client.execute(
      "SELECT COUNT(*) AS total FROM kakashi_state WHERE name = 'prefix-groups'",
    );
    client.close();

    assert.equal(Number(result.rows[0].total), 1, "a linha devia ser única");
    assert.equal(database.getPrefix("a@g.us"), "!");
    assert.equal(database.getPrefix("b@g.us"), "#");
  });

  it("mantém os dados locais quando a gravação falha", async () => {
    // Falha REAL ao nível da base: um trigger que aborta o INSERT. Não é um
    // mock — o driver executa SQL verdadeiro e recebe um erro verdadeiro, que é
    // o caminho que interessa validar.
    const client = await openInspector();

    await client.execute(`
      CREATE TRIGGER IF NOT EXISTS falha_teste
      BEFORE INSERT ON kakashi_state
      BEGIN
        SELECT RAISE(ABORT, 'falha simulada na base');
      END
    `);
    client.close();

    try {
      database.setPrefix("falha@g.us", "?");

      const sucesso = await database.flushRemoteState();

      assert.equal(sucesso, false, "o flush devia reportar falha");
      assert.equal(
        database.hasPendingFlush(),
        true,
        "a alteração devia ficar na fila",
      );
      assert.ok(database.getLastFlushError(), "o erro devia ficar registado");
    } finally {
      // A causa da falha desaparece (a base voltou a aceitar escritas).
      const cleanup = await openInspector();

      await cleanup.execute("DROP TRIGGER IF EXISTS falha_teste");
      cleanup.close();
    }

    // O valor local não se perde: continua legível no disco.
    assert.equal(database.getPrefix("falha@g.us"), "?");

    await waitForFlush();

    const inspector = await openInspector();
    const result = await inspector.execute({
      sql: "SELECT data FROM kakashi_state WHERE name = ?",
      args: ["prefix-groups"],
    });
    inspector.close();

    assert.equal(JSON.parse(result.rows[0].data)["falha@g.us"], "?");
  });

  it("recupera a ligação quando ela caiu", async () => {
    await store.close();

    assert.equal(turso.isConnected(), false);

    database.setPrefix("queda@g.us", "*");

    assert.equal(
      database.hasPendingFlush(),
      true,
      "a escrita durante a queda devia ficar na fila",
    );

    await waitForFlush();

    const client = await openInspector();
    const result = await client.execute({
      sql: "SELECT data FROM kakashi_state WHERE name = ?",
      args: ["prefix-groups"],
    });
    client.close();

    assert.equal(JSON.parse(result.rows[0].data)["queda@g.us"], "*");
  });

  it("nunca envia o token do Turso para o Turso", async () => {
    // O token é a credencial da base: gravá-lo dentro dela seria vazá-lo em
    // qualquer export ou leitura de tabela.
    fs.writeFileSync(
      path.resolve(tmpDir, "config.json"),
      JSON.stringify({
        github_token: "ghp_secreto",
        turso_auth_token: "token-secreto",
        turso_url: "libsql://cluster.turso.io",
      }),
      "utf8",
    );

    database.setGithubToken("ghp_novo");

    await waitForFlush();

    const client = await openInspector();
    const result = await client.execute({
      sql: "SELECT data FROM kakashi_state WHERE name = ?",
      args: ["config"],
    });
    client.close();

    const data = JSON.parse(result.rows[0].data);

    assert.equal(data.github_token, "ghp_novo", "o token útil devia subir");
    assert.equal(
      data.turso_auth_token,
      undefined,
      "o token do Turso NUNCA pode ir para o Turso",
    );
    assert.equal(data.turso_url, undefined, "a URL também não");
  });

  it("preserva as credenciais locais ao restaurar o config", async () => {
    const client = await openInspector();

    await client.execute({
      sql: `INSERT INTO kakashi_state (name, data, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET data = excluded.data`,
      args: [
        "config",
        JSON.stringify({ github_token: "ghp_do_turso" }),
        new Date().toISOString(),
      ],
    });
    client.close();

    fs.writeFileSync(
      path.resolve(tmpDir, "config.json"),
      JSON.stringify({
        github_token: "ghp_antigo",
        turso_auth_token: "token-secreto",
      }),
      "utf8",
    );

    await database.initDatabase();

    const local = JSON.parse(
      fs.readFileSync(path.resolve(tmpDir, "config.json"), "utf8"),
    );

    assert.equal(local.github_token, "ghp_do_turso");
    assert.equal(
      local.turso_auth_token,
      "token-secreto",
      "o token local devia sobreviver ao restore",
    );
  });

it("guarda um backup e lê-o de volta", async () => {
    const { saveBackup, readBackup } = turso;

    await saveBackup({ data: "conteudo-do-backup", retention: 5 });

    const lido = await readBackup();

    assert.equal(lido.data, "conteudo-do-backup");
    assert.equal(lido.includesSession, false);
  });

  it("a retenção apaga os mais antigos e mantém os recentes", async () => {
    const { saveBackup, listBackups } = turso;

    for (let i = 1; i <= 5; i += 1) {
      await saveBackup({ data: `backup-${i}`, retention: 3 });
    }

    const lista = await listBackups();

    assert.equal(lista.length, 3, "devia manter apenas 3");
    // Os mais recentes são os que ficam (5, 4, 3).
    const { readBackup } = turso;
    const maisRecente = await readBackup();

    assert.equal(maisRecente.data, "backup-5");
  });

  it("a retenção de 1 nunca apaga o backup acabado de gravar", async () => {
    const { saveBackup, readBackup } = turso;

    await saveBackup({ data: "unico", retention: 1 });

    const lido = await readBackup();

    assert.ok(lido, "o backup novo não pode ser podado por si próprio");
    assert.equal(lido.data, "unico");
  });

  it("o histórico é independente do estado (apagar estado não apaga backups)", async () => {
    const { saveBackup, listBackups } = turso;

    await saveBackup({ data: "backup-a", retention: 5 });
    await database.flushRemoteState();

    await store.clearState({ keep: ["config"] });

    const lista = await listBackups();

    assert.equal(lista.length, 1, "os backups deviam sobreviver");
  });

  it("clearState poupa as entradas pedidas", async () => {
    database.setPrefix("x@g.us", "!");

    await database.flushRemoteState();

    await store.clearState({ keep: ["config"] });

    const nomes = (await turso.readAll()).map((entry) => entry.name);

    assert.ok(!nomes.includes("prefix-groups"), "o prefixo devia ser apagado");
  });

  it("a sessão é empacotada e restaurada fielmente", async () => {
    const { packSession, restoreSession } = session;
    const authDir = process.env.AUTH_DIR;

    // A sessão de teste tem de existir para o pacote não vir vazio.
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(
      path.join(authDir, "creds.json"),
      JSON.stringify({ me: { id: "999@s.whatsapp.net" } }),
      "utf8",
    );

    const pacote = packSession();

    assert.ok(pacote, "devia empacotar a sessão");
    assert.equal(pacote.files, 1);

    fs.rmSync(authDir, { recursive: true, force: true });

    const ok = restoreSession({
      packed: pacote.data,
      files: pacote.files,
    });

    assert.equal(ok, true, "devia restaurar");

    const creds = JSON.parse(
      fs.readFileSync(path.join(authDir, "creds.json"), "utf8"),
    );

    assert.equal(creds.me.id, "999@s.whatsapp.net");
  });

  it("restaurar a sessão substitui ficheiros antigos em vez de os acumular", async () => {
    const { packSession, restoreSession } = session;
    const authDir = process.env.AUTH_DIR;

    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, "creds.json"), "{}", "utf8");
    fs.writeFileSync(path.join(authDir, "novo.json"), "{}", "utf8");

    const pacote = packSession();

    // Um ficheiro a mais de uma sessão anterior faria o Baileys carregar
    // chaves contraditórias, por isso a pasta é limpa antes de escrever.
    fs.writeFileSync(path.join(authDir, "obsoleto.json"), "{}", "utf8");

    restoreSession({ packed: pacote.data });

    const nomes = fs.readdirSync(authDir);

    assert.ok(
      !nomes.includes("obsoleto.json"),
      "o ficheiro obsoleto devia ter sido removido",
    );
  });
});

describe("Turso: esquema da URL", () => {
  it("traduz turso:// para libsql:// (o cliente rejeita turso://)", async () => {
    // A consola do Turso mostra `turso://`, que o @libsql/client rejeita com
    // URL_SCHEME_NOT_SUPPORTED. Testado em processo separado porque a URL é
    // resolvida no carregar do módulo.
    const { execFileSync } = await import("node:child_process");

    const script = `
      const { createClient } = await import("@libsql/client");
      const turso = await import("${path
        .resolve(import.meta.dirname, "..", "services", "turso.js")
        .replace(/\\/g, "/")}");

      // O cliente rejeita o esquema cru...
      let rejeitado = false;
      try {
        createClient({ url: "turso://cluster.turso.io", authToken: "x" });
      } catch {
        rejeitado = true;
      }

      console.log(JSON.stringify({ rejeitado, enabled: turso.isEnabled() }));
    `;

    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_DIR: tmpDir,
          TURSO_DATABASE_URL: "turso://cluster.turso.io",
          MONGODB_URI: "",
        },
      },
    );

    const resultado = JSON.parse(output.trim().split("\n").at(-1));

    assert.equal(resultado.rejeitado, true, "o esquema cru devia ser rejeitado");
    assert.equal(
      resultado.enabled,
      true,
      "o driver devia estar ativo mesmo com turso:// (é normalizado)",
    );
  });
});
