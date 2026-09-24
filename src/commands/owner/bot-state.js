import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { isBotEnabled, setBotEnabled } from "../../utils/database.js";

export default {
  name: "bot-state",
  description: "Ativa ou desativa o bot globalmente.",
  commands: ["bot-on", "bot-off", "bot-status"],
  usage: `${PREFIX}bot-on | ${PREFIX}bot-off | ${PREFIX}bot-status`,
  handle: async ({ commandName, sendSuccessReply }) => {
    if (commandName === "boton") {
      setBotEnabled(true);
      return sendSuccessReply("Bot ativado globalmente.");
    }
    if (commandName === "botoff") {
      setBotEnabled(false);
      return sendSuccessReply("Bot desativado globalmente.");
    }
    if (!isBotEnabled()) return sendSuccessReply("Bot globalmente desativado.");
    return sendSuccessReply("Bot globalmente ativado.");
  },
};
