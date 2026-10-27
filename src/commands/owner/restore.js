import { BACKUP_TARGET, PREFIX } from "../../config.js";
import {
  listTursoBackupHistory,
  restoreBackup,
  restoreBackupFromTurso,
} from "../../services/backup.js";

/** Data legível para a lista de backups disponíveis. */
function formatarData(iso) {
  try {
    return new Date(iso).toLocaleString("pt-PT");
  } catch {
    return iso;
  }
}

export default {
  name: "restore",
  description: "Restaura os dados do bot a partir do backup mais recente.",
  commands: ["restore", "restaurar"],
  usage: `${PREFIX}restore [sessao|listar|<id>]`,
  handle: async ({ args, sendWaitReply, sendSuccessReply, sendReply }) => {
    const opcoes = args.map((arg) => arg.toLowerCase());

    // Listar antes de restaurar: sem isto o dono restaurava às cegas, sem saber
    // que versões existem nem quando foram feitas.
    if (opcoes.includes("listar") || opcoes.includes("lista")) {
      if (BACKUP_TARGET !== "turso") {
        await sendReply(
          "A listagem de backups só existe para o Turso. Com `BACKUP_TARGET=github` há um único arquivo no repositório.",
        );
        return;
      }

      const historico = await listTursoBackupHistory();

      if (!historico.length) {
        await sendReply("Não há backups guardados no Turso.");
        return;
      }

      const linhas = historico.map(
        (item) =>
          `• *#${item.id}* — ${formatarData(item.createdAt)} ` +
          `(${Math.round(item.size / 1024)} KB${item.includesSession ? ", com sessão" : ""})`,
      );

      await sendReply(
        `📦 *Backups disponíveis* (${historico.length}):\n\n${linhas.join("\n")}\n\n` +
          `Para restaurar um: ${PREFIX}restore <id>\n` +
          `Para o mais recente: ${PREFIX}restore`,
      );
      return;
    }

    // Restaurar a sessão substitui as chaves privadas do número. Só com pedido
    // explícito, para um arquivo antigo não deixar o bot sem conseguir falar.
    const includeAuth = opcoes.includes("sessao");
    // Um número é um id de backup específico; sem ele, o mais recente.
    const id = Number(args.find((arg) => /^\d+$/.test(arg)) || 0);

    const alvo =
      BACKUP_TARGET === "turso"
        ? id
          ? `Turso (#${id})`
          : "Turso"
        : "GitHub";

    await sendWaitReply(
      includeAuth
        ? `Restaurando dados E sessão do WhatsApp do ${alvo}...`
        : `Restaurando dados do ${alvo}...`,
    );

    const result =
      BACKUP_TARGET === "turso"
        ? await restoreBackupFromTurso({ id, includeAuth })
        : await restoreBackup({ includeAuth });

    const sessao = result.includesSession
      ? "\n⚠️ A sessão do WhatsApp foi substituída. Se o bot não falar, apague assets/auth/baileys/ e pareie de novo."
      : "\nA sessão do WhatsApp do arquivo foi ignorada (use `restore sessao` para a restaurar).";

    const quando = result.createdAt
      ? `\n🕒 Backup de ${formatarData(result.createdAt)}.`
      : "";

    await sendSuccessReply(
      `Dados restaurados de ${result.destination}.${quando}${sessao}`,
    );
  },
};
