import { PREFIX } from "../../config.js";
import {
  deleteRemoteBackup,
  deleteTursoBackupHistory,
  listTursoBackupHistory,
} from "../../services/backup.js";

export default {
  name: "delete-backup",
  description: "Apaga o histórico de backups do Turso (ou do GitHub).",
  commands: ["delete-backup", "apagar-backup"],
  usage: `${PREFIX}delete-backup [turso|github]`,
  handle: async ({ args, sendWaitReply, sendSuccessReply }) => {
    const alvo = args[0]?.toLowerCase();

    // Sem argumento, o padrão é o Turso: é onde os backups passam a viver.
    if (alvo === "github") {
      await sendWaitReply("Apagando o backup do GitHub...");
      const result = await deleteRemoteBackup();
      await sendSuccessReply(
        `Backup apagado de ${result.destination}.\n` +
          "Nota: o ficheiro continua no histórico de commits. Se o repositório já foi público, os segredos que iam no arquivo devem ser considerados comprometidos e trocados.",
      );
      return;
    }

    await sendWaitReply("Apagando os backups do Turso...");

    const antes = await listTursoBackupHistory();

    if (!antes.length) {
      await sendSuccessReply("Não há backups guardados no Turso.");
      return;
    }

    const apagados = await deleteTursoBackupHistory();

    await sendSuccessReply(
      `${apagados} backup(s) apagado(s) do Turso.\n\n` +
        "⚠️ Isto apaga o HISTÓRICO de backups, não os dados atuais. Os dados continuam na tabela de estado.\n" +
        "Use `.apagar-dados` se quiser apagar os dados.",
    );
  },
};
