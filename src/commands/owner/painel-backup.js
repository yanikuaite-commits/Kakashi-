import { PREFIX } from "../../config.js";
import { renderPanelTab } from "./painel.js";
import { sendPanel } from "../../utils/dashboardMenu.js";

export default {
  name: "painel-backup",
  description: "Painel de administração — aba Backup",
  commands: ["painel-backup", "pbackup"],
  usage: `${PREFIX}painel-backup`,
  handle: async ({ socket, remoteJid, userLid, sendReply, textOnly }) => {
    await sendPanel({
      socket,
      chatId: remoteJid,
      ownerId: userLid || remoteJid,
      sendReply,
      corpo: renderPanelTab("backup"),
      textOnly,
    });
  },
};
