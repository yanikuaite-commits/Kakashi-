/**
 * Testes do espelho no MongoDB.
 *
 * Usa um servidor MongoDB real em memória (mongodb-memory-server), não um mock:
 * o que está a ser testado é a interação com o driver — `bulkWrite`, upsert por
 * `_id` e restauro do estado no arranque — e um mock não a exerceria.
 *
 * @author Dev Gui
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { after, before, beforeEach, describe, it } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kakashi-mongo-"));

process.env.DATABASE_DIR = tmpDir;
// Debounce curto para os testes não esperarem 1s por cada flush.
process.env.MONGODB_FLUSH_DEBOUNCE_MS = "10";

/**
 * `mongodb-memory-server` é opcional: descarrega um binário `mongod` (~100 MB)
 * e não deve ser dependência de produção — no Pterodactyl o `npm install` do
 * arranque não pode pagar esse custo. Quem quiser correr estes testes instala-o
 * com `npm i -D mongodb-memory-server`; sem ele, o ficheiro é saltado em vez de
 * falhar.
 */
let MongoMemoryServer = null;

try {
  ({ MongoMemoryServer } = await import("mongodb-memory-server"));
} catch {
  console.warn(
    "[mongo.test] mongodb-memory-server ausente; testes do Mongo saltados. " +
      "Instale com: npm i -D mongodb-memory-server",
  );
}

const describeMongo = MongoMemoryServer ? describe : describe.skip;

const server = MongoMemoryServer ? await MongoMemoryServer.create() : null;

if (server) {
  process.env.MONGODB_URI = server.getUri();
  process.env.MONGODB_DB = "kakashi-test";
}

const database = await import("../utils/database.js");
const mongo = await import("../services/mongo.js");

/** Apaga todos os ficheiros de estado e as coleções entre testes. */
async function resetState() {
  for (const entry of fs.readdirSync(tmpDir)) {
    fs.rmSync(path.join(tmpDir, entry), { force: true });
  }

  const db = mongo.getMongoDatabase();

  if (db) {
    await db.collection("state").deleteMany({});
  }
}

/** Espera que a fila de escrita esvazie (o flush é assíncrono). */
async function waitForFlush(timeoutMs = 3000) {
  const started = Date.now();

  while (database.hasPendingFlush() && Date.now() - started < timeoutMs) {
    await database.flushRemoteState();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  await database.flushRemoteState();
}

describeMongo("MongoDB: espelho do estado", () => {
  before(async () => {
    const ativo = await database.initDatabase();

    assert.equal(ativo, true, "initDatabase devia ativar o espelho");
    assert.equal(mongo.isConnected(), true);
  });

  after(async () => {
    await mongo.close();
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetState();
  });

  it("grava o estado alterado no Mongo", async () => {
    database.setPrefix("grupo@g.us", "!");

    await waitForFlush();

    const doc = await mongo
      .getMongoDatabase()
      .collection("state")
      .findOne({ _id: "prefix-groups" });

    assert.ok(doc, "o documento prefix-groups devia existir no Mongo");
    assert.equal(doc.data["grupo@g.us"], "!");
    assert.ok(doc.updatedAt instanceof Date);
  });

  it("restaura o estado do Mongo quando o disco está vazio", async () => {
    database.setPrefix("outro@g.us", "#");

    await waitForFlush();

    // Simula um deploy: o disco efémero fica limpo, o Mongo mantém o estado.
    for (const entry of fs.readdirSync(tmpDir)) {
      fs.rmSync(path.join(tmpDir, entry), { force: true });
    }

    await database.initDatabase();

    assert.equal(
      database.getPrefix("outro@g.us"),
      "#",
      "o prefixo devia ter sido restaurado do Mongo",
    );
  });

  it("envia para o Mongo o estado que só existe no disco", async () => {
    // Estado local sem correspondência no Mongo (primeira execução).
    fs.writeFileSync(
      path.resolve(tmpDir, "credits.json"),
      JSON.stringify({ "utilizador@lid": { credits: 7 } }),
      "utf8",
    );

    await database.initDatabase();
    await waitForFlush();

    const doc = await mongo
      .getMongoDatabase()
      .collection("state")
      .findOne({ _id: "credits" });

    assert.ok(doc, "o documento credits devia ter sido enviado");
    assert.equal(doc.data["utilizador@lid"].credits, 7);
  });

  it("agrupa várias escritas num só flush", async () => {
    database.setPrefix("a@g.us", "!");
    database.setPrefix("b@g.us", "#");
    database.setBotEnabled(true);

    assert.equal(database.hasPendingFlush(), true);

    await waitForFlush();

    assert.equal(database.hasPendingFlush(), false);

    const collection = mongo.getMongoDatabase().collection("state");
    const prefixos = await collection.findOne({ _id: "prefix-groups" });
    const estado = await collection.findOne({ _id: "bot-state" });

    assert.equal(prefixos.data["a@g.us"], "!");
    assert.equal(prefixos.data["b@g.us"], "#");
    assert.equal(estado.data.enabled, true);
  });

  it("mantém os dados locais quando a gravação falha e recupera depois", async () => {
    // Falha de escrita ao nível do driver: o patch é no protótipo porque
    // `db.collection()` devolve uma instância nova a cada chamada, e patchar só
    // uma instância não afetaria a que o flush usa.
    const { Collection } = await import("mongodb");
    const original = Collection.prototype.bulkWrite;

    Collection.prototype.bulkWrite = async () => {
      throw new Error("rede em baixo");
    };

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
      Collection.prototype.bulkWrite = original;
    }

    // O valor local não se perde: continua legível no disco.
    assert.equal(database.getPrefix("falha@g.us"), "?");

    // A rede volta: a alteração que ficou na fila é gravada.
    await waitForFlush();

    const doc = await mongo
      .getMongoDatabase()
      .collection("state")
      .findOne({ _id: "prefix-groups" });

    assert.equal(doc.data["falha@g.us"], "?");
  });

  it("recupera a ligação quando ela caiu", async () => {
    // Com a ligação fechada, uma escrita nova tem de ficar na fila (não pode
    // perder-se) e ser gravada assim que a ligação voltar.
    await mongo.close();

    assert.equal(mongo.isConnected(), false);

    database.setPrefix("queda@g.us", "*");

    assert.equal(
      database.hasPendingFlush(),
      true,
      "a escrita durante a queda devia ficar na fila",
    );

    await waitForFlush();

    const doc = await mongo
      .getMongoDatabase()
      .collection("state")
      .findOne({ _id: "prefix-groups" });

    assert.equal(doc.data["queda@g.us"], "*");
  });

  it("não abre duas ligações em chamadas concorrentes", async () => {
    const [a, b] = await Promise.all([
      mongo.connect(),
      mongo.connect(),
    ]);

    assert.equal(a, b, "as duas chamadas deviam partilhar a mesma base");
  });

  it("nunca envia a mongodb_uri para o Mongo", async () => {
    // A URI contém a password da base: copiá-la para dentro da própria base
    // transformaria um acesso de leitura num acesso total.
    fs.writeFileSync(
      path.resolve(tmpDir, "config.json"),
      JSON.stringify({
        github_token: "ghp_secreto",
        mongodb_uri: "mongodb+srv://user:password@cluster/",
      }),
      "utf8",
    );

    // Dispara um flush deste ficheiro (como faria o `.set-github-token`).
    database.setGithubToken("ghp_novo");

    await waitForFlush();

    const doc = await mongo
      .getMongoDatabase()
      .collection("state")
      .findOne({ _id: "config" });

    assert.ok(doc, "o config devia ser espelhado (guarda tokens úteis)");
    assert.equal(doc.data.github_token, "ghp_novo");
    assert.equal(
      doc.data.mongodb_uri,
      undefined,
      "a mongodb_uri NUNCA pode ir para o Mongo",
    );
  });

  it("preserva a mongodb_uri local ao restaurar o config", async () => {
    // O config no Mongo não tem a URI; o restore não pode apagá-la do disco,
    // senão o bot perde a ligação no arranque seguinte.
    await mongo
      .getMongoDatabase()
      .collection("state")
      .updateOne(
        { _id: "config" },
        {
          $set: {
            data: { github_token: "ghp_do_mongo" },
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );

    fs.writeFileSync(
      path.resolve(tmpDir, "config.json"),
      JSON.stringify({
        github_token: "ghp_antigo",
        mongodb_uri: "mongodb+srv://user:password@cluster/",
      }),
      "utf8",
    );

    await database.initDatabase();

    const local = JSON.parse(
      fs.readFileSync(path.resolve(tmpDir, "config.json"), "utf8"),
    );

    assert.equal(local.github_token, "ghp_do_mongo");
    assert.equal(
      local.mongodb_uri,
      "mongodb+srv://user:password@cluster/",
      "a URI local devia sobreviver ao restore",
    );
  });
});

// Este não precisa do servidor em memória, por isso corre sempre.
describe("MongoDB: modo JSON (sem MONGODB_URI)", () => {
  it("initDatabase devolve false e não lança", () => {
    // Testado num processo à parte: o `config.js` lê a variável no import, por
    // isso apagá-la aqui não mudaria a constante já carregada em memória.
    const script = `
      const database = await import("${path
        .resolve(import.meta.dirname, "..", "utils", "database.js")
        .replace(/\\/g, "/")}");
      const mongo = await import("${path
        .resolve(import.meta.dirname, "..", "services", "mongo.js")
        .replace(/\\/g, "/")}");

      console.log(JSON.stringify({
        enabled: mongo.isEnabled(),
        ativo: await database.initDatabase(),
        ligado: mongo.isConnected(),
      }));
    `;

    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_DIR: tmpDir,
          MONGODB_URI: "",
          MONGODB_DB: "kakashi-test",
        },
      },
    );

    const resultado = JSON.parse(output.trim().split("\n").at(-1));

    assert.deepEqual(resultado, {
      enabled: false,
      ativo: false,
      ligado: false,
    });
  });
});
