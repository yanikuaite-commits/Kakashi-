#!/usr/bin/env node
/**
 * Migra o estado de `database/*.json` para o destino remoto configurado
 * (Turso ou MongoDB).
 *
 * Existe porque a mudança para o remoto não pode depender de o bot arrancar: um
 * operador precisa de subir o estado atual e CONFERIR o que foi gravado antes de
 * confiar no novo destino. É idempotente (upsert por nome), pelo que pode
 * correr-se várias vezes sem duplicar nada.
 *
 * Uso:
 *   TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." \
 *     node scripts/migrate-to-remote.mjs
 *   ... node scripts/migrate-to-remote.mjs --dry-run
 *
 * As credenciais também podem estar em `database/config.json`.
 */

import fs from "node:fs";
import path from "node:path";

import { DATABASE_DIR } from "../src/config.js";
import { getActiveDriver } from "../src/services/remoteStore.js";

const dryRun = process.argv.includes("--dry-run");

/** Credenciais que nunca devem ir para o destino remoto. */
const LOCAL_ONLY_SECRETS = ["mongodb_uri", "turso_url", "turso_auth_token"];

function listStateFiles() {
  if (!fs.existsSync(DATABASE_DIR)) {
    return [];
  }

  return fs
    .readdirSync(DATABASE_DIR)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.replace(/\.json$/, ""))
    .sort();
}

/**
 * Lê o estado a migrar, removendo o que nunca deve ir para o destino.
 *
 * O `config.json` é migrado porque guarda tokens que o dono definiu pelo
 * WhatsApp (`github_token`, `spider_api_token`) e que devem sobreviver a um
 * deploy. As exceções são as credenciais do destino: enviar a password da base
 * de dados para dentro dela própria transformaria um acesso de leitura num
 * acesso total.
 */
function readState(name) {
  const raw = fs.readFileSync(
    path.resolve(DATABASE_DIR, `${name}.json`),
    "utf8",
  );

  const value = JSON.parse(raw);

  if (name !== "config" || !value || typeof value !== "object") {
    return value;
  }

  const limpo = { ...value };

  for (const key of LOCAL_ONLY_SECRETS) {
    if (limpo[key]) {
      console.log(`   ℹ️  config: ${key} omitida (é um segredo)`);
      delete limpo[key];
    }
  }

  return limpo;
}

async function main() {
  const driver = getActiveDriver();

  if (!driver) {
    console.error(
      "❌ Nenhum destino configurado. Defina TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN)\n" +
        "   ou MONGODB_URI, no ambiente ou em database/config.json.",
    );
    process.exit(1);
  }

  const names = listStateFiles();

  if (!names.length) {
    console.error(`❌ Nenhum estado encontrado em ${DATABASE_DIR}.`);
    process.exit(1);
  }

  console.log(`🎯 Destino: ${driver.name}`);
  console.log(`📦 Estados encontrados: ${names.join(", ")}`);

  if (dryRun) {
    for (const name of names) {
      console.log(
        `   [dry-run] ${name}: ${JSON.stringify(readState(name)).slice(0, 80)}...`,
      );
    }

    console.log("✅ Dry-run concluído; nada foi gravado.");
    return;
  }

  const client = await driver.connect();

  if (!client) {
    console.error(`❌ Não foi possível ligar ao ${driver.name}.`);
    process.exit(1);
  }

  try {
    const entries = names.map((name) => ({ name, data: readState(name) }));

    await driver.writeMany(entries);

    for (const entry of entries) {
      console.log(
        `   ✅ ${entry.name} (${JSON.stringify(entry.data).length} bytes)`,
      );
    }

    // Confere o que ficou gravado, para o operador não confiar às cegas.
    const gravados = await driver.readAll();
    const presentes = names.filter((name) =>
      gravados.some((entry) => entry.name === name),
    );

    console.log(
      `\n✅ ${presentes.length}/${names.length} estados gravados no ${driver.name}.`,
    );

    if (presentes.length !== names.length) {
      console.error("⚠️  Nem todos os estados foram gravados. Verifique as credenciais.");
      process.exit(1);
    }
  } finally {
    await driver.close();
  }
}

main().catch((error) => {
  console.error(`❌ Migração falhou: ${error.message}`);
  process.exit(1);
});
