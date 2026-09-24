import path from "node:path";
import { ASSETS_DIR, PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { menuMessage } from "../../menu.js";
import { getPrefix } from "../../utils/database.js";

export default {
  name: "menu",
  description: "Menu de comandos",
  commands: ["menu", "help"],
  usage: `${PREFIX}menu [categoria]`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    remoteJid,
    fullArgs,
    webMessage,
    sendSuccessReact,
    sendImageFromFile,
  }) => {
    const caption = menuMessage(remoteJid, fullArgs, webMessage?.pushName);
    if (!caption) {
      throw new InvalidParameterError(`Categoria desconhecida. Use ${getPrefix(remoteJid)}menu para ver as opções.`);
    }

    await sendSuccessReact();

    await sendImageFromFile(
      path.join(ASSETS_DIR, "images", "takeshi-bot.png"),
      caption,
    );
  },
};
