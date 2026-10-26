import { PREFIX } from "../../config.js";
import { renderPanelTab } from "./painel.js";
import { sendPanel } from "../../utils/dashboardMenu.js";

export default {
  name: "painel-graficos",
  description: "Painel de administração — aba Gráficos",
  commands: ["painel-graficos", "pgraficos"],
  usage: `${PREFIX}painel-graficos`,
  handle: async ({ socket, remoteJid, userLid, sendReply, textOnly }) => {
    await sendPanel({
      socket,
      chatId: remoteJid,
      ownerId: userLid || remoteJid,
      sendReply,
      corpo: renderPanelTab("graficos"),
      textOnly,
    });
  },
};
