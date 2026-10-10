/**
 * Serviço de validação por token (ad-gate).
 *
 * Fluxo:
 * 1. Usuário tenta usar um comando protegido.
 * 2. Se não estiver validado, o bot gera um token único e envia o link da página de anúncio.
 * 3. Após 30s de anúncio, o usuário copia o código e envia `.validar TOKEN`.
 * 4. O bot valida o token (válido + não expirado) e salva o usuário por 24h.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROTECTED_COMMANDS,
  TOKEN_EXPIRY_MS,
  VALIDATION_DURATION_MS,
  USERS_FILE,
} from "../config.js";
import { infoLog } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const usersFilePath = path.resolve(__dirname, "..", "..", "data", `${USERS_FILE}.json`);

/**
 * Normaliza um nome de comando para comparação (sem acentos, minúsculo, só
 * letras e números). Mesma regra usada ao impedir comandos bloqueados.
 */
function normalizeCommandName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const protectedCommandNames = new Set(
  PROTECTED_COMMANDS.map(normalizeCommandName),
);

/**
 * Informa se o comando resolvido exige validação (ad-gate).
 * A checagem considera o nome resolvido e todos os aliases do comando.
 */
export function isProtectedCommand(commandName, command) {
  const candidates = [
    commandName,
    ...(Array.isArray(command?.commands) ? command.commands : []),
  ];

  return candidates.some((name) =>
    protectedCommandNames.has(normalizeCommandName(name)),
  );
}

export function buildAdGateUrl(token) {
  const base = process.env.ADS_PAGE_URL || "https://yanikzx9.vercel.app";
  return `${base}?token=${encodeURIComponent(token)}`;
}

export function generateToken() {
  return crypto.randomBytes(16).toString("hex").slice(0,16);
}

export async function readUsers() {
  try {
    const raw = await fs.readFile(usersFilePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function writeUsers(users) {
  await fs.mkdir(path.dirname(usersFilePath), { recursive: true });
  await fs.writeFile(usersFilePath, JSON.stringify(users, null, 2), "utf8");
}

export async function getUserRecord(jid) {
  const users = await readUsers();
  return users[jid] || null;
}

export async function isUserValidated(jid) {
  const record = await getUserRecord(jid);
  if (!record) return false;
  if (record.validado !== true) return false;
  if (!record.validoPor24h) return false;

  const validatedAt = record.dataValidacao ? new Date(record.dataValidacao).getTime() : 0;
  if (!validatedAt) return false;

  return Date.now() - validatedAt < VALIDATION_DURATION_MS;
}

export async function saveValidatedUser(jid) {
  const users = await readUsers();
  users[jid] = {
    validado: true,
    dataValidacao: new Date().toISOString(),
    validoPor24h: true,
  };
  await writeUsers(users);
  infoLog(`Usuário validado: ${jid}`);
}

export async function invalidateUser(jid) {
  const users = await readUsers();
  if (!users[jid]) return false;
  users[jid] = {
    validado: false,
    dataValidacao: users[jid].dataValidacao || new Date().toISOString(),
    validoPor24h: false,
  };
  await writeUsers(users);
  return true;
}

export async function consumeToken(token) {
  if (!token || typeof token !== "string") return null;

  const users = await readUsers();

  for (const [jid, record] of Object.entries(users)) {
    if (record?.token !== token) continue;
    if (record?.tokenExpiresAt && Date.now() > Number(record.tokenExpiresAt)) {
      await invalidateUser(jid);
      continue;
    }
    if (record?.consumed) continue;

    return {
      jid,
      record: users[jid],
    };
  }

  return null;
}

export async function markTokenIssued(jid, token) {
  const users = await readUsers();
  users[jid] = {
    ...users[jid],
    token,
    tokenExpiresAt: Date.now() + TOKEN_EXPIRY_MS,
    consumed: false,
    validado: users[jid]?.validado || false,
    dataValidacao: users[jid]?.dataValidacao || null,
    validoPor24h: users[jid]?.validoPor24h || false,
  };
  await writeUsers(users);
}

export async function invalidateTokenAfterUse(jid) {
  const users = await readUsers();
  if (!users[jid]) return;
  users[jid] = {
    ...users[jid],
    token: null,
    tokenExpiresAt: null,
    consumed: true,
  };
  await writeUsers(users);
}

export async function requireValidation(jid, sendReply) {
  const validated = await isUserValidated(jid);
  if (validated) return true;

  const token = generateToken();
  await markTokenIssued(jid, token);
  const url = buildAdGateUrl(token);

  await sendReply(
    `❌ Você precisa validar primeiro!\n\n👇 Copie o código abaixo, abra o link, assista ao anúncio por 30s e depois envie no WhatsApp:\n\n🆔 .validar ${token}\n\n🔗 ${url}`,
  );

  return false;
}
