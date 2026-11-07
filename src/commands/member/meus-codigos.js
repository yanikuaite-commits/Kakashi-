import { PREFIX } from "../../config.js";
import { readVipCodes } from "../../services/vipCodes.js";
import { formatMessage } from "../../utils/formatMessage.js";

export default {
  name: "meus-codigos",
  description: "Lista os seus códigos VIP ainda não utilizados.",
  commands: ["meus-codigos", "meus-vips", "codigos"],
  usage: `${PREFIX}meus-codigos`,
  handle: async ({ userLid, sendReply }) => {
    const codes = readVipCodes();
    const meusCodigos = Object.entries(codes)
      .filter(([_, data]) => data.buyerLid === userLid && !data.used);

    if (!meusCodigos.length) {
      return sendReply("❌ Você não possui códigos VIP pendentes de uso.");
    }

    const campos = meusCodigos.map(([code, data]) => {
      return `🎫 *Código:* \`${code}\`\n📦 *Plano:* ${data.plano} (${data.dias} dias)\n📅 *Comprado em:* ${new Date(data.createdAt).toLocaleDateString("pt-PT")}\n`;
    });

    await sendReply(formatMessage({
      icone: "🔐",
      titulo: "Seus Códigos VIP",
      campos: [
        "Aqui estão os códigos que você adquiriu e ainda não utilizou:",
        "",
        ...campos,
        "📌 *Para usar:* Vá ao grupo e digite:\n" + `\`${PREFIX}validar CODIGO\``
      ]
    }));
  },
};
