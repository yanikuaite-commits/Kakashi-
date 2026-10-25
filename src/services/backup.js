import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  AUTH_DIR,
  DATABASE_DIR,
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
 *
 * `entry` é o nome canónico DENTRO do arquivo (é o que o restore espera);
 * `source` é onde o ficheiro vive nesta instalação. Separá-los é o que permite
 * `DATABASE_DIR`/`AUTH_DIR` apontarem para um volume: sem isto, o backup de um
 * volume montado fora do projeto arquivava a pasta vazia do repositório.
 */
const CANDIDATES = [
  { entry: "database", source: DATABASE_DIR, requiresAuth: false },
  { entry: ".env", source: path.join(projectRoot, ".env"), requiresAuth: false },
  { entry: "assets/auth/baileys", source: AUTH_DIR, requiresAuth: true },
];

function destinationFor(entry, targetRoot) {
  if (targetRoot) return path.join(targetRoot, entry);
  if (entry === "database") return DATABASE_DIR;
  if (entry === "assets/auth/baileys") return AUTH_DIR;
  return path.join(projectRoot, entry);
}

/**
 * Decide quais caminhos entram no arquivo. Exportado para os testes poderem
 * exercitar a regra da sessão sem falar com o GitHub.
 *
 * @param {{includeAuth?: boolean}} [options]
 * @returns {Promise<string[]>}
 */
export async function backupEntries({ includeAuth = false } = {}) {
  const entries = [];
  for (const { entry, source, requiresAuth } of CANDIDATES) {
    if (requiresAuth && !includeAuth) continue;
    try {
      await fs.access(source);
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

  // Copia para uma pasta de preparação com os nomes canónicos antes de
  // arquivar: assim o arquivo tem sempre a mesma estrutura, mesmo que a origem
  // seja um volume montado em `/data`.
  const stageDir = path.join(
    os.tmpdir(),
    `kakashi-backup-stage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  try {
    for (const entry of entries) {
      const { source } = CANDIDATES.find((candidate) => candidate.entry === entry);
      const staged = path.join(stageDir, entry);
      await fs.mkdir(path.dirname(staged), { recursive: true });
      await fs.cp(source, staged, { recursive: true, force: true });
    }
    await execFileAsync("tar", ["-czf", archivePath, "-C", stageDir, ...entries]);
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
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

/**
 * Restaura os dados a partir do GitHub.
 *
 * A sessão do WhatsApp que o arquivo trouxer é DESCARTADA, a não ser que o dono
 * a autorize com `restoreBackup({ includeAuth: true })`. Restaurar a sessão de
 * um backup substitui as chaves privadas do número por outras: se o arquivo for
 * antigo ou de outra instalação, o bot deixa de conseguir falar e fica ligado a
 * uma sessão que já não é a sua. Os dados (`database/`) e o `.env` são
 * restaurados sempre.
 *
 * @param {{includeAuth?: boolean}} [options]
 * @returns {Promise<{destination: string, includesSession: boolean}>}
 */
export async function restoreBackup({ includeAuth = false } = {}) {
  const config = githubConfig();
  if (!config) throw new Error("Configure GITHUB_TOKEN e GITHUB_REPOSITORY para restaurar pelo GitHub.");
  const endpoint = `/repos/${config.repository}/contents/${config.path}?ref=${encodeURIComponent(config.branch)}`;
  const data = await githubRequest(config, endpoint);
  const archivePath = path.join(os.tmpdir(), `kakashi-restore-${Date.now()}.tar.gz`);
  try {
    await fs.writeFile(archivePath, Buffer.from(data.content.replace(/\n/g, ""), "base64"));
    const { includesSession } = await applyArchive(archivePath, { includeAuth });
    return { destination: `${config.repository}/${config.path}`, includesSession };
  } finally {
    await fs.rm(archivePath, { force: true });
  }
}

/**
 * Aplica um arquivo de backup sobre a raiz do projeto.
 *
 * Extrai primeiro para um diretório temporário, para poder filtrar o que entra:
 * assim a sessão do WhatsApp é descartada antes de tocar no projeto, e o
 * conteúdo do arquivo nunca escreve diretamente na raiz.
 *
 * Exportado para os testes exercitarem o restauro real sem falar com o GitHub.
 *
 * @param {string} archivePath
 * @param {{includeAuth?: boolean, targetRoot?: string}} [options]
 * @returns {Promise<{includesSession: boolean}>}
 */
export async function applyArchive(archivePath, { includeAuth = false, targetRoot = null } = {}) {
  const stageDir = path.join(os.tmpdir(), `kakashi-restore-stage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    await fs.mkdir(stageDir, { recursive: true });
    await execFileAsync("tar", ["-xzf", archivePath, "-C", stageDir]);

    const includesSession = await pathExists(path.join(stageDir, "assets", "auth", "baileys"));
    if (includesSession && !includeAuth) {
      await fs.rm(path.join(stageDir, "assets"), { recursive: true, force: true });
    }

    for (const entry of await fs.readdir(stageDir)) {
      const destination = destinationFor(entry, targetRoot);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.cp(path.join(stageDir, entry), destination, {
        recursive: true,
        force: true,
      });
    }

    return { includesSession: includesSession && includeAuth };
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apaga o arquivo de backup do repositório remoto.
 *
 * Serve para fechar a exposição: um arquivo que já foi público fica no histórico
 * de commits do GitHub mesmo depois de apagado, portanto apagar só ajuda se o
 * repositório for privado e o ficheiro nunca tiver sido publicado.
 *
 * @returns {Promise<{destination: string}>}
 */
export async function deleteRemoteBackup() {
  const config = githubConfig();
  if (!config) throw new Error("Configure GITHUB_TOKEN e GITHUB_REPOSITORY para apagar o backup remoto.");
  const endpoint = `/repos/${config.repository}/contents/${config.path}`;
  let sha;
  try {
    sha = (await githubRequest(config, `${endpoint}?ref=${encodeURIComponent(config.branch)}`)).sha;
  } catch (error) {
    if (String(error.message).includes("HTTP 404")) {
      throw new Error("Não existe backup no GitHub para apagar.");
    }
    throw error;
  }
  await githubRequest(config, endpoint, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `backup: apagar arquivo a pedido do dono ${new Date().toISOString()}`,
      sha,
      branch: config.branch,
    }),
  });
  return { destination: `${config.repository}/${config.path}` };
}