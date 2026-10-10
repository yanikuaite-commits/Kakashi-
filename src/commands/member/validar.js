import { requireValidation } from "../../services/validation.js";
import {
  consumeToken,
  isUserValidated,
  markTokenIssued,
  saveValidatedUser,
  buildAdGateUrl,
} from "../../services/validation.js";
import { sendSuccessReply, sendErrorReply } from "../../utils/loadCommonFunctions.js";

export default {
  name: "validar",
  description: "Valida seu acesso com o token gerado pelo bot",
  commands: ["validar"],
  usage: ".validar TOKEN",
  /**
   * @param {import("../../utils/loadCommonFunctions.js").CommonFunctions} props
   */
  handle: async ({
    fullArgs,
    userLid,
    remoteJid,
    sendReply,
    sendSuccessReply,
    sendErrorReply,
  }) => {
    const token = fullArgs.trim().split(/\s+/)[0] || "";

    if (!token) {
      throw new Error("Use: .validar <TOKEN>");
    }

    const existing = await isUserValidated(userLid || remoteJid);
    if (existing) {
      return sendSuccessReply(
        "✅ Você está validado por 1 hora! Agora pode usar os comandos protegidos.\n\nAo expirar, use .validar novamente com um novo token.",
      );
    }

    const consumed = await consumeToken(token);
    if (!consumed) {
      return sendErrorReply("Token inválido ou expirado! Tente novamente.");
    }

    if (consumed.jid !== (userLid || remoteJid)) {
      return sendErrorReply(
        "Este token pertence a outra sessão. Solicite um novo na sua sessão.",
      );
    }

    await saveValidatedUser(userLid || remoteJid);
    await markTokenIssued(userLid || remoteJid, token);      return sendSuccessReply(
      `✅ Você está validado!\n\nAgora pode usar os comandos protegidos por 1 hora.\n\n🔗 Sua página de anúncio: ${buildAdGateUrl(token)}`,
    );
  },
};
