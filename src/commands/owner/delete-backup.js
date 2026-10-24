import { PREFIX } from "../../config.js";
import { deleteRemoteBackup } from "../../services/backup.js";

export default {
  name: "delete-backup",
  description: "Apaga o arquivo de backup do repositório no GitHub.",
  commands: ["delete-backup", "apagar-backup"],
  usage: `${PREFIX}delete-backup`,
  handle: async ({ sendWaitReply, sendSuccessReply }) => {
    await sendWaitReply("Apagando o backup do GitHub...");
    const result = await deleteRemoteBackup();
    await sendSuccessReply(
      `Backup apagado de ${result.destination}.\n` +
        "Nota: o ficheiro continua no histórico de commits. Se o repositório já foi público, os segredos que iam no arquivo devem ser considerados comprometidos e trocados.",
    );
  },
};
