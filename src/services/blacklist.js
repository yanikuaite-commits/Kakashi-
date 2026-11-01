/**
 * Blacklist global de usuários.
 *
 * Bloqueia um LID/JID em TODOS os grupos e no privado. Diferente das restrições
 * por grupo (`muted`, `only-admins`), que valem num grupo só: aqui o usuário
 * deixa de ser atendido pelo bot onde quer que fale.
 *
 * Um ban temporário (`expiresAt`) expira sozinho na leitura — não há varredor.
 * É a mesma escolha das assinaturas: quem pergunta "está banido agora?" compara
 * com o relógio, em vez de confiar num processo de limpeza que pode não correr.
 *
 * @author Dev Yanik
 */
import { readBlacklist, saveBlacklist } from "../utils/database.js";
import { infoLog } from "../utils/logger.js";

/** Durações aceites pelo comando, em milissegundos. */
export const BAN_DURATIONS = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/**
 * Normaliza um LID/JID para a chave canónica usada na blacklist.
 *
 * Aceita a forma do `.meu-lid` (`275381038891241@lid`), só dígitos, ou com o
 * sufixo de aparelho que o WhatsApp acrescenta em alguns eventos
 * (`275381038891241:12@lid`). Todos apontam para a mesma pessoa, por isso ficam
 * em `dígitos@lid`; um domínio explícito (`@s.whatsapp.net`) é preservado.
 *
 * @param {string} value
 * @returns {string} chave canónica, ou "" quando não há dígitos
 */
export function normalizeUserKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const [local, domain] = raw.split("@");
  const digits = String(local || "").split(":")[0].replace(/\D/g, "");
  if (!digits) return "";

  return domain ? `${digits}@${domain.toLowerCase()}` : `${digits}@lid`;
}

/** O ban já expirou? Sem `expiresAt` o ban é permanente. */
function isExpired(entry, now) {
  if (!entry?.expiresAt) return false;
  const expires = Date.parse(entry.expiresAt);
  return Number.isFinite(expires) && expires <= now;
}

/**
 * Entrada ativa da blacklist para este usuário, ou `null`.
 *
 * Um ban expirado é removido do disco na primeira consulta, para o ficheiro não
 * acumular bans mortos que o painel continuaria a listar.
 *
 * @param {string} jid
 * @param {number} [now]
 * @returns {{key: string, bannedAt: string, motivo: string, expiresAt: string|null, bannedBy: string}|null}
 */
export function getActiveBan(jid, now = Date.now()) {
  const key = normalizeUserKey(jid);
  if (!key) return null;

  const entries = readBlacklist();
  const entry = entries[key];
  if (!entry) return null;

  if (isExpired(entry, now)) {
    delete entries[key];
    saveBlacklist(entries);
    return null;
  }

  return { key, ...entry };
}

/**
 * Este usuário está banido neste momento?
 *
 * @param {string} jid
 * @param {number} [now]
 * @returns {boolean}
 */
export function isBanned(jid, now = Date.now()) {
  return Boolean(getActiveBan(jid, now));
}

/**
 * Bane um usuário (ou renova um ban existente).
 *
 * @param {string} jid
 * @param {{motivo?: string, duration?: string, bannedBy?: string}} [options]
 * @returns {{ok: boolean, key?: string, motivo?: string, expiresAt?: string|null, error?: string}}
 */
export function banUser(
  jid,
  { motivo = "", duration = "", bannedBy = "" } = {},
) {
  const key = normalizeUserKey(jid);
  if (!key) {
    return { ok: false, error: "LID/JID inválido." };
  }

  const ms = BAN_DURATIONS[String(duration || "").toLowerCase()];
  const expiresAt = ms ? new Date(Date.now() + ms).toISOString() : null;

  const entries = readBlacklist();
  entries[key] = {
    bannedAt: new Date().toISOString(),
    motivo: String(motivo || "").slice(0, 200) || "sem motivo indicado",
    expiresAt,
    bannedBy: String(bannedBy || ""),
  };
  saveBlacklist(entries);

  infoLog(
    `[blacklist] ${key} banido${expiresAt ? ` até ${expiresAt}` : " permanentemente"}`,
  );

  return { ok: true, key, motivo: entries[key].motivo, expiresAt };
}

/**
 * Remove o ban. Devolve `false` quando não havia nada a remover, para o comando
 * poder dizer "não estava banido" em vez de fingir sucesso.
 */
export function unbanUser(jid) {
  const key = normalizeUserKey(jid);
  if (!key) return false;

  const entries = readBlacklist();
  if (!entries[key]) return false;

  delete entries[key];
  saveBlacklist(entries);
  infoLog(`[blacklist] ${key} desbanido`);

  return true;
}

/**
 * Lista os bans ativos, do mais recente para o mais antigo.
 *
 * Os expirados são descartados aqui também (e o ficheiro é reescrito só se
 * houver algo a limpar), para o painel nunca mostrar um ban que já caducou.
 *
 * @param {number} [now]
 * @returns {Array<{key: string, bannedAt: string, motivo: string, expiresAt: string|null, bannedBy: string, permanent: boolean, expiresInMs: number|null}>}
 */
export function listActiveBans(now = Date.now()) {
  const entries = readBlacklist();
  let alterado = false;

  const ativos = [];

  for (const [key, entry] of Object.entries(entries)) {
    if (isExpired(entry, now)) {
      delete entries[key];
      alterado = true;
      continue;
    }

    ativos.push({
      key,
      bannedAt: entry.bannedAt,
      motivo: entry.motivo,
      expiresAt: entry.expiresAt || null,
      bannedBy: entry.bannedBy || "",
      permanent: !entry.expiresAt,
      expiresInMs: entry.expiresAt
        ? Math.max(0, Date.parse(entry.expiresAt) - now)
        : null,
    });
  }

  if (alterado) saveBlacklist(entries);

  return ativos.sort(
    (a, b) => Date.parse(b.bannedAt || 0) - Date.parse(a.bannedAt || 0),
  );
}
