/**
 * Funções úteis para trabalhar
 * com dados.
 *
 * @author Dev Yanik
 */
import fs from "node:fs";
import path from "node:path";
import {
  DATABASE_DIR,
  MONGODB_FLUSH_DEBOUNCE_MS,
  MONGODB_FLUSH_RETRY_MS,
  PREFIX,
  SESSION_STATE_NAME,
  GITHUB_TOKEN,
  SPIDER_API_TOKEN,
} from "../config.js";
import {
  getActiveDriver,
  isRemoteEnabled,
} from "../services/remoteStore.js";
import { restoreSession } from "../services/sessionStore.js";
import { infoLog, warningLog } from "./logger.js";

const databasePath = DATABASE_DIR;

// O volume persistente monta num caminho que pode vir vazio (ou não existir)
// no primeiro arranque. Sem o mkdir, a primeira escrita rebenta com ENOENT e o
// bot morre antes de responder — o `database/` só existe na imagem porque os
// JSON versionados o criam, e o `.dockerignore` exclui-os.
fs.mkdirSync(databasePath, { recursive: true });

const AFK_GROUPS_FILE = "afk-groups";
const ANTI_LINK_GROUPS_FILE = "anti-link-groups";
const AUTO_RESPONDER_FILE = "auto-responder";
const AUTO_RESPONDER_GROUPS_FILE = "auto-responder-groups";
const AUTO_STICKER_GROUPS_FILE = "auto-sticker-groups";
const CONFIG_FILE = "config";
const EXIT_GROUPS_FILE = "exit-groups";
const GROUP_RESTRICTIONS_FILE = "group-restrictions";
const INACTIVE_GROUPS_FILE = "inactive-groups";
const MUTE_FILE = "muted";
const ONLY_ADMINS_FILE = "only-admins";
const PREFIX_GROUPS_FILE = "prefix-groups";
const RESTRICTED_MESSAGES_FILE = "restricted-messages";
const WELCOME_GROUPS_FILE = "welcome-groups";
const BOT_STATE_FILE = "bot-state";
const PRIVATE_WHITELIST_FILE = "private-whitelist";
const BACKUP_STATE_FILE = "backup-state";
const BLOCKED_COMMANDS_FILE = "blocked-commands";
const CREDITS_FILE = "credits";
const SUBSCRIPTIONS_FILE = "subscriptions";
const PENDING_RECHARGES_FILE = "pending-recharges";
const RATE_LIMIT_FILE = "rate-limit";
const BLACKLIST_FILE = "blacklist";
const ACTIVITY_FILE = "activity";
const SYSTEM_SAMPLES_FILE = "system-samples";

function createIfNotExists(fullPath, formatIfNotExists = []) {
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, JSON.stringify(formatIfNotExists));
  }
}

/** O valor lido tem a forma esperada pelo chamador? */
function hasExpectedShape(value, fallback) {
  if (Array.isArray(fallback)) {
    return Array.isArray(value);
  }

  return (
    typeof fallback === "object" &&
    fallback !== null &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function readJSON(jsonFile, formatIfNotExists = []) {
  const fullPath = path.resolve(databasePath, `${jsonFile}.json`);

  createIfNotExists(fullPath, formatIfNotExists);

  const raw = fs.readFileSync(fullPath, "utf8");

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    // Ficheiro truncado (escrita interrompida, disco cheio). O conteúdo não é
    // recuperável, mas deixá-lo lá faz TODA a leitura seguinte rebentar: o bot
    // fica inutilizável até alguém apagar o ficheiro à mão.
    infoLog(`[database] ${jsonFile}.json ilegível; a repor o valor padrão`);
    writeJSON(jsonFile, formatIfNotExists, formatIfNotExists);
    return formatIfNotExists;
  }

  // Auto-reparo: um ficheiro com a forma errada é reescrito com o padrão.
  //
  // Aconteceu em produção com `muted.json`: o valor padrão foi gravado já
  // serializado (`JSON.stringify({})` como default), o ficheiro ficou com a
  // string `"{}"` e `JSON.parse` devolvia uma string. A partir daí, atribuir uma
  // chave rebentava com "Cannot create property ... on string '{}'" e o `mute`
  // nunca funcionava. Só corrigir a chamada não bastava: o ficheiro corrompido
  // continuava em disco, por isso a leitura repara-o.
  if (!hasExpectedShape(parsed, formatIfNotExists)) {
    infoLog(`[database] ${jsonFile}.json com forma inesperada; a repor o padrão`);
    writeJSON(jsonFile, formatIfNotExists, formatIfNotExists);
    return formatIfNotExists;
  }

  return parsed;
}

function writeJSON(jsonFile, data, formatIfNotExists = []) {
  const fullPath = path.resolve(databasePath, `${jsonFile}.json`);

  createIfNotExists(fullPath, formatIfNotExists);

  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf8");

  scheduleRemoteFlush(jsonFile);
}

/* ══════════════════════════════════════════════════════════════════════════
 * ESPELHO REMOTO (MongoDB ou Turso)
 *
 * O disco continua a ser a cache de leitura (é o que os 69 chamadores síncronos
 * e os testes leem), e um destino remoto passa a ser durável: sem isto, um
 * deploy num host de disco efémero apagava créditos, assinaturas e pareamento.
 *
 * Qual destino está ativo é decidido em `src/services/remoteStore.js`, por isso
 * este ficheiro não sabe se grava no Mongo ou no Turso.
 *
 * As escritas são agrupadas (debounce) porque o anti-flood e os créditos
 * escrevem em rajada; um pedido por escrita multiplicaria round-trips.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Nomes de ficheiro com alterações ainda não gravadas. */
const pendingFlush = new Set();
let flushTimer = null;
let flushRunning = null;
let lastFlushError = null;

/** Erro da última gravação (null quando correu bem). */
export function getLastFlushError() {
  return lastFlushError;
}

/** Há alterações à espera de gravação? */
export function hasPendingFlush() {
  return pendingFlush.size > 0;
}

function scheduleRemoteFlush(jsonFile) {
  // Regista sempre que haja destino configurado, mesmo com a ligação em baixo:
  // uma alteração feita durante uma queda de rede tem de chegar ao destino
  // quando a ligação voltar. Se só registasse com a ligação de pé, tudo o que
  // fosse escrito durante a queda perdia-se em silêncio no deploy seguinte —
  // exatamente o problema que o destino remoto veio resolver.
  if (!isRemoteEnabled()) {
    return;
  }

  pendingFlush.add(jsonFile);

  if (flushTimer) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushRemoteState();
  }, MONGODB_FLUSH_DEBOUNCE_MS);

  // O timer não deve segurar o processo aberto.
  flushTimer.unref?.();
}

/**
 * Grava no destino remoto todas as alterações pendentes.
 *
 * Nunca lança: uma falha de rede não pode derrubar o bot nem perder a alteração
 * local (o ficheiro em disco já tem o valor novo, e o nome volta à fila).
 *
 * @returns {Promise<boolean>} `true` quando não ficou nada pendente.
 */
export async function flushRemoteState() {
  const driver = getActiveDriver();

  if (!driver) {
    return true;
  }

  // Uma gravação em curso é reaproveitada: dois flushes concorrentes não devem
  // escrever o mesmo estado ao mesmo tempo.
  if (flushRunning) {
    return flushRunning;
  }

  if (!pendingFlush.size) {
    return true;
  }

  // A ligação caiu (ou nunca se estabeleceu): tenta recuperar antes de
  // desistir, para que uma queda temporária não deixe dados por sincronizar.
  if (!driver.isConnected() && !(await driver.connect())) {
    scheduleFlushRetry();

    return false;
  }

  const names = [...pendingFlush];
  pendingFlush.clear();

  flushRunning = (async () => {
    try {
      await driver.writeMany(
        names.map((name) => ({
          name,
          data: readJSONForRemote(name),
        })),
      );

      lastFlushError = null;

      return true;
    } catch (error) {
      lastFlushError = error;

      warningLog(
        `[database] gravação remota falhou (${error.message}); a manter os dados locais`,
      );

      // Devolve os nomes à fila e tenta de novo mais tarde.
      for (const name of names) {
        pendingFlush.add(name);
      }

      scheduleFlushRetry();

      return false;
    } finally {
      flushRunning = null;
    }
  })();

  return flushRunning;
}

/** Agenda uma nova tentativa de gravação depois de uma falha. */
function scheduleFlushRetry() {
  if (flushTimer) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushRemoteState();
  }, MONGODB_FLUSH_RETRY_MS);

  flushTimer.unref?.();
}

/** Lê o ficheiro de disco para envio remoto (sem recursão/auto-reparo). */
function readJSONForRemote(jsonFile) {
  try {
    const fullPath = path.resolve(databasePath, `${jsonFile}.json`);
    const raw = fs.readFileSync(fullPath, "utf8");

    return sanitizeForRemote(jsonFile, JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Lê o ficheiro de disco tal como está, sem limpeza.
 *
 * Usado para recuperar segredos locais durante o restore: eles nunca vão para o
 * destino remoto, por isso a única cópia é a do disco.
 */
function readJSONFromDiskLocal(jsonFile) {
  try {
    const fullPath = path.resolve(databasePath, `${jsonFile}.json`);
    const raw = fs.readFileSync(fullPath, "utf8");

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Remove do que vai para o destino remoto o que nunca deve lá estar.
 *
 * `config.json` é espelhado porque guarda tokens que o dono define pelo
 * WhatsApp (`github_token`, `spider_api_token`) e que devem sobreviver a um
 * deploy. As exceções são as credenciais do próprio destino
 * (`mongodb_uri`, `turso_url`, `turso_auth_token`): copiar a password da base
 * de dados para dentro dela própria transformaria um acesso de leitura num
 * acesso total, e vazaria a credencial em qualquer export.
 */
function sanitizeForRemote(jsonFile, value) {
  if (jsonFile !== "config" || !value || typeof value !== "object") {
    return value;
  }

  const {
    mongodb_uri: _uriMongo,
    turso_url: _urlTurso,
    turso_auth_token: _tokenTurso,
    ...rest
  } = value;

  return rest;
}

/** Credenciais locais que o restore não pode perder (nunca vão para remoto). */
const LOCAL_ONLY_SECRETS = [
  "mongodb_uri",
  "turso_url",
  "turso_auth_token",
];

/**
 * Carrega o estado durável e liga o espelho.
 *
 * Ordem: liga ao destino → escreve no disco cada estado que exista lá (o
 * destino é a fonte de verdade, porque sobrevive aos deploys) → envia para o
 * destino os ficheiros que só existam no disco (primeira execução).
 *
 * Nunca lança: sem destino configurado, ou com a ligação em baixo, o bot
 * arranca e serve-se do disco, exatamente como antes.
 *
 * @returns {Promise<boolean>} `true` quando o espelho está ativo.
 */
export async function initDatabase() {
  const driver = getActiveDriver();

  if (!driver) {
    return false;
  }

  const client = await driver.connect();

  if (!client) {
    return false;
  }

  try {
    const entries = await driver.readAll();
    const restored = [];

    for (const { name, data } of entries) {
      if (data === null || data === undefined) {
        continue;
      }

      // A sessão do WhatsApp não é um `database/*.json`: é um blob com os
      // ficheiros de `assets/auth/baileys/`. Restaurá-la ANTES do `connect()`
      // (o `initDatabase` corre primeiro) é o que faz o bot arrancar já
      // autenticado, sem pedir um novo pareamento a cada deploy.
      if (name === SESSION_STATE_NAME) {
        if (restoreSession(data)) {
          restored.push(name);
        }

        continue;
      }

      let value = data;

      // O `config.json` restaurado não pode trazer de volta credenciais do
      // destino: o documento remoto não as tem (ver `sanitizeForRemote`), e o
      // ficheiro local é quem as guarda. Sem isto, um restore apagava-as e o bot
      // perdia a ligação no arranque seguinte.
      if (name === "config") {
        const local = readJSONFromDiskLocal(name);

        if (local && typeof local === "object") {
          const preservados = {};

          for (const key of LOCAL_ONLY_SECRETS) {
            if (local[key]) {
              preservados[key] = local[key];
            }
          }

          value = { ...value, ...preservados };
        }
      }

      // Escreve direto no disco: `writeJSON` marcaria o nome como pendente e
      // provocaria um flush imediato do que acabámos de ler.
      const fullPath = path.resolve(databasePath, `${name}.json`);

      fs.writeFileSync(fullPath, JSON.stringify(value, null, 2), "utf8");

      restored.push(name);
    }

    // Primeira execução com o destino vazio: sobe o que já existe em disco.
    // O `config.json` também é enviado (é assim que os tokens definidos pelo
    // dono sobrevivem a um deploy); as credenciais são removidas por
    // `sanitizeForRemote` antes de sair.
    const localFiles = fs
      .readdirSync(databasePath)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.replace(/\.json$/, ""));

    for (const name of localFiles) {
      if (!restored.includes(name)) {
        pendingFlush.add(name);
      }
    }

    infoLog(
      `[database] ${driver.name} ativo: ${restored.length} estado(s) restaurado(s)` +
        (pendingFlush.size ? `, ${pendingFlush.size} para enviar` : ""),
    );

    if (pendingFlush.size) {
      await flushRemoteState();
    }

    return true;
  } catch (error) {
    warningLog(
      `[database] carga inicial do ${driver.name} falhou (${error.message}); a usar o disco`,
    );

    return false;
  }
}

export function setAfkMember(groupId, memberId, reason) {
  const afkGroups = readJSON(AFK_GROUPS_FILE, {});

  if (!afkGroups[groupId]) {
    afkGroups[groupId] = {};
  }

  afkGroups[groupId][memberId] = reason.trim();

  writeJSON(AFK_GROUPS_FILE, afkGroups, {});
}

export function getAfkReason(groupId, memberId) {
  const afkGroups = readJSON(AFK_GROUPS_FILE, {});

  return afkGroups[groupId]?.[memberId] || null;
}

export function listAfkMembers(groupId) {
  const afkGroups = readJSON(AFK_GROUPS_FILE, {});

  return { ...(afkGroups[groupId] || {}) };
}

export function removeAfkMember(groupId, memberId) {
  const afkGroups = readJSON(AFK_GROUPS_FILE, {});

  if (!afkGroups[groupId]?.[memberId]) {
    return false;
  }

  delete afkGroups[groupId][memberId];

  if (!Object.keys(afkGroups[groupId]).length) {
    delete afkGroups[groupId];
  }

  writeJSON(AFK_GROUPS_FILE, afkGroups, {});

  return true;
}

export function activateExitGroup(groupId) {
  const filename = EXIT_GROUPS_FILE;

  const exitGroups = readJSON(filename);

  if (!exitGroups.includes(groupId)) {
    exitGroups.push(groupId);
  }

  writeJSON(filename, exitGroups);
}

export function deactivateExitGroup(groupId) {
  const filename = EXIT_GROUPS_FILE;

  const exitGroups = readJSON(filename);

  const index = exitGroups.indexOf(groupId);

  if (index === -1) {
    return;
  }

  exitGroups.splice(index, 1);

  writeJSON(filename, exitGroups);
}

export function isActiveExitGroup(groupId) {
  const filename = EXIT_GROUPS_FILE;

  const exitGroups = readJSON(filename);

  return exitGroups.includes(groupId);
}

export function activateWelcomeGroup(groupId) {
  const filename = WELCOME_GROUPS_FILE;

  const welcomeGroups = readJSON(filename);

  if (!welcomeGroups.includes(groupId)) {
    welcomeGroups.push(groupId);
  }

  writeJSON(filename, welcomeGroups);
}

export function deactivateWelcomeGroup(groupId) {
  const filename = WELCOME_GROUPS_FILE;

  const welcomeGroups = readJSON(filename);

  const index = welcomeGroups.indexOf(groupId);

  if (index === -1) {
    return;
  }

  welcomeGroups.splice(index, 1);

  writeJSON(filename, welcomeGroups);
}

export function isActiveWelcomeGroup(groupId) {
  const filename = WELCOME_GROUPS_FILE;

  const welcomeGroups = readJSON(filename);

  return welcomeGroups.includes(groupId);
}

export function activateGroup(groupId) {
  const filename = INACTIVE_GROUPS_FILE;

  const inactiveGroups = readJSON(filename);

  const index = inactiveGroups.indexOf(groupId);

  if (index === -1) {
    return;
  }

  inactiveGroups.splice(index, 1);

  writeJSON(filename, inactiveGroups);
}

export function deactivateGroup(groupId) {
  const filename = INACTIVE_GROUPS_FILE;

  const inactiveGroups = readJSON(filename);

  if (!inactiveGroups.includes(groupId)) {
    inactiveGroups.push(groupId);
  }

  writeJSON(filename, inactiveGroups);
}

export function isActiveGroup(groupId) {
  const filename = INACTIVE_GROUPS_FILE;

  const inactiveGroups = readJSON(filename);

  return !inactiveGroups.includes(groupId);
}

export function isBotEnabled() {
  return readJSON(BOT_STATE_FILE, { enabled: false }).enabled === true;
}

export function setBotEnabled(enabled) {
  writeJSON(BOT_STATE_FILE, { enabled: Boolean(enabled) }, { enabled: false });
}

export function getPrivateWhitelist() {
  return readJSON(PRIVATE_WHITELIST_FILE, []);
}

export function isPrivateWhitelisted(jid) {
  return getPrivateWhitelist().includes(jid);
}

export function addPrivateWhitelist(jid) {
  const entries = getPrivateWhitelist();
  if (!entries.includes(jid)) entries.push(jid);
  writeJSON(PRIVATE_WHITELIST_FILE, entries, []);
}

export function removePrivateWhitelist(jid) {
  const entries = getPrivateWhitelist().filter((entry) => entry !== jid);
  writeJSON(PRIVATE_WHITELIST_FILE, entries, []);
}

export function getBlockedCommands() {
  return readJSON(BLOCKED_COMMANDS_FILE, []);
}

function normalizeBlockedCommand(commandName) {
  return String(commandName || "").trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

export function isCommandBlocked(commandName) {
  const name = normalizeBlockedCommand(commandName);
  return !!name && getBlockedCommands().some((item) => normalizeBlockedCommand(item) === name);
}

export function blockCommand(commandName) {
  const normalized = normalizeBlockedCommand(commandName);
  if (!normalized) return;
  const commands = getBlockedCommands();
  if (!commands.some((item) => normalizeBlockedCommand(item) === normalized)) commands.push(normalized);
  writeJSON(BLOCKED_COMMANDS_FILE, commands, []);
}

export function unblockCommand(commandName) {
  const normalized = normalizeBlockedCommand(commandName);
  if (!normalized) return;
  writeJSON(BLOCKED_COMMANDS_FILE, getBlockedCommands().filter((command) => normalizeBlockedCommand(command) !== normalized), []);
}

export function getAutoResponderResponse(match) {
  const filename = AUTO_RESPONDER_FILE;

  const responses = readJSON(filename);

  const matchUpperCase = match.toLocaleUpperCase();

  const data = responses.find(
    (response) => response.match.toLocaleUpperCase() === matchUpperCase
  );

  if (!data) {
    return null;
  }

  return data.answer;
}

export function activateAutoResponderGroup(groupId) {
  const filename = AUTO_RESPONDER_GROUPS_FILE;

  const autoResponderGroups = readJSON(filename);

  if (!autoResponderGroups.includes(groupId)) {
    autoResponderGroups.push(groupId);
  }

  writeJSON(filename, autoResponderGroups);
}

export function deactivateAutoResponderGroup(groupId) {
  const filename = AUTO_RESPONDER_GROUPS_FILE;

  const autoResponderGroups = readJSON(filename);

  const index = autoResponderGroups.indexOf(groupId);

  if (index === -1) {
    return;
  }

  autoResponderGroups.splice(index, 1);

  writeJSON(filename, autoResponderGroups);
}

export function isActiveAutoResponderGroup(groupId) {
  const filename = AUTO_RESPONDER_GROUPS_FILE;

  const autoResponderGroups = readJSON(filename);

  return autoResponderGroups.includes(groupId);
}

export function activateAntiLinkGroup(groupId) {
  const filename = ANTI_LINK_GROUPS_FILE;

  const antiLinkGroups = readJSON(filename);

  if (!antiLinkGroups.includes(groupId)) {
    antiLinkGroups.push(groupId);
  }

  writeJSON(filename, antiLinkGroups);
}

export function deactivateAntiLinkGroup(groupId) {
  const filename = ANTI_LINK_GROUPS_FILE;

  const antiLinkGroups = readJSON(filename);

  const index = antiLinkGroups.indexOf(groupId);

  if (index === -1) {
    return;
  }

  antiLinkGroups.splice(index, 1);

  writeJSON(filename, antiLinkGroups);
}

export function isActiveAntiLinkGroup(groupId) {
  const filename = ANTI_LINK_GROUPS_FILE;

  const antiLinkGroups = readJSON(filename);

  return antiLinkGroups.includes(groupId);
}

export function activateAutoStickerGroup(groupId) {
  const filename = AUTO_STICKER_GROUPS_FILE;

  const autoStickerGroups = readJSON(filename);

  if (!autoStickerGroups.includes(groupId)) {
    autoStickerGroups.push(groupId);
  }

  writeJSON(filename, autoStickerGroups);
}

export function deactivateAutoStickerGroup(groupId) {
  const filename = AUTO_STICKER_GROUPS_FILE;

  const autoStickerGroups = readJSON(filename);

  const index = autoStickerGroups.indexOf(groupId);

  if (index === -1) {
    return;
  }

  autoStickerGroups.splice(index, 1);

  writeJSON(filename, autoStickerGroups);
}

export function isActiveAutoStickerGroup(groupId) {
  const filename = AUTO_STICKER_GROUPS_FILE;

  const autoStickerGroups = readJSON(filename);

  return autoStickerGroups.includes(groupId);
}

export function muteMember(groupId, memberId) {
  const filename = MUTE_FILE;

  const mutedMembers = readJSON(filename, {});

  if (!mutedMembers[groupId]) {
    mutedMembers[groupId] = [];
  }

  if (!mutedMembers[groupId]?.includes(memberId)) {
    mutedMembers[groupId].push(memberId);
  }

  writeJSON(filename, mutedMembers);
}

export function unmuteMember(groupId, memberId) {
  const filename = MUTE_FILE;

  const mutedMembers = readJSON(filename, {});

  if (!mutedMembers[groupId]) {
    return;
  }

  const index = mutedMembers[groupId].indexOf(memberId);

  if (index !== -1) {
    mutedMembers[groupId].splice(index, 1);
  }

  writeJSON(filename, mutedMembers);
}

export function checkIfMemberIsMuted(groupId, memberId) {
  const filename = MUTE_FILE;

  const mutedMembers = readJSON(filename, {});

  if (!mutedMembers[groupId]) {
    return false;
  }

  return mutedMembers[groupId]?.includes(memberId);
}

export function activateOnlyAdmins(groupId) {
  const filename = ONLY_ADMINS_FILE;

  const onlyAdminsGroups = readJSON(filename, []);

  if (!onlyAdminsGroups.includes(groupId)) {
    onlyAdminsGroups.push(groupId);
  }

  writeJSON(filename, onlyAdminsGroups);
}

export function deactivateOnlyAdmins(groupId) {
  const filename = ONLY_ADMINS_FILE;

  const onlyAdminsGroups = readJSON(filename, []);

  const index = onlyAdminsGroups.indexOf(groupId);
  if (index === -1) {
    return;
  }

  onlyAdminsGroups.splice(index, 1);

  writeJSON(filename, onlyAdminsGroups);
}

export function isActiveOnlyAdmins(groupId) {
  const filename = ONLY_ADMINS_FILE;

  const onlyAdminsGroups = readJSON(filename, []);

  return onlyAdminsGroups.includes(groupId);
}

export function readGroupRestrictions() {
  return readJSON(GROUP_RESTRICTIONS_FILE, {});
}

export function saveGroupRestrictions(restrictions) {
  writeJSON(GROUP_RESTRICTIONS_FILE, restrictions, {});
}

export function isActiveGroupRestriction(groupId, restriction) {
  const restrictions = readGroupRestrictions();

  if (!restrictions[groupId]) {
    return false;
  }

  return restrictions[groupId][restriction] === true;
}

export function updateIsActiveGroupRestriction(groupId, restriction, isActive) {
  const restrictions = readGroupRestrictions();

  if (!restrictions[groupId]) {
    restrictions[groupId] = {};
  }

  restrictions[groupId][restriction] = isActive;

  saveGroupRestrictions(restrictions);
}

export function readRestrictedMessageTypes() {
  return readJSON(RESTRICTED_MESSAGES_FILE, {
    sticker: "stickerMessage",
    video: "videoMessage",
    image: "imageMessage",
    audio: "audioMessage",
    product: "productMessage",
    document: "documentMessage",
    event: "eventMessage",
  });
}

export function setPrefix(groupJid, prefix) {
  const filename = PREFIX_GROUPS_FILE;

  const prefixGroups = readJSON(filename, {});

  prefixGroups[groupJid] = prefix;

  writeJSON(filename, prefixGroups, {});
}

export function getPrefix(groupJid) {
  const filename = PREFIX_GROUPS_FILE;

  const prefixGroups = readJSON(filename, {});

  return prefixGroups[groupJid] || PREFIX;
}

export function listAutoResponderItems() {
  const filename = AUTO_RESPONDER_FILE;
  const responses = readJSON(filename, []);

  return responses.map((item, index) => ({
    key: index + 1,
    match: item.match,
    answer: item.answer,
  }));
}

export function addAutoResponderItem(match, answer) {
  const filename = AUTO_RESPONDER_FILE;
  const responses = readJSON(filename, []);

  const matchUpperCase = match.toLocaleUpperCase();

  const existingItem = responses.find(
    (response) => response.match.toLocaleUpperCase() === matchUpperCase
  );

  if (existingItem) {
    return false;
  }

  responses.push({
    match: match.trim(),
    answer: answer.trim(),
  });

  writeJSON(filename, responses, []);

  return true;
}

export function removeAutoResponderItemByKey(key) {
  const filename = AUTO_RESPONDER_FILE;
  const responses = readJSON(filename, []);

  const index = key - 1;

  if (index < 0 || index >= responses.length) {
    return false;
  }

  responses.splice(index, 1);

  writeJSON(filename, responses, []);

  return true;
}

export function setSpiderApiToken(token) {
  const filename = CONFIG_FILE;

  const config = readJSON(filename, {});

  config.spider_api_token = token;

  writeJSON(filename, config, {});
}

export function getSpiderApiToken() {
  const filename = CONFIG_FILE;

  const config = readJSON(filename, {});

  return config.spider_api_token || SPIDER_API_TOKEN;
}

/**
 * Token do GitHub para o backup remoto.
 *
 * Mesmo padrão do token da Spider: o valor definido pelo `.set-github-token`
 * (guardado em `database/config.json`, que não é versionado) tem prioridade, e
 * `GITHUB_TOKEN` do ambiente serve de valor inicial. Assim o que o dono define
 * pelo WhatsApp não é silenciosamente substituído pelo ambiente.
 */
export function setGithubToken(token) {
  const filename = CONFIG_FILE;

  const config = readJSON(filename, {});

  config.github_token = token;

  writeJSON(filename, config, {});
}

export function getGithubToken() {
  const filename = CONFIG_FILE;

  const config = readJSON(filename, {});

  return config.github_token || GITHUB_TOKEN;
}

/**
 * Contas de créditos por usuário (chave = LID/JID).
 * A regra de negócio fica em src/services/credits.js.
 */
export function readCreditsAccounts() {
  return readJSON(CREDITS_FILE, {});
}

export function saveCreditsAccounts(accounts) {
  writeJSON(CREDITS_FILE, accounts, {});
}

/**
 * Assinaturas ativas por usuário (chave = LID/JID).
 * A regra de negócio fica em src/services/subscriptions.js.
 */
export function readSubscriptions() {
  return readJSON(SUBSCRIPTIONS_FILE, {});
}

export function saveSubscriptions(subscriptions) {
  writeJSON(SUBSCRIPTIONS_FILE, subscriptions, {});
}

/**
 * Transações de pagamento pendentes de confirmação do dono (chave = id da
 * transação). A regra de negócio fica em src/services/recharges.js.
 */
export function readPendingRecharges() {
  return readJSON(PENDING_RECHARGES_FILE, {});
}

export function savePendingRecharges(recharges) {
  writeJSON(PENDING_RECHARGES_FILE, recharges, {});
}

/**
 * Registos do anti-flood por usuário (chave = LID/JID).
 * A regra de negócio fica em src/services/rateLimit.js.
 */
export function readRateLimits() {
  return readJSON(RATE_LIMIT_FILE, {});
}

export function saveRateLimits(limits) {
  writeJSON(RATE_LIMIT_FILE, limits, {});
}

/**
 * Estado do backup automático (quando foi o último, e como correu).
 *
 * Fica em disco para o agendador saber se o intervalo já passou quando o bot
 * reinicia. Sem isto, cada restart disparava um backup imediato: num host que
 * reinicia a cada deploy isso seria um commit por deploy.
 */
export function readBackupState() {
  return readJSON(BACKUP_STATE_FILE, {});
}

export function saveBackupState(state) {
  writeJSON(BACKUP_STATE_FILE, state, {});
}

/* ══════════════════════════════════════════════════════════════════════════
 * PAINEL DE ADMINISTRAÇÃO
 *
 * Os acessores abaixo servem o `.painel`. Nenhum comando lê estes ficheiros
 * diretamente: a persistência passa toda por aqui (regra do projeto).
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Blacklist global de usuários.
 *
 * Forma: `{ "<jid>": { bannedAt, motivo, expiresAt|null, bannedBy } }`.
 * `expiresAt` nulo = permanente. A regra de negócio fica em
 * `src/services/blacklist.js`.
 */
export function readBlacklist() {
  return readJSON(BLACKLIST_FILE, {});
}

export function saveBlacklist(entries) {
  writeJSON(BLACKLIST_FILE, entries, {});
}

/**
 * Registo de atividade: comandos usados, usuários ativos e auditoria do dono.
 *
 * Forma: `{ commands: { "<nome>": { count, lastAt } }, users: { "<jid>":
 * { count, lastAt, name } }, events: [ { at, tipo, usuario, acao, resultado } ] }`.
 * Os eventos são uma lista limitada (as ações mais recentes), não um histórico
 * infinito: o ficheiro tem de continuar pequeno para o backup não crescer.
 */
export function readActivity() {
  return readJSON(ACTIVITY_FILE, {});
}

export function saveActivity(activity) {
  writeJSON(ACTIVITY_FILE, activity, {});
}

/**
 * Amostras de uso do sistema (RAM/CPU) para os gráficos do painel.
 *
 * Cada amostra é `{ at, ramPct, cpuPct, diskPct }`. O painel mostra as últimas
 * 24h, por isso a lista é podada em `src/services/dashboard.js`.
 */
export function readSystemSamples() {
  return readJSON(SYSTEM_SAMPLES_FILE, []);
}

export function saveSystemSamples(samples) {
  writeJSON(SYSTEM_SAMPLES_FILE, samples, []);
}
