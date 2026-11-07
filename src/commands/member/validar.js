import { PREFIX } from "../../config.js";
import { InvalidParameterError, DangerError } from "../../errors/index.js";
import { redeemVipCode } from "../../services/vipCodes.js";

export default {
  name: "validar",
  description: "Valida um código VIP para ativar o bot no grupo.",
  commands: ["validar", "ativar-vip"],
  usage: `${PREFIX}validar <codigo>`,
  handle: async ({ fullArgs, isGroup, remoteJid, userLid, sendSuccessReply }) => {
    if (!isGroup) {
      throw new DangerError("Este comando deve ser usado dentro do grupo onde deseja ativar o VIP.");
    }

    const codigo = String(fullArgs || "").trim().toUpperCase();
    if (!codigo) {
      throw new InvalidParameterError(`Informe o seu código VIP. Ex: ${PREFIX}validar VIP-123-7D`);
    }

    const res = redeemVipCode(codigo, remoteJid, userLid);
    if (!res.ok) {
      throw new DangerError(res.error);
    }

    const dataExpiracao = new Date(res.expiresAt).toLocaleDateString("pt-PT");
    await sendSuccessReply(
      `🎉 *VIP ATIVADO COM SUCESSO!* 🎉\n\n` +
      `📦 *Plano:* ${res.plano} (${res.dias} dias)\n` +
      `⏳ *Expira em:* ${dataExpiracao}\n\n` +
      `Obrigado por alugar o Kakashi Bot! Agora todas as funções estão liberadas neste grupo. 🚀`
    );
  },
};
