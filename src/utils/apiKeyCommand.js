/**
 * Fábrica dos comandos de chave de API do dono.
 *
 * Cada API tem o seu ficheiro fino em `src/commands/owner/` (ex.:
 * `set-groq-api-token.js`) que só chama esta fábrica, para o comportamento ser
 * idêntico em todas e não haver seis cópias da mesma validação.
 *
 * O valor nunca é impresso de volta: a resposta mostra apenas os últimos 4
 * caracteres, porque o chat pode ser lido por outra pessoa.
 *
 * O `.api-keys <nome> <chave>` reutiliza a mesma ação (`runApiKeyAction`), para
 * a chave definida por esse atalho valer exatamente o mesmo que a definida pelo
 * comando dedicado.
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

const PALAVRA_REMOVER = /^(remover|remove|apagar|limpar)$/i;

/** `groq_api_key` -> `groq`, para o atalho do `.api-keys` ser curto. */
export function shortApiKeyName(name) {
  return String(name || "").replace(/_(api_)?(token|key)$/, "");
}

/**
 * Aceita o nome curto (`groq`) ou o nome do registo (`groq_api_key`).
 * Devolve a chave do registo, ou `null` se não corresponder a nenhuma.
 */
export function resolveApiKeyName(input) {
  const alvo = String(input ?? "").trim().toLowerCase();

  if (!alvo) return null;
  if (API_KEYS[alvo]) return alvo;

  for (const name of Object.keys(API_KEYS)) {
    if (shortApiKeyName(name) === alvo) return name;
  }

  return null;
}

/** Estado de uma chave, com o comando exato que a define e remove. */
export function apiKeyStatusText(key, { usage, removeHint }) {
  const atual = getApiKey(key);

  return [
    apiKeyInstructions(key),
    "",
    atual
      ? `✅ Já configurada (${maskKey(atual)}). Envie uma nova chave para a substituir.`
      : "❌ Ainda não está configurada.",
    "",
    `📎 *Envie:* ${usage}`,
    `🗑️ Para remover: ${removeHint}`,
  ].join("\n");
}

export function apiKeySavedText(key, value) {
  const definition = API_KEYS[key];

  return [
    `✅ Chave de *${definition.label}* guardada (${maskKey(value)}).`,
    "🔒 Fica só na base de dados do bot e nunca é mostrada de volta.",
    `🧪 ${definition.hint}`,
  ].join("\n");
}

export function apiKeyRemovedText(key, tinha) {
  const definition = API_KEYS[key];

  return tinha
    ? `🗑️ Chave de *${definition.label}* removida. Volta a valer o valor do ambiente, se existir.`
    : `ℹ️ A chave de *${definition.label}* já não estava definida.`;
}

/** Recusa uma chave manifestamente inválida antes de a guardar. */
export function assertValidApiKey(key, value) {
  const definition = API_KEYS[key];

  if (!definition) throw new InvalidParameterError("Chave desconhecida!");

  if (value.length < definition.minLength) {
    throw new InvalidParameterError(
      `A chave parece curta demais! O mínimo para ${definition.label} é ${definition.minLength} caracteres.`,
    );
  }

  if (/\s/.test(value)) {
    throw new InvalidParameterError(
      "A chave não pode conter espaços! Envie-a inteira, num só bloco.",
    );
  }
}

/**
 * Executa a ação pedida para uma chave: mostrar, remover ou guardar.
 *
 * Devolve `{ tipo, texto }` para o chamador escolher como enviar — a fábrica usa
 * `sendSuccessReply` para guardar/remover e o `.api-keys` usa `sendReply` em
 * todos os casos.
 */
export function runApiKeyAction(key, rawValue, { usage, removeHint }) {
  const valor = String(rawValue ?? "").trim();

  if (!valor) {
    return { tipo: "mostrar", texto: apiKeyStatusText(key, { usage, removeHint }) };
  }

  if (PALAVRA_REMOVER.test(valor)) {
    const tinha = removeApiKey(key);
    return { tipo: "remover", texto: apiKeyRemovedText(key, tinha) };
  }

  assertValidApiKey(key, valor);
  setApiKey(key, valor);

  return { tipo: "guardar", texto: apiKeySavedText(key, valor) };
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
    handle: async ({ fullArgs, sendReply, sendSuccessReply }) => {
      if (!definition) {
        throw new InvalidParameterError("Chave desconhecida!");
      }

      const acao = runApiKeyAction(key, fullArgs, {
        usage,
        removeHint: `${PREFIX}${name} remover`,
      });

      if (acao.tipo === "mostrar") {
        await sendReply(acao.texto);
        return;
      }

      await sendSuccessReply(acao.texto);
    },
  };
}
