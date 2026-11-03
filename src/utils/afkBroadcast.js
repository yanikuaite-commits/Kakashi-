/**
 * Aviso de ausência global.
 *
 * Quando o dono fica ausente, a mensagem tem de chegar a TODOS os grupos onde o
 * bot está, não só ao grupo onde ele escreveu o comando. A lista de grupos vem
 * do próprio socket (`groupFetchAllParticipating`), porque é o WhatsApp que
 * sabe onde o bot está de facto — uma lista guardada no disco ficaria
 * desatualizada a cada grupo criado ou onde o bot sai.
 *
 * @author Dev Yanik
 */
import { delay } from "baileys";
import { infoLog, warningLog } from "./logger.js";

// Espera entre grupos: enviar a mesma mensagem a muitos grupos de uma vez é o
// padrão que o WhatsApp lê como spam e pune com ban.
export const BROADCAST_DELAY_MS = 1200;

/**
 * IDs de todos os grupos em que o bot participa.
 *
 * @param {import("baileys").WASocket} socket
 * @returns {Promise<string[]>}
 */
export async function listJoinedGroupIds(socket) {
  if (typeof socket?.groupFetchAllParticipating !== "function") {
    return [];
  }

  try {
    const groups = await socket.groupFetchAllParticipating();
    return Object.keys(groups || {});
  } catch (error) {
    warningLog(`[afk] não consegui listar os grupos: ${error.message}`);
    return [];
  }
}

/**
 * Envia o aviso de ausência a todos os grupos, saltando o grupo de origem (que
 * já recebeu a resposta do comando).
 *
 * Nunca lança: um grupo que falha não pode impedir os restantes nem rebentar o
 * comando que o dono acabou de executar.
 *
 * @param {object} params
 * @param {import("baileys").WASocket} params.socket
 * @param {string} params.text mensagem já formatada
 * @param {string[]} [params.mentions] membros a marcar na mensagem
 * @param {string} [params.skipJid] grupo a não repetir
 * @param {number} [params.delayMs] espera entre grupos (injetável nos testes)
 * @returns {Promise<number>} quantos grupos receberam o aviso
 */
export async function broadcastToAllGroups({
  socket,
  text,
  mentions = [],
  skipJid,
  delayMs = BROADCAST_DELAY_MS,
}) {
  const groupIds = (await listJoinedGroupIds(socket)).filter(
    (id) => id !== skipJid,
  );

  let enviados = 0;

  for (const groupId of groupIds) {
    try {
      await socket.sendMessage(groupId, { text, mentions });
      enviados += 1;
    } catch (error) {
      warningLog(`[afk] falha ao avisar ${groupId}: ${error.message}`);
    }

    await delay(delayMs);
  }

  infoLog(`[afk] aviso de ausência enviado a ${enviados}/${groupIds.length} grupos`);

  return enviados;
}
