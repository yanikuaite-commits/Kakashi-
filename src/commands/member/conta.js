import { PREFIX, OWNER_LID } from "../../config.js";
import {
  accountMessage,
  costsMessage,
  getAccount,
} from "../../services/credits.js";
import { getPrefix } from "../../utils/database.js";
import { onlyNumbers } from "../../utils/index.js";

export default {
  name: "conta",
  description: "Mostra seus créditos, estatísticas de uso e a tabela de custos",
  commands: ["conta", "creditos", "carteira", "meus-creditos"],
  usage: `${PREFIX}conta [custos]`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    fullArgs,
    remoteJid,
    userLid,
    webMessage,
    sendReply,
    sendSuccessReply,
  }) => {
    const prefix = getPrefix(remoteJid);
    // "args" não separa por espaço, então lemos o fullArgs diretamente.
    const parts = fullArgs.trim().split(/\s+/).filter(Boolean);
    const section = String(parts[0] || "").toLowerCase();

    if (section === "custos" || section === "precos" || section === "preços") {
      return sendReply(costsMessage({ prefix }));
    }

    // O dono pode consultar a conta de outro usuário.
    const isOwner = userLid === OWNER_LID;
    const mentioned = parts.find((part) => part.includes("@"));

    const targetLid = isOwner && mentioned
      ? `${onlyNumbers(mentioned)}@lid`
      : userLid || remoteJid;

    const account = getAccount(targetLid);
    const name = String(
      isOwner && mentioned ? `@${onlyNumbers(mentioned)}` : webMessage?.pushName || "Você",
    )
      .replace(/[\r\n*_~`]/g, "")
      .slice(0, 32);

    await sendSuccessReply(accountMessage({ account, name, prefix }));
  },
};
