/**
 * Relógio de Moçambique (Africa/Maputo, UTC+2).
 *
 * Vive num ficheiro próprio porque o dia local é a chave de dois sistemas que
 * não podem importar-se um ao outro: os créditos (`src/services/credits.js`) e
 * as assinaturas (`src/services/subscriptions.js`). O `credits.js` reexporta
 * estas funções, por isso quem já as importava de lá continua a funcionar.
 *
 * @author Dev Gui
 */
import { CREDITS_TIMEZONE } from "../config.js";

const maputoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CREDITS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Data e hora atuais no fuso de Moçambique.
 *
 * @param {number} [now] timestamp em ms
 * @returns {{ day: string, hour: number, minute: number }}
 */
export function mozambiqueClock(now = Date.now()) {
  const parts = Object.fromEntries(
    maputoFormatter
      .formatToParts(new Date(now))
      .map(({ type, value }) => [type, value]),
  );

  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/**
 * O dia de Moçambique de um instante ("AAAA-MM-DD").
 *
 * @param {number} [now]
 * @returns {string}
 */
export function mozambiqueDay(now = Date.now()) {
  return mozambiqueClock(now).day;
}

/** Minutos restantes até o reset diário das 00h00 (horário de Moçambique). */
export function minutesUntilDailyReset(now = Date.now()) {
  const { hour, minute } = mozambiqueClock(now);

  return 24 * 60 - (hour * 60 + minute);
}

/** Soma dias a um instante, mantendo o mesmo relógio (UTC). */
export function addDays(now, days) {
  return now + Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000;
}
