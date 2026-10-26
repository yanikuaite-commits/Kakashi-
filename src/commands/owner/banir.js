import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import {
  BAN_DURATIONS,
  banUser,
  listActiveBans,
  normalizeUserKey,
  unbanUser,
} from "../../services/blacklist.js";
import { recordEvent } from "../../services/activity.js";
import { panelMessage } from "../../utils/formatMessage.js";

function listarBans() {
  const bans = listActiveBans();

  if (!bans.length) return "📋 A blacklist está vazia.";

  return panelMessage({
    icone: "🚫",
    titulo: `Blacklist (${bans.length})`,
    campos: bans.map(
      (ban) =>
        `• ${ban.key} — ${ban.permanent ? "permanente" : `expira em ${ban.expiresAt}`} (${ban.motivo})`,
    ),
  });
}

export default {
  name: "banir",
  description: "Bane (ou desbane) um usuário do bot em todos os grupos.",
  // `ban`/`kick` já são o comando de admin que remove do GRUPO. Reutilizar
  // `ban` aqui tornaria ambíguo o alias e podia desviar a moderação de grupo.
  commands: ["banir", "desbanir", "unban", "blacklist"],
  usage: `${PREFIX}banir <lid> [1h|1d|7d|30d] [motivo]`,
  handle: async ({ commandName, fullArgs, sendSuccessReply, sendReply }) => {
    // `args` separa por `\`, `|` e `/` — não por espaço. Ler `fullArgs` evita
    // partir o LID junto com a duração, como já acontecia no private-whitelist.
    const partes = String(fullArgs || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (commandName === "blacklist" || partes[0] === "list") {
      return sendSuccessReply(listarBans());
    }

    const alvo = partes[0] || "";
    const key = normalizeUserKey(alvo);

    if (!key) {
      throw new InvalidParameterError(
        `Envie o LID da pessoa. Ex: ${PREFIX}banir 275381038891241@lid 7d spam`,
      );
    }

    if (commandName === "desbanir" || commandName === "unban") {
      const removido = unbanUser(key);
      await recordEvent({
        tipo: "blacklist",
        usuario: key,
        acao: "desbanido",
        resultado: removido ? "sucesso" : "erro",
      });

      if (!removido) {
        return sendReply(`ℹ️ ${key} não estava banido.`);
      }

      return sendSuccessReply(`✅ ${key} foi desbanido.`);
    }

    // Duração é opcional e tem de ser uma das aceites; um valor desconhecido
    // vira parte do motivo, para não perder texto que o dono escreveu.
    const duracao = String(partes[1] || "").toLowerCase();
    const temDuracao = Object.keys(BAN_DURATIONS).includes(duracao);
    const motivo = partes.slice(temDuracao ? 2 : 1).join(" ");

    const resultado = banUser(key, {
      motivo,
      duration: temDuracao ? duracao : "",
      bannedBy: "dono",
    });

    if (!resultado.ok) {
      throw new InvalidParameterError(resultado.error);
    }

    await recordEvent({
      tipo: "blacklist",
      usuario: key,
      acao: `banido (${resultado.expiresAt ? `até ${resultado.expiresAt}` : "permanente"})`,
    });

    const validade = resultado.expiresAt
      ? `até ${resultado.expiresAt}`
      : "permanentemente";

    await sendSuccessReply(
      `🚫 ${key} banido ${validade}.\nMotivo: ${resultado.motivo}`,
    );
  },
};
