/**
 * Anti-flood: limita a frequência de comandos por usuário.
 *
 * Dois travões independentes, ambos por usuário:
 *
 * - cooldown: intervalo mínimo entre comandos (`COMMAND_COOLDOWN_SECONDS`);
 * - teto diário: máximo de comandos por dia (`MAX_COMMANDS_PER_DAY`), com o
 *   contador a renovar às 00h00 de Moçambique, igual aos créditos.
 *
 * Só valem para `RATE_LIMITED_COMMANDS`: comandos de navegação (`conta`) e de
 * moderação (`warn`, `mute`) ficam de fora, para o travão não atrapalhar quem
 * modera um grupo.
 *
 * O estado fica em `database/rate-limit.json`, com um registo por usuário:
 * `{ day, count, lastCommandAt }`. O `lastCommandAt` é o timestamp (ms) da
 * última execução; o `day` é o dia de Moçambique, que faz o reset do contador.
 *
 * O dono do bot não é limitado: quem administra precisa de responder depressa.
 */

import {
  COMMAND_COOLDOWN_SECONDS,
  MAX_COMMANDS_PER_DAY,
  RATE_LIMITED_COMMANDS,
} from "../config.js";
import { mozambiqueClock } from "./credits.js";
import { readRateLimits, saveRateLimits } from "../utils/database.js";
import { infoLog } from "../utils/logger.js";

/** Normaliza o nome do comando: sem acentos, minúsculo, só letras e números. */
function normalizeCommandName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const RATE_LIMITED = new Set(
  [...RATE_LIMITED_COMMANDS].map(normalizeCommandName),
);

/**
 * Este comando está sujeito ao anti-flood?
 * A comparação aceita o nome oficial ou qualquer um dos atalhos.
 */
export function isRateLimited(command) {
  const candidates = [
    command?.name,
    ...(Array.isArray(command?.commands) ? command.commands : []),
  ];

  return candidates.some((name) => RATE_LIMITED.has(normalizeCommandName(name)));
}

/** Segundos que faltam para o usuário poder voltar a usar um comando. */
export function cooldownRemaining(accountId, now = Date.now()) {
  if (!COMMAND_COOLDOWN_SECONDS || !accountId) return 0;

  const registo = readRateLimits()[accountId];
  const ultimo = Number(registo?.lastCommandAt) || 0;
  if (!ultimo) return 0;

  const faltam = COMMAND_COOLDOWN_SECONDS * 1000 - (now - ultimo);

  return faltam > 0 ? Math.ceil(faltam / 1000) : 0;
}

/** Comandos que o usuário já usou no dia de Moçambique corrente. */
export function dailyCommandCount(accountId, now = Date.now()) {
  if (!accountId) return 0;

  const registo = readRateLimits()[accountId];
  if (!registo) return 0;

  // Contador de outro dia conta como zero (o reset é feito na gravação).
  return registo.day === mozambiqueClock(now).day ? Number(registo.count) || 0 : 0;
}

/**
 * Verifica os dois travões SEM registar nada.
 *
 * Separado de `registerCommandUse` para o dispatcher poder recusar antes de
 * cobrar créditos: quem é travado não deve gastar saldo.
 *
 * @param {string} accountId
 * @param {{ now?: number, isOwner?: boolean }} [options]
 * @returns {{ ok: boolean, reason?: "cooldown" | "daily", retryInSeconds?: number, count?: number, limit?: number }}
 */
export function checkRateLimit(accountId, { now = Date.now(), isOwner = false } = {}) {
  // Sem conta (dono) não há limite.
  if (isOwner || !accountId) return { ok: true };

  const espera = cooldownRemaining(accountId, now);
  if (espera > 0) {
    return { ok: false, reason: "cooldown", retryInSeconds: espera };
  }

  if (MAX_COMMANDS_PER_DAY > 0) {
    const usados = dailyCommandCount(accountId, now);

    if (usados >= MAX_COMMANDS_PER_DAY) {
      return {
        ok: false,
        reason: "daily",
        count: usados,
        limit: MAX_COMMANDS_PER_DAY,
      };
    }
  }

  return { ok: true };
}

/**
 * Regista o uso de um comando: sobe o contador do dia e marca a hora.
 * Chamar só depois de a execução ser autorizada.
 *
 * @param {string} accountId
 * @param {{ now?: number }} [options]
 * @returns {{ count: number, day: string }}
 */
export function registerCommandUse(accountId, { now = Date.now() } = {}) {
  if (!accountId) return { count: 0, day: mozambiqueClock(now).day };

  const day = mozambiqueClock(now).day;
  const limits = readRateLimits();
  const anterior = limits[accountId];
  const count = anterior?.day === day ? (Number(anterior.count) || 0) + 1 : 1;

  limits[accountId] = { day, count, lastCommandAt: now };
  saveRateLimits(limits);

  return { count, day };
}

/** Mensagem mostrada quando o usuário é travado pelo anti-flood. */
export function rateLimitMessage({ commandName, reason, retryInSeconds, count, limit }) {
  if (reason === "daily") {
    return (
      `🚦 *Limite diário atingido*\n\n` +
      `Você já usou *${count}/${limit}* comandos hoje.\n` +
      `O contador renova às 00h00 (horário de Moçambique).`
    );
  }

  const segundos = Math.max(1, Number(retryInSeconds) || 1);
  const espera =
    segundos >= 60
      ? `${Math.ceil(segundos / 60)} min`
      : `${segundos} s`;

  return (
    `⏳ *Devagar!*\n\n` +
    `Você executou *${commandName}* agora mesmo. Aguarde *${espera}* antes de repetir.`
  );
}

/**
 * Limpa registos antigos, para o ficheiro não crescer sem fim.
 * Apaga quem não usa o bot há mais de `dias` dias.
 */
export function pruneRateLimits({ now = Date.now(), days = 30 } = {}) {
  const limite = now - days * 24 * 60 * 60 * 1000;
  const limits = readRateLimits();
  let removidos = 0;

  for (const [jid, registo] of Object.entries(limits)) {
    if ((Number(registo?.lastCommandAt) || 0) < limite) {
      delete limits[jid];
      removidos += 1;
    }
  }

  if (removidos) {
    saveRateLimits(limits);
    infoLog(`[anti-flood] ${removidos} registo(s) antigo(s) removido(s).`);
  }

  return removidos;
}
