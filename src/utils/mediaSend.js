/**
 * Regras de envio por tamanho (Partes 1, 2 e 3 do sistema de downloads).
 *
 * Centraliza a decisão "vídeo ou documento?" para não repetir a mesma
 * aritmética em cada comando. As funções são puras (não tocam no socket nem no
 * disco), o que as torna testáveis sem Baileys.
 *
 * Regras:
 * - plataformas gerais (TikTok, Instagram, X, Facebook, Pinterest, baixar):
 *   enviam SEMPRE como vídeo, independente do tamanho;
 * - YouTube: documento acima de 100 MB, vídeo até 100 MB;
 * - animes: cancela acima de 150 MB, documento entre 100 MB e 150 MB, vídeo
 *   até 100 MB.
 *
 * @author Dev Gui
 */

const MB = 1024 * 1024;

export const WHATSAPP_VIDEO_LIMIT_MB = 100;
export const ANIME_DOCUMENT_LIMIT_MB = 150;

/**
 * Converte bytes em MB (base 1024).
 *
 * @param {number} bytes
 * @returns {number}
 */
export function toMegabytes(bytes) {
  return Number(bytes || 0) / MB;
}

/**
 * Decide o envio do YouTube: documento se passar de 100 MB, senão vídeo.
 *
 * @param {number} bytes
 * @param {number} [limitMb]
 * @returns {"document"|"video"}
 */
export function decideYouTubeSend(bytes, limitMb = WHATSAPP_VIDEO_LIMIT_MB) {
  return toMegabytes(bytes) > limitMb ? "document" : "video";
}

/**
 * Decide o envio de plataformas gerais: sempre vídeo.
 *
 * @returns {"video"}
 */
export function decideGeneralSend() {
  return "video";
}

/**
 * Decide o envio de animes.
 *
 * @param {number} bytes
 * @param {{ videoLimitMb?: number, documentLimitMb?: number }} [limits]
 * @returns {"cancel"|"document"|"video"}
 */
export function decideAnimeSend(
  bytes,
  { videoLimitMb = WHATSAPP_VIDEO_LIMIT_MB, documentLimitMb = ANIME_DOCUMENT_LIMIT_MB } = {},
) {
  const tamanhoMB = toMegabytes(bytes);

  if (tamanhoMB > documentLimitMb) return "cancel";
  if (tamanhoMB > videoLimitMb) return "document";
  return "video";
}

/**
 * Mensagem do cancelamento por excesso de tamanho nos animes.
 *
 * @param {number} [limitMb]
 * @returns {string}
 */
export function animeTooLargeMessage(limitMb = ANIME_DOCUMENT_LIMIT_MB) {
  return `❌ O arquivo tem mais de ${limitMb}MB. Por favor, escolha uma qualidade mais baixa.`;
}
