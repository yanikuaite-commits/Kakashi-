import { PREFIX } from "../../config.js";
import { createBackup } from "../../services/backup.js";

export default {
  name: "backup",
  description: "Salva os dados do bot localmente e, se configurado, no GitHub.",
  commands: ["backup"],
  usage: `${PREFIX}backup [sessao]`,
  handle: async ({ args, sendWaitReply, sendSuccessReply }) => {
    // A sessão do Baileys (chaves privadas do pareamento) só sai daqui com
    // pedido explícito: quem tiver o ficheiro fala pelo número do bot.
    const includeAuth = args[0]?.toLowerCase() === "sessao";

    await sendWaitReply(
      includeAuth
        ? "Criando backup dos dados E da sessão do WhatsApp..."
        : "Criando backup dos dados...",
    );

    try {
      const result = await createBackup({ includeAuth });
      const destino = result.github
        ? `no GitHub em ${result.destination}`
        : `localmente em ${result.archivePath}`;
      const sessao = result.includesSession
        ? "\n⚠️ Este backup inclui a SESSÃO do WhatsApp (chaves privadas): quem tiver o ficheiro fala pelo número do bot."
        : "\nA sessão do WhatsApp não foi incluída. Para a incluir, use o comando com `sessao` no fim.";

      await sendSuccessReply(`Backup salvo ${destino}.${sessao}`);
    } catch (error) {
      // O envio remoto pode falhar (token inválido, repositório público) sem
      // que o arquivo local se perca: sem esta nota o dono pensava que não
      // tinha backup nenhum.
      if (error.archivePath) {
        throw new Error(
          `${error.message} O backup local ficou em ${error.archivePath}.`,
        );
      }
      throw error;
    }
  },
};
