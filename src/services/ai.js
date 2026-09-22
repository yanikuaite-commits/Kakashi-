import { AI_TIMEOUT_MS, HF_MODELS, HF_TOKEN } from "../config.js";

const histories = new Map();

export async function askHuggingFace(chatId, question) {
  const token = HF_TOKEN;
  if (!token) throw new Error("A IA está indisponível: configure HF_TOKEN no ambiente do bot.");
  const messages = histories.get(chatId) || [];
  messages.push({ role: "user", content: question });
  const recent = messages.slice(-10);
  let lastError;
  for (const model of HF_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: recent, max_tokens: 1024 }),
        signal: controller.signal,
      });
      if (!response.ok) {
        lastError = new Error(`HF ${response.status}`);
        if (![429, 503].includes(response.status)) break;
        continue;
      }
      const data = await response.json();
      const answer = data?.choices?.[0]?.message?.content?.trim();
      if (!answer) throw new Error("A IA não retornou uma resposta.");
      messages.push({ role: "assistant", content: answer });
      histories.set(chatId, messages.slice(-10));
      return answer.slice(0, 4000);
    } catch (error) {
      lastError = error;
      console.error(`Hugging Face (${model}):`, error.message);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Não consegui obter uma resposta da IA agora. Tente novamente mais tarde.", { cause: lastError });
}

export async function transcribeAudio(audioBuffer, mimeType = "audio/ogg") {
  const token = HF_TOKEN;
  if (!token) throw new Error("A transcrição está indisponível: configure HF_TOKEN no ambiente do bot.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch("https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
      body: audioBuffer,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Hugging Face retornou HTTP ${response.status}`);
    const data = await response.json();
    if (!data?.text) throw new Error("A transcrição veio vazia.");
    return data.text;
  } finally {
    clearTimeout(timer);
  }
}