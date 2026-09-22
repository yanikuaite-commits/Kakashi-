import { PREFIX } from "../../config.js";
import { restoreBackup } from "../../services/backup.js";

export default {
  name: "restore",
  description: "Restaura os dados do bot a partir do GitHub.",
  commands: ["restore", "restaurar"],
  usage: `${PREFIX}restore`,
  handle: async ({ sendWaitReply, sendSuccessReply }) => {
    await sendWaitReply("Restaurando dados do GitHub...");
    const destination = await restoreBackup();
    await sendSuccessReply(`Dados restaurados de ${destination}.`);
  },
};