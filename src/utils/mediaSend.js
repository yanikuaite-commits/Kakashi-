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
 * - animes: mesma regra do YouTube (documento acima de 100 MB), mas com um
 *   teto maior — acima de 200 MB o envio é cancelado.
 *
 * @author Dev Gui
 */
import { ANIME_DOCUMENT_LIMIT_MB } from "../config.js";
import fs from "node:fs";

/**
 * Payload de mídia para o Baileys a partir de um ficheiro, lido em stream.
 *
 * O Baileys aceita `{ stream }` e processa o ficheiro em pedaços. Carregá-lo
 * inteiro com `readFileSync` custa o tamanho do ficheiro em RSS: um episódio de
 * 350 MB sobe ~350 MB num plano de 512 MB e o processo é morto por OOM.
 *
 * @param {string} filePath
 * @returns {{ stream: import("node:fs").ReadStream }}
 */
export function mediaUploadFromFile(filePath) {
  return { stream: fs.createReadStream(filePath) };
}

const MB = 1024 * 1024;

export { ANIME_DOCUMENT_LIMIT_MB };

export const WHATSAPP_VIDEO_LIMIT_MB = 100;

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
 * Nome do ficheiro a partir do título da pesquisa.
 *
 * Um download nomeado "megacine.mp4" chega ao destinatário sem qualquer
 * relação com o que pediu: quem guarda vários episódios fica com ficheiros
 * indistinguíveis. O nome passa a ser o título (com a temporada/episódio quando
 * existe).
 *
 * Só tem efeito em DOCUMENTOS: o proto `VideoMessage` do WhatsApp não tem campo
 * de nome, por isso um vídeo enviado como vídeo não pode trazer nome nenhum.
 *
 * @param {string} base título já legível (ex.: "The Boys — T1 Ep. 1")
 * @param {string} [extension]
 * @param {{fallback?: string, maxLength?: number}} [options]
 * @returns {string}
 */
export function safeMediaFileName(
  base,
  extension = "mp4",
  { fallback = "video", maxLength = 120 } = {},
) {
  const limpo = String(base ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, maxLength)
    // As pontas ficam sujas quando o título começa ou acaba num carácter
    // inválido (ex.: "Rato: ...|" → "Rato- ...-").
    .replace(/^[-\s.]+|[-\s.]+$/g, "");

  // Um nome só com separadores ("---", "...") não identifica nada: fica o
  // fallback em vez de um ficheiro anónimo.
  const util = /[\p{L}\p{N}]/u.test(limpo) ? limpo : "";

  return `${util || fallback}.${extension}`;
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
 * Decide o envio de animes: a mesma regra do YouTube (documento acima de
 * 100 MB), mas com um teto próprio — acima de `documentLimitMb` cancela em vez
 * de enviar.
 *
 * @param {number} bytes
 * @param {{ videoLimitMb?: number, documentLimitMb?: number }} [limits]
 * @returns {"cancel"|"document"|"video"}
 */
export function decideAnimeSend(
  bytes,
  { videoLimitMb = WHATSAPP_VIDEO_LIMIT_MB, documentLimitMb = ANIME_DOCUMENT_LIMIT_MB } = {},
) {
  if (toMegabytes(bytes) > documentLimitMb) return "cancel";

  return decideYouTubeSend(bytes, videoLimitMb);
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
