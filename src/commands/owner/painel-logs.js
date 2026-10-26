import { PREFIX } from "../../config.js";
import { renderPanelTab } from "./painel.js";
import { sendPanel } from "../../utils/dashboardMenu.js";

export default {
  name: "painel-logs",
  description: "Painel de administração — aba Logs",
  commands: ["painel-logs", "plogs"],
  usage: `${PREFIX}painel-logs`,
  handle: async ({ socket, remoteJid, userLid, sendReply, textOnly }) => {
    await sendPanel({
      socket,
      chatId: remoteJid,
      ownerId: userLid || remoteJid,
      sendReply,
      corpo: renderPanelTab("logs"),
      textOnly,
    });
  },
};
