import {
  GEMINI_API_KEY,
  GEMINI_IMAGE_API,
  GEMINI_IMAGE_ASPECT_RATIO,
  GEMINI_IMAGE_MODEL,
  GEMINI_IMAGE_SIZE,
  GEMINI_IMAGE_TIMEOUT_MS,
} from "../config.js";
import { errorLog } from "../utils/logger.js";

/**
 * A geração de imagem não existe na Groq, então usa a Google Gemini.
 * Sem a chave configurada os comandos continuam funcionando com o serviço
 * gratuito de antes (Pollinations).
 *
 * @returns {boolean}
 */
export function isGeminiConfigured() {
  return Boolean(GEMINI_API_KEY);
}

async function generateContent({ api, model, body, timeoutMs, label }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${api}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `Gemini ${response.status}: ${String(details).slice(0, 200)}`,
      );
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const part = parts.find((item) => item?.inlineData?.data);

    if (!part) {
      throw new Error("A Gemini não retornou mídia na resposta.");
    }

    return {
      buffer: Buffer.from(part.inlineData.data, "base64"),
      mimeType: part.inlineData.mimeType || "",
    };
  } catch (error) {
    errorLog(`Gemini (${label}): ${error.message}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gera uma imagem a partir de uma descrição.
 *
 * @param {string} prompt descrição da imagem
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
export async function generateImage(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "A geração de imagem está indisponível: preencha GEMINI_API_KEY em src/config.js (ou defina GEMINI_API_KEY no ambiente do bot).",
    );
  }

  return generateContent({
    api: GEMINI_IMAGE_API,
    model: GEMINI_IMAGE_MODEL,
    timeoutMs: GEMINI_IMAGE_TIMEOUT_MS,
    label: "imagem",
    body: {
      contents: [
        {
          role: "user",
          parts: [{ text: String(prompt || "").trim() }],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        // O generateContent usa generationConfig.imageConfig; o formato
        // generationConfig.responseFormat.image pertence a outra API e o Google
        // responde 400 Invalid value at '...aspect_ratio'.
        imageConfig: {
          aspectRatio: GEMINI_IMAGE_ASPECT_RATIO,
          imageSize: GEMINI_IMAGE_SIZE,
        },
      },
    },
  });
}
