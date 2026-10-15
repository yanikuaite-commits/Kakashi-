import {
  AI_TIMEOUT_MS,
  GROQ_API_KEY,
  GROQ_CHAT_URL,
  GROQ_HISTORY_SIZE,
  GROQ_MAX_TOKENS,
  GROQ_MODELS,
  GROQ_TEMPERATURE,
  GROQ_TOP_P,
  GROQ_TRANSCRIPTION_LANGUAGE,
  GROQ_TRANSCRIPTION_MODEL,
  GROQ_TRANSCRIPTION_URL,
} from "../config.js";
import { errorLog } from "../utils/logger.js";

const histories = new Map();

// Status em que vale a pena tentar o próximo modelo da lista.
const RETRYABLE_STATUS = [429, 500, 502, 503];

const MISSING_KEY_MESSAGE =
  "A IA está indisponível: preencha GROQ_API_KEY em src/config.js (ou defina GROQ_API_KEY no ambiente do bot).";

/**
 * Conversa com a IA da Groq (chat completions), mantendo um histórico curto
 * por conversa.
 *
 * @param {string} chatId identificador da conversa (grupo ou privado)
 * @param {string} question pergunta do usuário
 * @returns {Promise<string>} resposta da IA
 */
export async function askGroq(chatId, question) {
  if (!GROQ_API_KEY) {
    throw new Error(MISSING_KEY_MESSAGE);
  }

  const messages = histories.get(chatId) || [];
  messages.push({ role: "user", content: question });

  const recent = messages.slice(-GROQ_HISTORY_SIZE);
  let lastError;

  for (const model of GROQ_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const response = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
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
      const answer = data?.choices?.[0]?.message?.content?.trim();

      if (!answer) {
        throw new Error("A IA não retornou uma resposta.");
      }

      messages.push({ role: "assistant", content: answer });
      histories.set(chatId, messages.slice(-GROQ_HISTORY_SIZE));

      return answer.slice(0, 4000);
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
  if (!GROQ_API_KEY) {
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
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
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
