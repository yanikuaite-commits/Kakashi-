import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { getApiKey, listApiKeys } from "../../utils/database.js";
import {
  maskKey,
  resolveApiKeyName,
  runApiKeyAction,
  shortApiKeyName,
} from "../../utils/apiKeyCommand.js";
import { formatMessage } from "../../utils/formatMessage.js";

/** Lista o estado de todas as chaves, sem revelar nenhum valor. */
function listarChaves() {
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
    `⚡ Atalho: ${PREFIX}api-keys <nome> <chave> (ex.: ${PREFIX}api-keys groq gsk_...)`,
    "🗑️ Qualquer uma aceita *remover* no lugar da chave, para voltar ao valor do ambiente.",
  );

  return formatMessage({ icone: "🔐", titulo: "Chaves de API", campos });
}

export default {
  name: "api-keys",
  description: "Mostro e explico as chaves de API que posso usar",
  commands: ["api-keys", "chaves", "chaves-api", "api-keys-listar", "minhas-chaves"],
  usage: `${PREFIX}api-keys [nome] [chave]`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ args, fullArgs, sendReply }) => {
    if (!args.length) {
      await sendReply(listarChaves());
      return;
    }

    // `.api-keys <nome> <chave>` é o atalho que as mensagens de erro anunciam
    // (`.api-keys groq <chave>`): aceita o nome curto ou o nome do registo.
    const [nome, ...resto] = fullArgs.trim().split(/\s+/);
    const key = resolveApiKeyName(nome);

    if (!key) {
      const disponiveis = listApiKeys()
        .map((c) => shortApiKeyName(c.name))
        .join(", ");

      throw new InvalidParameterError(
        `Chave desconhecida: "${nome}". Disponíveis: ${disponiveis}.`,
      );
    }

    const acao = runApiKeyAction(key, resto.join(" "), {
      usage: `${PREFIX}api-keys ${shortApiKeyName(key)} sua_chave_aqui`,
      removeHint: `${PREFIX}api-keys ${shortApiKeyName(key)} remover`,
    });

    await sendReply(acao.texto);
  },
};
