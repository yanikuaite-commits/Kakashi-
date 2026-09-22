import { PREFIX } from "../../config.js";
import { createBackup } from "../../services/backup.js";

export default {
  name: "backup",
  description: "Salva os dados do bot localmente e, se configurado, no GitHub.",
  commands: ["backup"],
  usage: `${PREFIX}backup`,
  handle: async ({ sendWaitReply, sendSuccessReply }) => {
    await sendWaitReply("Criando backup dos dados...");
    const result = await createBackup();
    await sendSuccessReply(result.github
      ? `Backup salvo no GitHub em ${result.destination}.`
      : `Backup local criado em ${result.archivePath}. Configure GITHUB_TOKEN e GITHUB_REPOSITORY para salvar no GitHub.`);
  },
};