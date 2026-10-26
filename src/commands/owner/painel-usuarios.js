import { PREFIX } from "../../config.js";
import { renderPanelTab } from "./painel.js";
import { sendPanel } from "../../utils/dashboardMenu.js";

export default {
  name: "painel-usuarios",
  description: "Painel de administração — aba Usuários",
  commands: ["painel-usuarios", "pusuarios"],
  usage: `${PREFIX}painel-usuarios`,
  handle: async ({ socket, remoteJid, userLid, sendReply, textOnly }) => {
    await sendPanel({
      socket,
      chatId: remoteJid,
      ownerId: userLid || remoteJid,
      sendReply,
      corpo: renderPanelTab("usuarios"),
      textOnly,
    });
  },
};
