import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import {
  addPrivateWhitelist,
  getPrivateWhitelist,
  removePrivateWhitelist,
} from "../../utils/database.js";

export default {
  name: "private-whitelist",
  description: "Controla quem pode usar o bot no privado.",
  commands: ["private-whitelist", "whitelist-private", "privado"],
  usage: `${PREFIX}private-whitelist add|remove|list [jid]`,
  handle: async ({ args, remoteJid, sendSuccessReply }) => {
    const action = args[0]?.toLowerCase();
    const jid = args[1] || remoteJid;
    if (action === "list") {
      const entries = getPrivateWhitelist();
      return sendSuccessReply(entries.length ? entries.join("\n") : "Whitelist privada vazia.");
    }
    if (!["add", "remove"].includes(action) || !jid || jid.endsWith("@g.us")) {
      throw new InvalidParameterError(`Uso: ${PREFIX}private-whitelist add|remove|list [jid]`);
    }
    if (action === "add") addPrivateWhitelist(jid);
    else removePrivateWhitelist(jid);
    return sendSuccessReply(`Privado ${action === "add" ? "autorizado" : "removido da whitelist"}: ${jid}`);
  },
};