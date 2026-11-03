import {
  AI_TIMEOUT_MS,
  GROQ_ACTION_PROMPT,
  GROQ_CHAT_URL,
  GROQ_HISTORY_SIZE,
  GROQ_MAX_TOKENS,
  GROQ_MODELS,
  GROQ_OWNER_CONTEXT_PROMPT,
  GROQ_SYSTEM_PROMPT,
  GROQ_TEMPERATURE,
  GROQ_TOP_P,
  GROQ_TRANSCRIPTION_LANGUAGE,
  GROQ_TRANSCRIPTION_MODEL,
  GROQ_TRANSCRIPTION_URL,
} from "../config.js";
import { getApiKey } from "../utils/database.js";
import { errorLog } from "../utils/logger.js";
import { botKnowledgeText } from "./botKnowledge.js";
import { aiActionHelpText } from "./botCommands.js";

const histories = new Map();

// Status em que vale a pena tentar o próximo modelo da lista.
const RETRYABLE_STATUS = [429, 500, 502, 503];

const MISSING_KEY_MESSAGE =
  "A IA está indisponível: configure a chave da Groq com `.api-keys groq <chave>` (ou defina GROQ_API_KEY no ambiente do bot).";

/**
 * Conversa com a IA da Groq (chat completions), mantendo um histórico curto
 * por conversa.
 *
 * @param {string} chatId identificador da conversa (grupo ou privado)
 * @param {string} question pergunta do usuário
 * @param {{context?: string|null, allowCommands?: boolean}} [options]
 *   `context` é um bloco de estado real (só o dono recebe) e vai como mensagem
 *   de sistema extra, nunca no histórico. `allowCommands` autoriza a IA a pedir
 *   a execução de um comando (o bot re-despacha; a IA não escreve no estado).
 * @returns {Promise<{text: string, action: {command: string, intent?: string}|null}>}
 */
export async function askGroq(
  chatId,
  question,
  { context = null, allowCommands = false } = {},
) {
  const apiKey = getApiKey("groq_api_key");

  if (!apiKey) {
    throw new Error(MISSING_KEY_MESSAGE);
  }

  const messages = histories.get(chatId) || [];
  messages.push({ role: "user", content: question });

  // O histórico guarda só a conversa; a instrução de sistema é prefixada em
  // cada pedido para o âmbito (bot, contas e conversa básica) não se perder ao
  // fim de algumas mensagens. O conhecimento do bot e o bloco de estado (quando
  // existe) vão junto.
  const system = [{ role: "system", content: GROQ_SYSTEM_PROMPT }];

  // Conhecimento do bot (comandos reais + fluxo de recarga) para todos: é o que
  // permite responder a "como recarregar?" sem inventar. Se a leitura falhar, a
  // IA responde sem o guia em vez de o comando rebentar.
  try {
    system.push({ role: "system", content: await botKnowledgeText() });
  } catch (error) {
    errorLog(`Conhecimento do bot indisponível para a IA: ${error.message}`);
  }

  // Só quem tem permissão (dono ou admin do grupo) pode pedir uma acção. O
  // prompt lista o que existe; a permissão real é verificada no despacho.
  if (allowCommands) {
    system.push({ role: "system", content: aiActionHelpText() });
    system.push({ role: "system", content: GROQ_ACTION_PROMPT });
  }

  if (context) {
    system.push({ role: "system", content: GROQ_OWNER_CONTEXT_PROMPT });
    system.push({ role: "system", content: context });
  }

  const recent = [...system, ...messages.slice(-GROQ_HISTORY_SIZE)];
  let lastError;

  for (const model of GROQ_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const response = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: recent,
          temperature: GROQ_TEMPERATURE,
          top_p: GROQ_TOP_P,
          max_completion_tokens: GROQ_MAX_TOKENS,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        lastError = new Error(`Groq ${response.status}`);

        if (!RETRYABLE_STATUS.includes(response.status)) {
          break;
        }

        continue;
      }

      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content?.trim();

      if (!raw) {
        throw new Error("A IA não retornou uma resposta.");
      }

      const action = allowCommands ? parseAiAction(raw) : null;
      const answer = action ? "" : raw.slice(0, 4000);

      // O histórico guarda o que o usuário viu. Para uma acção, guarda um
      // resumo legível: o JSON cru não deve reaparecer numa resposta futura.
      const historico = action
        ? `[pedido de comando: ${action.command}]`
        : answer;

      messages.push({ role: "assistant", content: historico });
      histories.set(chatId, messages.slice(-GROQ_HISTORY_SIZE));

      return { text: answer, action };
    } catch (error) {
      lastError = error;
      errorLog(`Groq (${model}): ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    "Não consegui obter uma resposta da IA agora. Tente novamente mais tarde.",
    { cause: lastError },
  );
}

/**
 * Interpreta a resposta da IA como pedido de execução.
 *
 * O modelo pode embrulhar o JSON em crases apesar da instrução, por isso as
 * cercas são removidas antes do `JSON.parse`. Qualquer resposta que não seja um
 * pedido válido devolve `null` e segue como texto normal — nunca lança.
 *
 * @param {string} raw resposta crua do modelo
 * @returns {{command: string, intent?: string}|null}
 */
export function parseAiAction(raw) {
  const limpo = String(raw || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  if (!limpo.startsWith("{")) {
    return null;
  }

  let data;

  try {
    data = JSON.parse(limpo);
  } catch {
    return null;
  }

  if (data?.action !== "run" || typeof data.command !== "string") {
    return null;
  }

  const command = data.command.trim();

  if (!command) {
    return null;
  }

  const intent = data.intent === "off" ? "off" : data.intent === "on" ? "on" : undefined;

  return intent ? { command, intent } : { command };
}

/**
 * Transcreve um áudio com o Whisper da Groq.
 *
 * @param {Buffer} audioBuffer conteúdo do áudio
 * @param {string} mimeType tipo do arquivo (ex: audio/ogg)
 * @param {string} fileName nome enviado no multipart (ex: audio.ogg)
 * @returns {Promise<string>} texto transcrito
 */
export async function transcribeAudio(
  audioBuffer,
  mimeType = "audio/ogg",
  fileName = "audio.ogg",
) {
  const apiKey = getApiKey("groq_api_key");

  if (!apiKey) {
    throw new Error(MISSING_KEY_MESSAGE);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const form = new FormData();
    form.append("file", new Blob([audioBuffer], { type: mimeType }), fileName);
    form.append("model", GROQ_TRANSCRIPTION_MODEL);
    form.append("language", GROQ_TRANSCRIPTION_LANGUAGE);
    form.append("response_format", "json");

    const response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Groq retornou HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data?.text) {
      throw new Error("A transcrição veio vazia.");
    }

    return data.text;
  } finally {
    clearTimeout(timer);
  }
}
