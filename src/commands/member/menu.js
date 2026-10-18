import path from "node:path";
import { ASSETS_DIR, PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { buildInteractiveMenuPayload, menuMessage } from "../../menu.js";
import { getPrefix } from "../../utils/database.js";
import { sendInteractiveWithFallback } from "../../utils/interactive.js";

export default {
  name: "menu",
  description: "Menu de comandos",
  commands: ["menu", "help"],
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
  }) => {
    const section = String(fullArgs || "").trim();
    const caption = menuMessage(remoteJid, section, webMessage?.pushName);
    const interactive = buildInteractiveMenuPayload(remoteJid, section, webMessage?.pushName);

    if (section && !caption && !interactive) {
      throw new InvalidParameterError(`Categoria desconhecida. Use ${getPrefix(remoteJid)}menu para ver as opções.`);
    }

    if (typeof sendSuccessReact === "function") {
      await sendSuccessReact();
    }

    if (socket && typeof sendReply === "function" && interactive) {
      const ownerId = userLid || (remoteJid.endsWith("@g.us") ? "" : remoteJid);
      await sendInteractiveWithFallback({
        socket,
        chatId: remoteJid,
        content: interactive.content,
        fallbackText: interactive.fallbackText,
        fallbackActions: interactive.fallbackActions,
        responseMappings: interactive.responseMappings,
        ownerId,
        sendReply,
      });
      return;
    }

    if (!caption) {
      throw new InvalidParameterError(`Categoria desconhecida. Use ${getPrefix(remoteJid)}menu para ver as opções.`);
    }

    if (typeof sendImageFromFile === "function") {
      await sendImageFromFile(
        path.join(ASSETS_DIR, "images", "takeshi-bot.png"),
        caption,
      );
    }
  },
};
