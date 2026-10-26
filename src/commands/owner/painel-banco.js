import { PREFIX } from "../../config.js";
import { renderPanelTab } from "./painel.js";
import { sendPanel } from "../../utils/dashboardMenu.js";

export default {
  name: "painel-banco",
  description: "Painel de administração — aba Banco de dados",
  commands: ["painel-banco", "pbanco"],
  usage: `${PREFIX}painel-banco`,
  handle: async ({ socket, remoteJid, userLid, sendReply, textOnly }) => {
    await sendPanel({
      socket,
      chatId: remoteJid,
      ownerId: userLid || remoteJid,
      sendReply,
      corpo: renderPanelTab("banco"),
      textOnly,
    });
  },
};
