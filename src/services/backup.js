import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  AUTH_DIR,
  BACKUP_INCLUDE_SESSION,
  BACKUP_INTERVAL_HOURS,
  BACKUP_RETENTION,
  BACKUP_TARGET,
  DATABASE_DIR,
  GITHUB_BACKUP_PATH,
  GITHUB_BRANCH,
  GITHUB_REPOSITORY,
} from "../config.js";
import { getGithubToken, readBackupState, saveBackupState } from "../utils/database.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { getActiveDriver } from "./remoteStore.js";
import {
  deleteBackups as deleteTursoBackups,
  listBackups as listTursoBackups,
  readBackup as readTursoBackup,
  saveBackup as saveTursoBackup,
} from "./turso.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);

function githubConfig() {
  // Lido em tempo de execução (não na importação) para o token definido pelo
  // `.set-github-token` valer já no backup seguinte, sem reiniciar o bot.
  const token = getGithubToken();
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
 * Decide se o envio deve ser recusado por o destino ser público.
 *
 * Separado da chamada de rede para poder ser testado sem falar com o GitHub
 * (mesmo padrão de `backupEntries` e `applyArchive`).
 *
 * @param {string} repository
 * @param {boolean} isPrivate
 * @param {{allowPublic?: boolean}} [options]
 * @returns {Error|null} o erro a lançar, ou `null` se o envio for permitido
 */
export function publicDestinationError(
  repository,
  isPrivate,
  { allowPublic = process.env.GITHUB_BACKUP_ALLOW_PUBLIC === "true" } = {},
) {
  if (isPrivate || allowPublic) return null;
  return new Error(
    `O repositório ${repository} é PÚBLICO e o backup leva o .env e os dados dos clientes. ` +
      "Use um repositório privado (GITHUB_REPOSITORY) ou, se souber o risco, defina GITHUB_BACKUP_ALLOW_PUBLIC=true.",
  );
}

/**
 * Recusa enviar o backup para um repositório público.
 *
 * O arquivo leva o `.env` (segredos) e o `database/` (créditos, pagamentos
 * pendentes e os LIDs dos clientes). Num repositório público isso fica à vista
 * de qualquer pessoa, e um ficheiro publicado continua acessível no histórico
 * de commits mesmo depois de apagado — apagar não desfaz a exposição.
 *
 * Verificado a cada envio porque a visibilidade do repositório pode mudar sem
 * que ninguém toque no código.
 */
async function assertBackupDestinationIsPrivate(config) {
  let repo;
  try {
    repo = await githubRequest(config, `/repos/${config.repository}`);
  } catch (error) {
    // O GitHub responde 404 (e não 403) a um token sem escopo `repo` que tenta
    // ler um repositório privado: "não existe" e "não tenho permissão" chegam
    // iguais. Sem esta nota o dono procuraria um repositório que está lá.
    if (String(error.message).includes("HTTP 404")) {
      throw new Error(
        `O GitHub não deu acesso a ${config.repository} (HTTP 404). Se o repositório existe e é privado, ` +
          "o GITHUB_TOKEN não tem o escopo `repo` — gere um token com esse escopo ou use `.set-github-token`.",
      );
    }
    throw error;
  }
  const error = publicDestinationError(config.repository, Boolean(repo.private));
  if (error) throw error;
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

  // Destino Turso: o arquivo fica numa linha da tabela, com histórico e poda.
  // Verificado antes do GitHub para o destino configurado mandar.
  if (BACKUP_TARGET === "turso") {
    return uploadToTurso({ archivePath, includesSession });
  }

  try {
    const config = githubConfig();
    if (!config) return { archivePath, github: false, includesSession };
    await assertBackupDestinationIsPrivate(config);
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
    // O arquivo local é um backup válido mesmo quando o envio remoto falha
    // (token expirado, sem rede, repositório público). Apagá-lo deixaria o dono
    // sem backup nenhum — foi o que acontecia no erro HTTP 401.
    error.archivePath = archivePath;
    throw error;
  }
}

/** Descrição legível do destino de um backup, para o log e as respostas. */
export function destinationLabel(resultado) {
  if (resultado.turso) {
    return `no Turso (${resultado.destination})`;
  }

  if (resultado.github) {
    return `no GitHub (${resultado.destination})`;
  }

  return `localmente (${resultado.archivePath})`;
}

/**
 * Guarda o arquivo no Turso.
 *
 * Diferente do envio para o GitHub, aqui cada backup é uma LINHA: há histórico
 * completo e a poda (`BACKUP_RETENTION`) limita o crescimento. É o que permite
 * desfazer uma eliminação acidental sem depender de um repositório.
 *
 * @param {{archivePath: string, includesSession: boolean}} options
 * @returns {Promise<{archivePath: string, turso: boolean, destination?: string, includesSession: boolean, pruned?: number}>}
 */
async function uploadToTurso({ archivePath, includesSession }) {
  const driver = getActiveDriver();

  if (!driver) {
    // Sem destino, o arquivo local continua a ser um backup válido.
    return { archivePath, turso: false, github: false, includesSession };
  }

  try {
    const data = (await fs.readFile(archivePath)).toString("base64");
    const { id, pruned } = await saveTursoBackup({
      data,
      includesSession,
      retention: BACKUP_RETENTION,
    });

    return {
      archivePath,
      turso: true,
      github: false,
      destination: `turso:${id}`,
      includesSession,
      pruned,
    };
  } catch (error) {
    // Mantém o arquivo local: sem isto o dono ficava sem backup nenhum quando
    // a rede falha (mesmo critério do envio para o GitHub).
    error.archivePath = archivePath;
    throw error;
  }
}

/**
 * Restaura os dados a partir de um backup guardado no Turso.
 *
 * A sessão do WhatsApp que o arquivo trouxer é DESCARTADA, a não ser que o dono
 * a autorize (mesma regra do restauro pelo GitHub): restaurar a sessão de um
 * backup substitui as chaves privadas por outras, e um arquivo antigo ligaria o
 * bot a uma sessão que já não é a sua.
 *
 * @param {{id?: number, includeAuth?: boolean}} [options]
 * @returns {Promise<{destination: string, includesSession: boolean, createdAt: string}>}
 */
export async function restoreBackupFromTurso({ id = 0, includeAuth = false } = {}) {
  const registro = await readTursoBackup({ id });

  if (!registro) {
    throw new Error("Não existe backup no Turso para restaurar.");
  }

  const archivePath = path.join(os.tmpdir(), `kakashi-restore-${Date.now()}.tar.gz`);

  try {
    await fs.writeFile(archivePath, Buffer.from(registro.data, "base64"));

    const { includesSession } = await applyArchive(archivePath, { includeAuth });

    return {
      destination: `turso:${registro.id}`,
      includesSession,
      createdAt: registro.createdAt,
    };
  } finally {
    await fs.rm(archivePath, { force: true });
  }
}

/**
 * Lista os backups guardados no Turso (mais recente primeiro).
 *
 * @returns {Promise<Array<{id: number, createdAt: string, includesSession: boolean, size: number}>>}
 */
export async function listTursoBackupHistory() {
  return listTursoBackups();
}

/**
 * Apaga backups do Turso.
 *
 * @param {{id?: number}} [options]
 * @returns {Promise<number>} quantos foram apagados
 */
export async function deleteTursoBackupHistory({ id = 0 } = {}) {
  return deleteTursoBackups({ id });
}

/**
 * Intervalo do backup automático em milissegundos.
 *
 * `0` (ou um valor inválido/negativo) significa "desligado": é o que permite
 * desligar o ciclo sem mexer no código.
 *
 * @param {number|string} horas
 * @returns {number} 0 quando desligado
 */
export function backupIntervalMs(horas = BACKUP_INTERVAL_HOURS) {
  const valor = Number(horas);
  return Number.isFinite(valor) && valor > 0 ? valor * 60 * 60 * 1000 : 0;
}

/**
 * Já passou o intervalo desde o último backup?
 *
 * A decisão é separada do temporizador para poder ser testada sem esperar 2
 * horas (mesmo padrão de `backupEntries` e `publicDestinationError`).
 *
 * Um `lastBackupAt` ausente ou ilegível conta como "nunca houve backup", para
 * uma instalação nova fazer o primeiro backup logo no arranque.
 *
 * @param {{lastBackupAt?: string, intervalMs: number, now?: number}} options
 * @returns {boolean}
 */
export function shouldBackupNow({ lastBackupAt, intervalMs, now = Date.now() }) {
  if (!intervalMs) return false;
  const ultimo = Date.parse(lastBackupAt || "") || 0;
  return now - ultimo >= intervalMs;
}

/**
 * Backup automático a cada `BACKUP_INTERVAL_HOURS` (2h por padrão).
 *
 * Não envia a sessão do Baileys (`includeAuth: false`): um backup desatendido
 * que carregasse as chaves privadas do número ficaria no repositório sem
 * ninguém a saber. Quem precisar da sessão usa `.backup sessao`.
 *
 * Falhas são registadas e engolidas — este ciclo nunca pode derrubar o bot nem
 * interromper a ligação do WhatsApp. O arquivo local sobrevive à falha de envio
 * (ver `createBackup`), portanto uma falha de rede ainda deixa o backup no
 * disco.
 *
 * `runBackup` é injetável para os testes exercitarem o agendamento sem fazer um
 * upload real para o GitHub.
 *
 * @param {{runBackup?: typeof createBackup}} [options]
 * @returns {NodeJS.Timeout|null} o temporizador, ou `null` se estiver desligado
 */
export function startBackupScheduler({ runBackup = createBackup } = {}) {
  const intervalMs = backupIntervalMs();

  if (!intervalMs) {
    infoLog("[backup] automático desligado (BACKUP_INTERVAL_HOURS=0).");
    return null;
  }

  const correr = async (motivo) => {
    try {
      const resultado = await runBackup({
        includeAuth: BACKUP_INCLUDE_SESSION,
      });
      saveBackupState({
        lastBackupAt: new Date().toISOString(),
        lastBackupOk: true,
        lastBackupError: "",
        lastDestination: resultado.destination || resultado.archivePath,
      });
      infoLog(
        `[backup] ${motivo}: salvo ${destinationLabel(resultado)}` +
          (resultado.pruned ? ` (${resultado.pruned} antigo(s) apagado(s))` : "") +
          ".",
      );
    } catch (error) {
      // O estado é gravado mesmo em falha: assim o próximo ciclo espera o
      // intervalo inteiro em vez de tentar de novo a cada arranque.
      try {
        saveBackupState({
          lastBackupAt: new Date().toISOString(),
          lastBackupOk: false,
          lastBackupError: String(error.message || error).slice(0, 200),
        });
      } catch (stateError) {
        errorLog(`[backup] não foi possível gravar o estado: ${stateError.message}`);
      }
      errorLog(`[backup] ${motivo} falhou: ${error.message}`);
    }
  };

  const state = readBackupState();

  if (shouldBackupNow({ lastBackupAt: state.lastBackupAt, intervalMs })) {
    // Primeiro ciclo depois de um restart com o intervalo já vencido: corre
    // agora, para não ficar até 2h sem backup por causa de um deploy.
    correr("backup inicial").catch(() => {});
  } else {
    const decorrido = Date.now() - (Date.parse(state.lastBackupAt || "") || 0);
    const faltam = Math.ceil((intervalMs - decorrido) / 60000);
    infoLog(
      `[backup] último backup há ${Math.floor(decorrido / 60000)} min; o próximo é dentro de ~${faltam} min.`,
    );
  }

  const timer = setInterval(() => correr("backup periódico").catch(() => {}), intervalMs);
  timer.unref?.();

  return timer;
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