import { PREFIX } from "../../config.js";
import { createBackup, destinationLabel } from "../../services/backup.js";
import { flushRemoteState } from "../../utils/database.js";
import { syncSession } from "../../services/sessionStore.js";

export default {
  name: "backup",
  description: "Salva os dados do bot no Turso (ou no GitHub, conforme BACKUP_TARGET).",
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
      // "Guardar agora": sem isto, uma alteração feita há segundos ainda podia
      // estar na fila (o espelho agrupa escritas) e o backup não a incluía.
      // A sessão também é empurrada para o remoto quando pedida, para o backup
      // e o espelho não ficarem desencontrados.
      await flushRemoteState();

      if (includeAuth) {
        await syncSession();
      }

      const result = await createBackup({ includeAuth });
      const destino = destinationLabel(result);
      const poda = result.pruned
        ? `\n🗑️ ${result.pruned} backup(s) antigo(s) apagado(s) pela retenção.`
        : "";
      const sessao = result.includesSession
        ? "\n⚠️ Este backup inclui a SESSÃO do WhatsApp (chaves privadas): quem tiver o ficheiro fala pelo número do bot."
        : "\nA sessão do WhatsApp não foi incluída. Para a incluir, use o comando com `sessao` no fim.";

      await sendSuccessReply(`Backup salvo ${destino}.${poda}${sessao}`);
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
