import { PREFIX } from "../../config.js";
import { renderPanelTab } from "./painel.js";
import { sendPanel } from "../../utils/dashboardMenu.js";

export default {
  name: "painel-whitelist",
  description: "Painel de administração — aba Whitelist",
  commands: ["painel-whitelist", "pwhitelist"],
  usage: `${PREFIX}painel-whitelist`,
  handle: async ({ socket, remoteJid, userLid, sendReply, textOnly }) => {
    await sendPanel({
      socket,
      chatId: remoteJid,
      ownerId: userLid || remoteJid,
      sendReply,
      corpo: renderPanelTab("whitelist"),
      textOnly,
    });
  },
};
