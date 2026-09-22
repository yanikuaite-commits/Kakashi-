import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import {
  blockCommand,
  getBlockedCommands,
  unblockCommand,
} from "../../utils/database.js";

export default {
  name: "block-command",
  description: "Bloqueia ou desbloqueia comandos para usuários.",
  commands: ["block-command", "unblock-command", "blocked-commands"],
  usage: `${PREFIX}block-command nome | ${PREFIX}unblock-command nome`,
  handle: async ({ commandName, args, sendSuccessReply }) => {
    if (commandName === "blocked-commands") {
      const commands = getBlockedCommands();
      return sendSuccessReply(commands.length ? commands.join(", ") : "Nenhum comando bloqueado.");
    }
    const command = args[0]?.toLowerCase();
    if (!command) throw new InvalidParameterError("Informe o nome do comando.");
    if (commandName === "block-command") blockCommand(command);
    else unblockCommand(command);
    return sendSuccessReply(`Comando ${commandName === "block-command" ? "bloqueado" : "desbloqueado"}: ${command}`);
  },
};