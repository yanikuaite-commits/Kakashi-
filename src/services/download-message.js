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

/**
 * Aviso de espera na fila de downloads.
 *
 * Sem isto o usuário fica em silêncio enquanto outro download corre e volta a
 * pedir, o que só agrava a fila. Dizer a posição torna a espera previsível.
 */
export function queuedMessage({ position } = {}) {
  const lugar = Number(position) > 0 ? Number(position) : 1;

  return formatMessage({
    icone: "🕒",
    titulo: "Na fila",
    campos: [
      `🕒 Há downloads a correr agora. Você é o *${lugar}.º* da fila.`,
      "Assim que chegar a sua vez, eu aviso e começo a baixar.",
    ],
  });
}

/** Aviso de que a vez do usuário chegou e o download arrancou. */
export function downloadTurnMessage() {
  return formatMessage({
    icone: "▶️",
    titulo: "É a sua vez",
    campos: ["▶️ Chegou a sua vez! Comecei a baixar agora."],
  });
}