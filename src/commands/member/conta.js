import { PREFIX, OWNER_LID } from "../../config.js";
import {
  accountMessage,
  costsMessage,
  getAccount,
} from "../../services/credits.js";
import { getPrefix } from "../../utils/database.js";
import { onlyNumbers } from "../../utils/index.js";
import { panelMessage } from "../../utils/formatMessage.js";

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
    isOwner: ownerFromDispatcher,
  }) => {
    const prefix = getPrefix(remoteJid);
    // "args" não separa por espaço, então lemos o fullArgs diretamente.
    const parts = fullArgs.trim().split(/\s+/).filter(Boolean);
    const section = String(parts[0] || "").toLowerCase();

    if (section === "custos" || section === "precos" || section === "preços") {
      return sendReply(
        panelMessage({
          icone: "📋",
          titulo: "Tabela de custos",
          campos: [costsMessage({ prefix })],
        }),
      );
    }

    // O dono pode consultar a conta de outro usuário. No privado o userLid vem
    // vazio, então vale também o isOwner que o dispetche calcula pelo JID.
    const isOwner = ownerFromDispatcher ?? userLid === OWNER_LID;
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

    await sendSuccessReply(
      panelMessage({
        icone: "💳",
        titulo: "Créditos",
        campos: [accountMessage({ account, name, prefix })],
      }),
    );
  },
};
