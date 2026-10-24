import { PREFIX } from "../../config.js";
import { restoreBackup } from "../../services/backup.js";

export default {
  name: "restore",
  description: "Restaura os dados do bot a partir do GitHub.",
  commands: ["restore", "restaurar"],
  usage: `${PREFIX}restore [sessao]`,
  handle: async ({ args, sendWaitReply, sendSuccessReply }) => {
    // Restaurar a sessão substitui as chaves privadas do número. Só com pedido
    // explícito, para um arquivo antigo não deixar o bot sem conseguir falar.
    const includeAuth = args[0]?.toLowerCase() === "sessao";

    await sendWaitReply(
      includeAuth
        ? "Restaurando dados E sessão do WhatsApp do GitHub..."
        : "Restaurando dados do GitHub...",
    );

    const result = await restoreBackup({ includeAuth });
    const sessao = result.includesSession
      ? "\n⚠️ A sessão do WhatsApp foi substituída. Se o bot não falar, apague assets/auth/baileys/ e pareie de novo."
      : "\nA sessão do WhatsApp do arquivo foi ignorada (use `restore sessao` para a restaurar).";

    await sendSuccessReply(`Dados restaurados de ${result.destination}.${sessao}`);
  },
};
