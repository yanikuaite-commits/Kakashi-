import { DangerError } from "../../errors/index.js";
import { setGroupPrefixless } from "../../utils/database.js";

export default {
  name: "responder",
  description: "Ativa/desativa a resposta automática sem prefixo no grupo.",
  commands: ["responder", "responder-sem-prefixo"],
  usage: "responder on|off",
  handle: async ({ remoteJid, fullArgs, isOwner, sendSuccessReply, sendWarningReply }) => {
    const val = String(fullArgs || "").trim().toLowerCase();
    if (val !== "on" && val !== "off") {
      throw new DangerError("Use: responder on|off");
    }
    setGroupPrefixless(remoteJid, val === "on");
    await sendSuccessReply(`✅ Resposta sem prefixo ${val === "on" ? "ATIVADA" : "DESATIVADA"}!`);
  },
};