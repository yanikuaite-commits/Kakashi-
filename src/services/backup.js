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

async function createArchive() {
  const archivePath = path.join(os.tmpdir(), `kakashi-backup-${Date.now()}.tar.gz`);
  const candidates = ["database", ".env", "assets/auth/baileys"];
  const entries = [];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(projectRoot, candidate));
      entries.push(candidate);
    } catch {
      // O arquivo pode não existir em uma instalação nova.
    }
  }
  if (!entries.length) throw new Error("Não há dados disponíveis para criar o backup.");
  await execFileAsync("tar", ["-czf", archivePath, "-C", projectRoot, ...entries]);
  return archivePath;
}

export async function createBackup() {
  const archivePath = await createArchive();
  try {
    const config = githubConfig();
    if (!config) return { archivePath, github: false };
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
    return { archivePath, github: true, destination: `${config.repository}/${config.path}` };
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