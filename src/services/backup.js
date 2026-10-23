import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  GITHUB_BACKUP_PATH,
  GITHUB_BRANCH,
  GITHUB_REPOSITORY,
  GITHUB_TOKEN,
} from "../config.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);

function githubConfig() {
  const token = GITHUB_TOKEN;
  const repository = GITHUB_REPOSITORY;
  if (!token || !repository?.includes("/")) return null;
  return {
    token,
    repository,
    branch: GITHUB_BRANCH,
    path: GITHUB_BACKUP_PATH,
  };
}

async function githubRequest(config, endpoint, options = {}) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub retornou HTTP ${response.status}.`);
  return response.status === 204 ? null : response.json();
}

/**
 * Candidatos a backup, com o que exigem.
 *
 * `database/` é o estado do bot (créditos, pagamentos pendentes, avisos,
 * prefixos, silenciados, restrições). O `.env` traz os segredos.
 *
 * `assets/auth/baileys` é a SESSÃO do WhatsApp: as chaves privadas de
 * pareamento. Quem tiver esse ficheiro fala pelo número do bot, por isso ele
 * NÃO entra no backup sem pedido explícito do dono.
 */
const CANDIDATES = [
  { entry: "database", requiresAuth: false },
  { entry: ".env", requiresAuth: false },
  { entry: "assets/auth/baileys", requiresAuth: true },
];

/**
 * Decide quais caminhos entram no arquivo. Exportado para os testes poderem
 * exercitar a regra da sessão sem falar com o GitHub.
 *
 * @param {{includeAuth?: boolean}} [options]
 * @returns {Promise<string[]>}
 */
export async function backupEntries({ includeAuth = false } = {}) {
  const entries = [];
  for (const { entry, requiresAuth } of CANDIDATES) {
    if (requiresAuth && !includeAuth) continue;
    try {
      await fs.access(path.join(projectRoot, entry));
      entries.push(entry);
    } catch {
      // O arquivo pode não existir em uma instalação nova.
    }
  }
  return entries;
}

async function createArchive({ includeAuth = false } = {}) {
  const archivePath = path.join(os.tmpdir(), `kakashi-backup-${Date.now()}.tar.gz`);
  const entries = await backupEntries({ includeAuth });
  if (!entries.length) throw new Error("Não há dados disponíveis para criar o backup.");
  await execFileAsync("tar", ["-czf", archivePath, "-C", projectRoot, ...entries]);
  return { archivePath, entries };
}

/**
 * Cria o backup dos dados do bot.
 *
 * A sessão do Baileys só entra com `includeAuth: true`, que o comando
 * `.backup sessao` traduz. Sem isso, o arquivo leva só o `database/` e o `.env`.
 *
 * @param {{includeAuth?: boolean}} [options]
 * @returns {Promise<{archivePath: string, github: boolean, destination?: string, includesSession: boolean}>}
 */
export async function createBackup({ includeAuth = false } = {}) {
  const { archivePath, entries } = await createArchive({ includeAuth });
  const includesSession = entries.includes("assets/auth/baileys");
  try {
    const config = githubConfig();
    if (!config) return { archivePath, github: false, includesSession };
    const content = (await fs.readFile(archivePath)).toString("base64");
    const endpoint = `/repos/${config.repository}/contents/${config.path}`;
    let sha;
    try {
      sha = (await githubRequest(config, `${endpoint}?ref=${encodeURIComponent(config.branch)}`)).sha;
    } catch (error) {
      if (!String(error.message).includes("HTTP 404")) throw error;
    }
    await githubRequest(config, endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `backup: Kakashi ${new Date().toISOString()}`,
        content,
        branch: config.branch,
        ...(sha ? { sha } : {}),
      }),
    });
    return { archivePath, github: true, destination: `${config.repository}/${config.path}`, includesSession };
  } catch (error) {
    await fs.rm(archivePath, { force: true });
    throw error;
  }
}

export async function restoreBackup() {
  const config = githubConfig();
  if (!config) throw new Error("Configure GITHUB_TOKEN e GITHUB_REPOSITORY para restaurar pelo GitHub.");
  const endpoint = `/repos/${config.repository}/contents/${config.path}?ref=${encodeURIComponent(config.branch)}`;
  const data = await githubRequest(config, endpoint);
  const archivePath = path.join(os.tmpdir(), `kakashi-restore-${Date.now()}.tar.gz`);
  try {
    await fs.writeFile(archivePath, Buffer.from(data.content.replace(/\n/g, ""), "base64"));
    await execFileAsync("tar", ["-xzf", archivePath, "-C", projectRoot]);
    return `${config.repository}/${config.path}`;
  } finally {
    await fs.rm(archivePath, { force: true });
  }
}