import { PREFIX } from "../../config.js";
import { getApiKey, listApiKeys } from "../../utils/database.js";
import { maskKey } from "../../utils/apiKeyCommand.js";
import { formatMessage } from "../../utils/formatMessage.js";

export default {
  name: "api-keys",
  description: "Mostro e explico as chaves de API que posso usar",
  commands: ["api-keys", "chaves", "chaves-api", "api-keys-listar", "minhas-chaves"],
  usage: `${PREFIX}api-keys`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ sendReply }) => {
    const chaves = listApiKeys();
    const configuradas = chaves.filter((c) => c.configured);

    const campos = [
      `🔐 *${configuradas.length} de ${chaves.length}* chaves configuradas.`,
      "",
    ];

    for (const chave of chaves) {
      const origem =
        chave.origin === "whatsapp"
          ? "definida no WhatsApp"
          : chave.origin === "ambiente"
            ? "vinda do ambiente"
            : "ausente";

      campos.push(
        `${chave.configured ? "✅" : "❌"} *${chave.label}* — ${origem}`,
        `    💡 ${chave.hint}`,
      );

      if (chave.configured) {
        campos.push(`    🔑 ${maskKey(getApiKey(chave.name))}`);
      }
    }

    campos.push(
      "",
      "*Como configurar*",
      `${PREFIX}set-spider-api-token <chave> — Spider X (downloads e IA)`,
      `${PREFIX}set-github-token <chave> — backup remoto`,
      `${PREFIX}set-groq-api-token <chave> — IA, transcrição e suporte`,
      `${PREFIX}set-gemini-api-token <chave> — geração de imagem`,
      `${PREFIX}set-linker-api-token <chave> — gerar-link`,
      `${PREFIX}set-hf-token <chave> — Hugging Face`,
      "",
      "🗑️ Qualquer uma aceita *remover* no lugar da chave, para voltar ao valor do ambiente.",
    );

    await sendReply(formatMessage({ icone: "🔐", titulo: "Chaves de API", campos }));
  },
};
