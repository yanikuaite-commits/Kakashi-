/**
 * Ligação ao MongoDB (Atlas) para a camada de persistência.
 *
 * Por que existe:
 * - o `database/` em JSON vive no disco do host; em hosts com disco efémero
 *   (Render, Cloady, Fly, Railway) cada deploy apagava créditos, assinaturas e
 *   pareamento;
 * - o MongoDB Atlas (M0, grátis) guarda esse estado fora do host e permite
 *   manejá-lo pelo telemóvel com o Data Explorer;
 * - o driver do Mongo é assíncrono, mas o `database.js` expõe 69 funções
 *   síncronas usadas por 69 ficheiros. Por isso a leitura/escrita imediata é
 *   servida por cache em memória e o Mongo é o destino durável (veja
 *   `src/utils/database.js`).
 *
 * Regra de robustez: o Mongo é um extra, não um pré-requisito. Se a ligação
 * falhar (rede, IP não liberado, quota), o bot continua a arrancar e a servir
 * pedidos a partir do estado em cache local.
 */

import fs from "node:fs";
import path from "node:path";

import { MongoClient } from "mongodb";

import {
  DATABASE_DIR,
  MONGODB_DB,
  MONGODB_STATE_COLLECTION,
  MONGODB_URI,
  MONGODB_SERVER_SELECTION_TIMEOUT_MS,
} from "../config.js";
import { infoLog, warningLog } from "../utils/logger.js";

let client = null;
let database = null;
let connecting = null;
let connected = false;
let resolvedUri = null;

/**
 * URI de ligação, por ordem de prioridade: variável de ambiente, depois
 * `database/config.json` (não versionado).
 *
 * O segundo caminho existe porque nem todo host deixa declarar variáveis
 * facilmente (no Pterodactyl obrigaria a editar o egg); assim basta escrever a
 * URI no ficheiro de configuração que o bot já usa.
 *
 * @returns {string}
 */
function resolveUri() {
  if (resolvedUri !== null) {
    return resolvedUri;
  }

  if (MONGODB_URI) {
    resolvedUri = MONGODB_URI;
    return resolvedUri;
  }

  try {
    const configPath = path.resolve(DATABASE_DIR, "config.json");

    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

      resolvedUri = String(config.mongodb_uri || "").trim();
    }
  } catch {
    // Configuração ilegível não deve impedir o arranque: cai no modo JSON.
    resolvedUri = "";
  }

  return resolvedUri || "";
}

/** A persistência no Mongo está ativa? */
export function isMongoEnabled() {
  return Boolean(resolveUri());
}

export function isMongoConnected() {
  return connected;
}

/* ── Interface de driver consumida por `src/services/remoteStore.js` ─────── */

/** Nome do driver. */
export const name = "mongo";

export function isEnabled() {
  return isMongoEnabled();
}

export function isConnected() {
  return isMongoConnected();
}

export function connect() {
  return connectMongo();
}

/** Lê todos os estados guardados. */
export async function readAll() {
  const db = getMongoDatabase();

  if (!db) {
    return [];
  }

  const docs = await db.collection(MONGODB_STATE_COLLECTION).find({}).toArray();

  return docs.map((doc) => ({ name: String(doc._id), data: doc.data }));
}

/**
 * Grava vários estados num só `bulkWrite`.
 *
 * @param {Array<{name: string, data: unknown}>} entries
 */
export async function writeMany(entries) {
  const db = getMongoDatabase();

  if (!db) {
    throw new Error("sem ligação ao MongoDB");
  }

  await db.collection(MONGODB_STATE_COLLECTION).bulkWrite(
    entries.map(({ name: entryName, data }) => ({
      updateOne: {
        filter: { _id: entryName },
        update: { $set: { data, updatedAt: new Date() } },
        upsert: true,
      },
    })),
  );
}

/** Fecha a ligação (nome exigido pela interface de driver). */
export async function close() {
  await closeMongo();
}

/**
 * Abre a ligação e valida-a com um `ping`.
 *
 * Nunca lança: devolve `null` quando não há URI configurado ou quando a
 * ligação falha. Quem chama decide o que fazer (o bot segue em cache local).
 *
 * @returns {Promise<import("mongodb").Db|null>}
 */
export async function connectMongo() {
  if (!isMongoEnabled()) {
    infoLog("[mongo] MONGODB_URI não configurado; a usar persistência em JSON");
    return null;
  }

  if (database && connected) {
    return database;
  }

  // Uma ligação já em curso é reaproveitada: dois chamadores concorrentes não
  // devem abrir duas ligações.
  if (connecting) {
    return connecting;
  }

  connecting = (async () => {
    try {
      client = new MongoClient(resolveUri(), {
        serverSelectionTimeoutMS: MONGODB_SERVER_SELECTION_TIMEOUT_MS,
      });

      await client.connect();

      const db = client.db(MONGODB_DB);
      await db.command({ ping: 1 });

      database = db;
      connected = true;

      infoLog(`[mongo] ligado à base "${MONGODB_DB}"`);

      return db;
    } catch (error) {
      warningLog(
        `[mongo] ligação falhou (${error.message}); a continuar com a cache local`,
      );

      await closeMongoQuietly();

      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

/** Fecha a ligação sem lançar (usado no erro e no shutdown). */
async function closeMongoQuietly() {
  const current = client;
  client = null;
  database = null;
  connected = false;

  if (!current) {
    return;
  }

  try {
    await current.close();
  } catch {
    // Fechar uma ligação já caída não é um problema.
  }
}

/**
 * Fecha a ligação. Chamado no shutdown, depois de o `database.js` ter feito o
 * flush final.
 */
export async function closeMongo() {
  await closeMongoQuietly();
  infoLog("[mongo] ligação fechada");
}

/**
 * Acesso à base ligada, para quem precisa de coleções diretamente
 * (a migração e os testes).
 *
 * @returns {import("mongodb").Db|null}
 */
export function getMongoDatabase() {
  return database;
}

/**
 * Apaga o estado da coleção, opcionalmente poupando entradas.
 *
 * @param {{keep?: string[]}} [options]
 * @returns {Promise<number>} quantos documentos foram apagados
 */
export async function clearState({ keep = [] } = {}) {
  const db = getMongoDatabase();

  if (!db) {
    throw new Error("sem ligação ao MongoDB");
  }

  const filtro = keep.length ? { _id: { $nin: keep } } : {};

  const resultado = await db
    .collection(MONGODB_STATE_COLLECTION)
    .deleteMany(filtro);

  return Number(resultado.deletedCount || 0);
}
