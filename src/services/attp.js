import { ATTP_APIS, ATTP_TIMEOUT_MS } from "../config.js";

export async function generateAttp(text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("Você precisa informar o texto da figurinha.");
  for (const baseUrl of ATTP_APIS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTP_TIMEOUT_MS);
    try {
      const response = await fetch(baseUrl + encodeURIComponent(value), { signal: controller.signal });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      console.error("ATTP fallback:", error.message);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Não foi possível gerar a figurinha animada agora. Tente novamente mais tarde.");
}