import { PREFIX } from "../../config.js";
import { renderPanelTab } from "./painel.js";
import { sendPanel } from "../../utils/dashboardMenu.js";

export default {
  name: "painel-config",
  description: "Painel de administração — aba Configurações",
  commands: ["painel-config", "pconfig"],
  usage: `${PREFIX}painel-config`,
  handle: async ({ socket, remoteJid, userLid, sendReply, textOnly }) => {
    await sendPanel({
      socket,
      chatId: remoteJid,
      ownerId: userLid || remoteJid,
      sendReply,
      corpo: renderPanelTab("config"),
      textOnly,
    });
  },
};
