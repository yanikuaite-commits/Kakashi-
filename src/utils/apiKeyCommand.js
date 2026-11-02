/**
 * Fábrica dos comandos de chave de API do dono.
 *
 * Cada API tem o seu ficheiro fino em `src/commands/owner/` (ex.:
 * `set-groq-api-token.js`) que só chama esta fábrica, para o comportamento ser
 * idêntico em todas e não haver seis cópias da mesma validação.
 *
 * O valor nunca é impresso de volta: a resposta mostra apenas os últimos 4
 * caracteres, porque o chat pode ser lido por outra pessoa.
 */
import { PREFIX } from "../config.js";
import { InvalidParameterError } from "../errors/index.js";
import { API_KEYS, getApiKey, removeApiKey, setApiKey } from "./database.js";

/** `ghp_1234...abcd` -> `••••abcd`, para confirmar sem revelar. */
export function maskKey(value) {
  const text = String(value ?? "");

  if (text.length <= 4) return "••••";

  return `••••${text.slice(-4)}`;
}

export function apiKeyInstructions(key) {
  const definition = API_KEYS[key];

  if (!definition) return "";

  const lines = [`🔑 *${definition.label}*`, `💡 ${definition.hint}`];

  if (definition.where) lines.push(`🌐 Obtenha em: ${definition.where}`);

  return lines.join("\n");
}

/**
 * Monta o comando de uma chave.
 *
 * @param {object} options
 * @param {string} options.key nome no registo (`API_KEYS`)
 * @param {string[]} options.aliases nomes alternativos do comando
 */
export function buildApiKeyCommand({ key, aliases = [] }) {
  const definition = API_KEYS[key];
  const name = aliases[0];
  const usage = `${PREFIX}${name} sua_chave_aqui`;

  return {
    name,
    description: `Configuro a chave da API ${definition?.label ?? key}`,
    commands: aliases,
    usage,
    /**
     * @param {CommandHandleProps} props
     */
    handle: async ({ args, fullArgs, sendReply, sendSuccessReply }) => {
      if (!definition) {
        throw new InvalidParameterError("Chave desconhecida!");
      }

      const valor = String(fullArgs ?? "").trim();

      if (!valor) {
        const atual = getApiKey(key);

        await sendReply(
          [
            apiKeyInstructions(key),
            "",
            atual
              ? `✅ Já configurada (${maskKey(atual)}). Envie uma nova chave para a substituir.`
              : "❌ Ainda não está configurada.",
            "",
            `📎 *Envie:* ${usage}`,
            `🗑️ Para remover: ${PREFIX}${name} remover`,
          ].join("\n"),
        );

        return;
      }

      if (/^(remover|remove|apagar|limpar)$/i.test(valor)) {
        const tinha = removeApiKey(key);

        await sendSuccessReply(
          tinha
            ? `🗑️ Chave de *${definition.label}* removida. Volta a valer o valor do ambiente, se existir.`
            : `ℹ️ A chave de *${definition.label}* já não estava definida.`,
        );

        return;
      }

      if (valor.length < definition.minLength) {
        throw new InvalidParameterError(
          `A chave parece curta demais! O mínimo para ${definition.label} é ${definition.minLength} caracteres.`,
        );
      }

      if (/\s/.test(valor)) {
        throw new InvalidParameterError(
          "A chave não pode conter espaços! Envie-a inteira, num só bloco.",
        );
      }

      setApiKey(key, valor);

      await sendSuccessReply(
        [
          `✅ Chave de *${definition.label}* guardada (${maskKey(valor)}).`,
          "🔒 Fica só na base de dados do bot e nunca é mostrada de volta.",
          `🧪 ${definition.hint}`,
        ].join("\n"),
      );
    },
  };
}
