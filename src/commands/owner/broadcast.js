import { PREFIX } from "../../config.js";
import { DangerError, InvalidParameterError } from "../../errors/index.js";
import {
  broadcastToAllGroups,
  listJoinedGroupIds,
} from "../../utils/afkBroadcast.js";
import {
  clearInteractiveMenu,
  createInteractiveActionId,
  numberedFallback,
  sendInteractiveWithFallback,
} from "../../utils/interactive.js";
import { formatMessage } from "../../utils/formatMessage.js";

export const BROADCAST_SESSION_TTL_MS = 5 * 60 * 1000;

/** Mensagem à espera de destino, por chat+dono. */
const broadcastSessions = new Map();

function sessionKey(chatId, ownerId) {
  return `${chatId}:${ownerId}`;
}

function clearSession(chatId, ownerId) {
  const key = sessionKey(chatId, ownerId);
  const session = broadcastSessions.get(key);
  if (session?.timer) clearTimeout(session.timer);
  broadcastSessions.delete(key);
}

function saveSession(chatId, ownerId, texto) {
  clearSession(chatId, ownerId);
  const key = sessionKey(chatId, ownerId);
  const session = { texto, timer: null };
  session.timer = setTimeout(() => {
    if (broadcastSessions.get(key) === session) broadcastSessions.delete(key);
  }, BROADCAST_SESSION_TTL_MS);
  session.timer.unref?.();
  broadcastSessions.set(key, session);
}

function getSession(chatId, ownerId) {
  return broadcastSessions.get(sessionKey(chatId, ownerId)) || null;
}

/**
 * `rowId` da lista: um token opaco que o WhatsApp não descarta (rowIds longos
 * são cortados) e que o `sendInteractiveWithFallback` mapeia para o destino
 * real ("all" ou o JID do grupo).
 */
function rowIdFor() {
  return createInteractiveActionId();
}

export default {
  name: "broadcast",
  description: "Envia uma mensagem do dono para um grupo ou para todos.",
  commands: ["broadcast", "enviar-todos", "disparar"],
  usage: `${PREFIX}broadcast <mensagem>`,
  handle: async ({ fullArgs, isOwner, sendReply, socket, remoteJid, userLid, prefix }) => {
    if (!isOwner) {
      throw new DangerError("Apenas o dono pode usar.");
    }

    const prefixo = prefix || PREFIX;
    const ownerId = userLid || remoteJid;

    // Passo 2: o destino escolhido na lista. O `responseMappings` e as
    // `fallbackActions` despacham `<prefixo>broadcast <alvo>`, por isso a
    // mensagem original é recuperada da sessão — nunca reconstruída por `slice`,
    // que cortava a última palavra.
    const alvo = String(fullArgs || "").trim();
    const session = getSession(remoteJid, ownerId);

    if (alvo === "all" || alvo.endsWith("@g.us")) {
      if (!session?.texto) {
        throw new InvalidParameterError(
          `Sessão de broadcast expirada. Recomeça com ${prefixo}broadcast <mensagem>.`,
        );
      }

      clearSession(remoteJid, ownerId);

      const corpo = formatMessage({
        icone: "📢",
        titulo: "Aviso",
        campos: [session.texto],
      });

      if (alvo === "all") {
        const enviados = await broadcastToAllGroups({ socket, text: corpo });
        await sendReply(`✅ Aviso enviado para ${enviados} grupo(s).`);
        return;
      }

      await socket.sendMessage(alvo, { text: corpo });
      await sendReply("✅ Aviso enviado para o grupo escolhido.");
      return;
    }

    // Passo 1: sem destino, o texto do comando é a mensagem a transmitir.
    const texto = alvo;
    if (!texto) {
      throw new InvalidParameterError(
        `Informe a mensagem. Ex: ${prefixo}broadcast Manutenção hoje às 22h.`,
      );
    }

    const groupIds = await listJoinedGroupIds(socket);
    const groups = await Promise.all(
      groupIds.map(async (id) => ({
        id,
        name: (await socket.groupMetadata(id))?.subject || "Grupo sem nome",
      })),
    );

    const destinos = [
      {
        target: "all",
        title: "📢 Todos os grupos",
        description: `${groups.length} grupo(s)`,
      },
      ...groups.map((g) => ({
        target: g.id,
        title: g.name.slice(0, 32),
        description: g.id,
      })),
    ];

    const opcoes = destinos.map((destino, index) => ({
      ...destino,
      numero: String(index + 1),
      token: rowIdFor(),
    }));

    saveSession(remoteJid, ownerId, texto);

    clearInteractiveMenu(remoteJid, ownerId);

    await sendInteractiveWithFallback({
      socket,
      chatId: remoteJid,
      content: {
        text: formatMessage({
          icone: "📡",
          titulo: "Broadcast",
          campos: [
            "Escolhe o destino do aviso:",
            "",
            `“${texto.length > 60 ? `${texto.slice(0, 60)}…` : texto}”`,
          ],
        }),
        title: "Broadcast",
        buttonText: "Escolher destino",
        sections: [
          {
            title: "Destinos",
            rows: opcoes.map(({ token, title, description }) => ({
              title,
              description,
              rowId: token,
            })),
          },
        ],
        viewOnce: true,
      },
      fallbackText: numberedFallback(
        opcoes.map(({ numero, title }) => ({ number: numero, title })),
        "Responde com o número do destino 👇",
      ),
      fallbackActions: opcoes.map(({ numero, target }) => ({
        number: numero,
        id: `${prefixo}broadcast ${target}`,
      })),
      responseMappings: opcoes.map(({ token, target }) => ({
        id: token,
        target: `${prefixo}broadcast ${target}`,
      })),
      ownerId,
      sendReply,
    });
  },
};
