import { PREFIX } from "../../config.js";
import { renderPanelTab } from "./painel.js";
import { sendPanel } from "../../utils/dashboardMenu.js";

export default {
  name: "painel-blacklist",
  description: "Painel de administração — aba Blacklist",
  commands: ["painel-blacklist", "pblacklist"],
  usage: `${PREFIX}painel-blacklist`,
  handle: async ({ socket, remoteJid, userLid, sendReply, textOnly }) => {
    await sendPanel({
      socket,
      chatId: remoteJid,
      ownerId: userLid || remoteJid,
      sendReply,
      corpo: renderPanelTab("blacklist"),
      textOnly,
    });
  },
};
