/**
 * Turso (libSQL) como destino durável da camada de persistência.
 *
 * Por que existe, além do MongoDB: o Turso é SQLite na nuvem, não tem lista de
 * IPs permitidos (que no Pterodactyl obriga a `0.0.0.0/0` por o IP ser
 * dinâmico) e o estado é uma tabela que se lê e edita de qualquer lado — pelo
 * painel web ou por `turso db shell`. Para quem só quer que os créditos
 * sobrevivam aos deploys, é menos peças a configurar.
 *
 * Modelo de dados: uma linha por ficheiro de estado (`name` = nome do ficheiro,
 * `data` = o JSON serializado), o que mantém o mapeamento 1:1 com
 * `database/*.json`.
 *
 * Regra de robustez (igual à do Mongo): o Turso é um extra. Sem URL, ou com a
 * rede em baixo, o bot arranca e serve-se do disco.
 */

import fs from "node:fs";
import path from "node:path";

import { createClient } from "@libsql/client";

import {
  DATABASE_DIR,
  TURSO_AUTH_TOKEN,
  TURSO_BACKUP_TABLE,
  TURSO_DATABASE_URL,
  TURSO_TABLE,
} from "../config.js";
import { infoLog, warningLog } from "../utils/logger.js";

/** Nome do driver, usado pelo seletor de `remoteStore.js`. */
export const name = "turso";

let client = null;
let connected = false;
let connecting = null;
let resolvedUrl = null;
let resolvedToken = null;
let tableReady = false;
let backupTableReady = false;

/** Lê `database/config.json` (não versionado) como alternativa às variáveis. */
function readLocalConfig() {
  try {
    const configPath = path.resolve(DATABASE_DIR, "config.json");

    if (!fs.existsSync(configPath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

/**
 * O cliente oficial só aceita `libsql:`, `wss:`, `ws:`, `https:`, `http:` e
 * `file:` — a consola do Turso mostra a URL com o esquema `turso:`, que o
 * cliente REJEITA com "URL_SCHEME_NOT_SUPPORTED". Traduzir aqui evita um erro
 * confuso para quem copia a URL tal como a vê.
 */
function normalizeUrl(raw) {
  return String(raw || "")
    .trim()
    .replace(/^turso:\/\//i, "libsql://");
}

function resolveUrl() {
  if (resolvedUrl !== null) {
    return resolvedUrl;
  }

  resolvedUrl = normalizeUrl(TURSO_DATABASE_URL || readLocalConfig().turso_url);

  return resolvedUrl;
}

function resolveToken() {
  if (resolvedToken !== null) {
    return resolvedToken;
  }

  resolvedToken = String(
    TURSO_AUTH_TOKEN || readLocalConfig().turso_auth_token || "",
  ).trim();

  return resolvedToken;
}

/** A persistência no Turso está configurada? */
export function isEnabled() {
  return Boolean(resolveUrl());
}

export function isConnected() {
  return connected;
}

/** Cria a tabela de estado se ainda não existir. */
async function ensureTable(target) {
  if (tableReady) {
    return;
  }

  await target.execute(
    `CREATE TABLE IF NOT EXISTS ${TURSO_TABLE} (
       name TEXT PRIMARY KEY,
       data TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
  );

  tableReady = true;
}

/**
 * Abre a ligação e valida-a.
 *
 * Nunca lança: devolve `null` quando não há URL ou quando a ligação falha.
 *
 * @returns {Promise<import("@libsql/client").Client|null>}
 */
export async function connect() {
  if (!isEnabled()) {
    return null;
  }

  if (client && connected) {
    return client;
  }

  if (connecting) {
    return connecting;
  }

  connecting = (async () => {
    try {
      client = createClient({
        url: resolveUrl(),
        authToken: resolveToken() || undefined,
      });

      await ensureTable(client);
      // O `createClient` não faz round-trip; este SELECT é que valida mesmo a
      // ligação (token errado ou base inexistente só falham aqui).
      await client.execute("SELECT 1");

      connected = true;

      infoLog("[turso] ligado");

      return client;
    } catch (error) {
      warningLog(
        `[turso] ligação falhou (${error.message}); a continuar com a cache local`,
      );

      await closeQuietly();

      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

async function closeQuietly() {
  const current = client;

  client = null;
  connected = false;
  tableReady = false;
  backupTableReady = false;

  if (!current) {
    return;
  }

  try {
    current.close();
  } catch {
    // Fechar uma ligação já caída não é um problema.
  }
}

/** Fecha a ligação (usado no shutdown). */
export async function close() {
  await closeQuietly();
}

/**
 * Lê todo o estado guardado.
 *
 * @returns {Promise<Array<{name: string, data: unknown}>>}
 */
export async function readAll() {
  const target = await connect();

  if (!target) {
    return [];
  }

  const result = await target.execute(
    `SELECT name, data FROM ${TURSO_TABLE}`,
  );

  const entries = [];

  for (const row of result.rows) {
    try {
      entries.push({ name: String(row.name), data: JSON.parse(row.data) });
    } catch {
      // Uma linha ilegível é ignorada em vez de impedir o arranque.
      warningLog(`[turso] estado "${row.name}" ilegível; a ignorar`);
    }
  }

  return entries;
}

/**
 * Grava vários estados numa só transação.
 *
 * @param {Array<{name: string, data: unknown}>} entries
 */
export async function writeMany(entries) {
  const target = await connect();

  if (!target) {
    throw new Error("sem ligação ao Turso");
  }

  const now = new Date().toISOString();

  await target.batch(
    entries.map(({ name: entryName, data }) => ({
      sql: `INSERT INTO ${TURSO_TABLE} (name, data, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
              data = excluded.data,
              updated_at = excluded.updated_at`,
      args: [entryName, JSON.stringify(data), now],
    })),
    "write",
  );
}

/* ── Backups (histórico ponto-no-tempo) ─────────────────────────────────── */

/** Cria a tabela de backups se ainda não existir. */
async function ensureBackupTable(target) {
  if (backupTableReady) {
    return;
  }

  await target.execute(
    `CREATE TABLE IF NOT EXISTS ${TURSO_BACKUP_TABLE} (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       created_at TEXT NOT NULL,
       includes_session INTEGER NOT NULL DEFAULT 0,
       size INTEGER NOT NULL DEFAULT 0,
       data TEXT NOT NULL
     )`,
  );

  backupTableReady = true;
}

/**
 * Guarda um backup e apaga os mais antigos acima da retenção.
 *
 * A poda corre depois da inserção, no mesmo sítio: assim a tabela não cresce
 * sem fim mesmo que o bot só seja reiniciado de vez em quando.
 *
 * @param {{data: string, includesSession?: boolean, retention?: number}} options
 * @returns {Promise<{id: number, pruned: number}>}
 */
export async function saveBackup({ data, includesSession = false, retention = 24 }) {
  const target = await connect();

  if (!target) {
    throw new Error("sem ligação ao Turso");
  }

  await ensureBackupTable(target);

  const result = await target.execute({
    sql: `INSERT INTO ${TURSO_BACKUP_TABLE} (created_at, includes_session, size, data)
          VALUES (?, ?, ?, ?)`,
    args: [new Date().toISOString(), includesSession ? 1 : 0, data.length, data],
  });

  const id = Number(result.lastInsertRowid);

  const pruned = await pruneBackups({ retention, keepId: id });

  return { id, pruned };
}

/**
 * Apaga os backups mais antigos, mantendo os `retention` mais recentes.
 *
 * @param {{retention?: number, keepId?: number}} [options]
 * @returns {Promise<number>} quantos foram apagados
 */
export async function pruneBackups({ retention = 24, keepId = 0 } = {}) {
  const target = await connect();

  if (!target) {
    return 0;
  }

  await ensureBackupTable(target);

  const manter = Math.max(1, Number(retention) || 1);

  // O `keepId` protege o backup acabado de gravar: sem ele, um `retention` de 1
  // podia apagar o backup novo se os relógios/ordenação não fossem de confiança.
  const resultado = await target.execute({
    sql: `DELETE FROM ${TURSO_BACKUP_TABLE}
          WHERE id NOT IN (
            SELECT id FROM ${TURSO_BACKUP_TABLE}
            ORDER BY id DESC
            LIMIT ?
          )
          AND id != ?`,
    args: [manter, Number(keepId) || 0],
  });

  return Number(resultado.rowsAffected || 0);
}

/**
 * Lista os backups disponíveis, do mais recente para o mais antigo.
 *
 * @returns {Promise<Array<{id: number, createdAt: string, includesSession: boolean, size: number}>>}
 */
export async function listBackups() {
  const target = await connect();

  if (!target) {
    return [];
  }

  await ensureBackupTable(target);

  const result = await target.execute(
    `SELECT id, created_at, includes_session, size
     FROM ${TURSO_BACKUP_TABLE}
     ORDER BY id DESC`,
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    createdAt: String(row.created_at),
    includesSession: Number(row.includes_session) === 1,
    size: Number(row.size),
  }));
}

/**
 * Lê o conteúdo de um backup.
 *
 * Sem `id`, devolve o mais recente — que é o caso de uso normal (restaurar o
 * último estado bom depois de uma eliminação acidental).
 *
 * @param {{id?: number}} [options]
 * @returns {Promise<{id: number, createdAt: string, includesSession: boolean, data: string}|null>}
 */
export async function readBackup({ id = 0 } = {}) {
  const target = await connect();

  if (!target) {
    return null;
  }

  await ensureBackupTable(target);

  const result = id
    ? await target.execute({
        sql: `SELECT id, created_at, includes_session, data FROM ${TURSO_BACKUP_TABLE} WHERE id = ?`,
        args: [Number(id)],
      })
    : await target.execute(
        `SELECT id, created_at, includes_session, data FROM ${TURSO_BACKUP_TABLE} ORDER BY id DESC LIMIT 1`,
      );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    includesSession: Number(row.includes_session) === 1,
    data: String(row.data),
  };
}

/**
 * Apaga backups.
 *
 * Sem `id`, limpa o histórico inteiro. Usado pelo comando de manutenção do dono.
 *
 * @param {{id?: number}} [options]
 * @returns {Promise<number>} quantos foram apagados
 */
export async function deleteBackups({ id = 0 } = {}) {
  const target = await connect();

  if (!target) {
    throw new Error("sem ligação ao Turso");
  }

  await ensureBackupTable(target);

  const resultado = id
    ? await target.execute({
        sql: `DELETE FROM ${TURSO_BACKUP_TABLE} WHERE id = ?`,
        args: [Number(id)],
      })
    : await target.execute(`DELETE FROM ${TURSO_BACKUP_TABLE}`);

  return Number(resultado.rowsAffected || 0);
}

/**
 * Apaga o estado da tabela, opcionalmente poupando entradas.
 *
 * `keep` existe porque o `config.json` guarda as credenciais do próprio destino:
 * apagá-lo deixaria o bot sem conseguir voltar a ligar-se.
 *
 * @param {{keep?: string[]}} [options]
 * @returns {Promise<number>} quantas linhas foram apagadas
 */
export async function clearState({ keep = [] } = {}) {
  const target = await connect();

  if (!target) {
    throw new Error("sem ligação ao Turso");
  }

  await ensureTable(target);

  if (!keep.length) {
    const resultado = await target.execute(`DELETE FROM ${TURSO_TABLE}`);

    return Number(resultado.rowsAffected || 0);
  }

  const placeholders = keep.map(() => "?").join(", ");
  const resultado = await target.execute({
    sql: `DELETE FROM ${TURSO_TABLE} WHERE name NOT IN (${placeholders})`,
    args: keep,
  });

  return Number(resultado.rowsAffected || 0);
}
