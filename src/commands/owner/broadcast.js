import { DangerError } from "../../errors/index.js";
import { listJoinedGroupIds } from "../../utils/afkBroadcast.js";
import {
  sendInteractiveWithFallback,
  singleSelectButton,
  handleInteractiveMenuReply,
} from "../../utils/interactive.js";
import { formatMessage } from "../../utils/formatMessage.js";

export default {
  name: "broadcast",
  description: "Envia uma mensagem para grupos.",
  commands: ["broadcast", "enviar-todos", "disparar"],
  usage: "broadcast <mensagem>",
  handle: async ({ fullArgs, isOwner, sendReply, socket, remoteJid, userLid, fullMessage }) => {
    if (!isOwner) throw new DangerError("Apenas o dono pode usar.");

    // Se o dono já selecionou um grupo (resposta do menu)
    const menuReply = await handleInteractiveMenuReply({
      chatId: remoteJid,
      senderId: userLid,
      text: fullMessage,
      sendReply,
    });

    if (menuReply?.selectedId && menuReply.selectedId.startsWith("bc:")) {
      const selectedId = menuReply.selectedId;
      let targetGroups = [];

      if (selectedId === "bc:all") {
        targetGroups = await listJoinedGroupIds(socket);
      } else if (selectedId.startsWith("bc:group:")) {
        targetGroups = [selectedId.replace("bc:group:", "")];
      }

      const mensagem = fullArgs.split(" ").slice(0, -1).join(" "); // Simples para teste
      const corpo = formatMessage({ icone: "📢", titulo: "Aviso", campos: [mensagem] });

      for (const groupId of targetGroups) {
        await socket.sendMessage(groupId, { text: corpo });
      }
      return sendReply(`✅ Enviado para ${targetGroups.length} grupo(s).`);
    }

    // Fluxo inicial: criar mensagem
    const texto = String(fullArgs || "").trim();
    if (!texto) throw new DangerError("Informe a mensagem.");

    const groupIds = await listJoinedGroupIds(socket);
    const groups = await Promise.all(
      groupIds.map(async (id) => ({
        id,
        name: (await socket.groupMetadata(id)).subject || "Grupo sem nome",
      }))
    );

    const rows = [
      { id: "bc:all", title: "📢 Todos os grupos", description: "Envia para todos" },
      ...groups.map((g) => ({
        id: `bc:group:${g.id}`,
        title: g.name.slice(0, 32),
        description: g.id,
      })),
    ];

    const content = {
      text: formatMessage({
        icone: "📡",
        titulo: "Broadcast",
        campos: ["Selecione o grupo para enviar:", `"${texto.slice(0, 50)}..."`],
      }),
      interactiveButtons: [
        singleSelectButton("Selecionar", [{ title: "Grupos", rows }], { title: "Grupos" }),
      ],
      viewOnce: true,
    };

    await sendInteractiveWithFallback({
      socket,
      chatId: remoteJid,
      content,
      fallbackText: "Grupos:\n" + rows.map((r, i) => `${i + 1}. ${r.title}`).join("\n"),
      sendReply,
      ownerId: userLid,
      responseMappings: rows.map((r) => ({ id: r.id, target: r.id })),
    });
  },
};