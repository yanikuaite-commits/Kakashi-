/**
 * Mensagem padronizada de "bot está baixando",
 * usada por todos os comandos de download.
 *
 * Usa o template CARREGANDO do formatMessage (molde único + rodapé).
 */
import { formatMessage } from "../utils/formatMessage.js";

export function downloadingMessage({
  fileType = "vídeo",
  usuario,
  plataforma,
} = {}) {
  const sender = String(usuario || "")
    .replace(/[\r\n*_`@]/g, "")
    .slice(0, 32);

  const campos = [
    sender
      ? `⏳ Já estou a tratar do teu pedido, @${sender}... 🔄`
      : `⏳ Já estou a tratar do teu pedido... 🔄`,
  ];

  if (plataforma) campos.push(`📱 *Plataforma:* ${plataforma}`);
  campos.push(`📥 *Tipo:* ${fileType}`);

  return formatMessage({ icone: "⏳", titulo: "Carregando", campos });
}