import path from "node:path";
import { ASSETS_DIR, PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { menuMessage } from "../../menu.js";
import { getPrefix } from "../../utils/database.js";
import { startGuidedMenu } from "../../interactive/flow.js";
import { CATEGORIES } from "../../interactive/menuRegistry.js";
import { sendMainMenu } from "../../utils/mainMenu.js";

export default {
  name: "menu",
  description: "Menu de comandos",
  commands: ["menu"],
  usage: `${PREFIX}menu [categoria]`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    socket,
    remoteJid,
    fullArgs,
    webMessage,
    sendSuccessReact,
    sendImageFromFile,
    sendReply,
    userLid,
    isOwner,
  }) => {
    if (typeof sendSuccessReact === "function") {
      await sendSuccessReact().catch(() => {});
    }

    const section = String(fullArgs || "").trim();
    const chave = section.toLowerCase();
    const categoria = section
      ? CATEGORIES.find(
          (item) => item.id === chave || item.aliases.includes(chave),
        )
      : null;

    if (section && !categoria) {
      throw new InvalidParameterError(
        `Categoria desconhecida. Use ${getPrefix(remoteJid)}menu para ver as opções.`,
      );
    }

    const ownerId =
      userLid || (remoteJid.endsWith("@g.us") ? "" : remoteJid);

    if (socket && typeof sendReply === "function" && ownerId) {
      const permissions = isOwner ? { isOwner: true, isAdmin: true } : undefined;

      // `.menu <categoria>` continua a abrir o card da categoria.
      if (categoria) {
        const sent = await startGuidedMenu({
          socket,
          chatId: remoteJid,
          ownerId,
          ownerName: webMessage?.pushName,
          sendReply,
          webMessage,
          section: categoria.id,
          permissions,
        });

        if (sent) return;
      } else {
        // `.menu` abre o card visual principal (com fallbacks).
        const sent = await sendMainMenu(socket, remoteJid, {
          ownerId,
          ownerName: webMessage?.pushName,
          sendReply,
          webMessage,
          permissions,
          timestamp: webMessage?.messageTimestamp,
        });

        if (sent) return;
      }
    }

    // Sem socket (ou sem autor confirmado): mantém o card de texto antigo.
    const caption = menuMessage(
      remoteJid,
      categoria ? categoria.id : section,
      webMessage?.pushName,
    );

    if (!caption) {
      throw new InvalidParameterError(
        `Categoria desconhecida. Use ${getPrefix(remoteJid)}menu para ver as opções.`,
      );
    }

    if (typeof sendImageFromFile === "function") {
      await sendImageFromFile(
        path.join(ASSETS_DIR, "images", "takeshi-bot.png"),
        caption,
      );
    }
  },
};
