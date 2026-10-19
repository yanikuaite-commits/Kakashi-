#!/usr/bin/env node
/**
 * Auditoria dos comandos (corrige o erro
 * "A propriedade \"commands\" precisa existir ... Arquivo errado: <name>.js").
 *
 * Importa cada arquivo de `src/commands` (recursivo), lista:
 *   1. arquivos sem `commands` array ou sem `handle`;
 *   2. nomes de comandos duplicados (definidos em mais de um arquivo);
 *   3. `handle` que não é função.
 * Termina com código 1 se houver problemas, para poder ser usado em CI.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const COMMANDS_DIR = path.join(ROOT, "src", "commands");

function listFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      listFiles(filePath, files);
    } else if (entry.name.endsWith(".js")) {
      files.push(filePath);
    }
  }
  return files;
}

const files = listFiles(COMMANDS_DIR);
const problemas = [];
const owner = new Map(); // comando normalizado → [arquivo, arquivo...]

for (const filePath of files) {
  const rel = path.relative(ROOT, filePath);
  let mod;
  try {
    mod = await import(pathToFileURL(filePath).href);
  } catch (error) {
    problemas.push(`❗ ${rel}: FALHA AO IMPORTAR — ${error.message}`);
    continue;
  }

  const cmd = mod.default ?? mod;

  if (!cmd || typeof cmd !== "object") {
    problemas.push(`❗ ${rel}: não exporta um objeto de comando`);
    continue;
  }

  if (!Array.isArray(cmd.commands) || cmd.commands.length === 0) {
    problemas.push(`❗ ${rel}: sem \`commands\` array (comando: ${cmd.name ?? "(sem name)"})`);
  }

  if (typeof cmd.handle !== "function") {
    problemas.push(`❗ ${rel}: sem \`handle\` (comando: ${cmd.name ?? "(sem name)"})`);
  }

  if (Array.isArray(cmd.commands)) {
    const ownAliases = new Set();
    for (const raw of cmd.commands) {
      const name = String(raw)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "");
      // Aliases do MESMO arquivo que colidem depois da normalização (ex:
      // "deepseek" e "deep-seek") são inócuos: só marca colisão entre
      // arquivos diferentes.
      ownAliases.add(name);
    }
    for (const name of ownAliases) {
      if (!owner.has(name)) owner.set(name, []);
      owner.get(name).push(rel);
    }
  }
}

let duplicados = 0;
for (const [name, arquivoList] of owner) {
  if (arquivoList.length > 1) {
    duplicados += 1;
    problemas.push(`❗ "${name}" definido em: ${arquivoList.join(", ")}`);
  }
}

console.log(`Comandos verificados: ${files.length} arquivo(s)`);
if (problemas.length) {
  console.log("\nProblemas encontrados:");
  for (const problema of problemas) console.log(" -", problema);
  console.log(
    `\nTotal: ${problemas.length} problema(s) (${duplicados} nome(s) duplicado(s))`,
  );
  process.exitCode = 1;
} else {
  console.log("✅ Nenhum problema: todos têm `commands` + `handle` e não há duplicados.");
}
