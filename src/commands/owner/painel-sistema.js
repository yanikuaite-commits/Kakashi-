import { PREFIX } from "../../config.js";
import { renderPanelTab } from "./painel.js";
import { sendPanel } from "../../utils/dashboardMenu.js";

export default {
  name: "painel-sistema",
  description: "Painel de administração — aba Sistema",
  commands: ["painel-sistema", "psistema"],
  usage: `${PREFIX}painel-sistema`,
  handle: async ({ socket, remoteJid, userLid, sendReply, textOnly }) => {
    await sendPanel({
      socket,
      chatId: remoteJid,
      ownerId: userLid || remoteJid,
      sendReply,
      corpo: renderPanelTab("sistema"),
      textOnly,
    });
  },
};
