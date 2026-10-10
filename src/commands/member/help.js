import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { getPrefix } from "../../utils/database.js";

const VALIDATION_FLOW = `
🔐 *VALIDAÇÃO POR ANÚNCIO (AD-GATE)*

Alguns comandos exigem validação antes do uso.

📌 Passo a passo:
1️⃣ Use o comando normalmente, ex: ${PREFIX}tiktok <link>
2️⃣ Se você não estiver validado, o bot enviará um token único
3️⃣ Abra o link recebido no celular/browser
4️⃣ Assista ao anúncio por 30 segundos
5️⃣ Copie o código abaixo:
6️⃣ Envie no WhatsApp: .validar <TOKEN>
7️⃣ Pronto: acesso liberado por 1 hora
7️⃣ Pronto: acesso liberado por 1 hora

📌 Comandos:
${PREFIX}validar <TOKEN> — validar acesso a partir do token

⚠️ Cada token é único, expira em 1 hora e só pode ser usado uma vez.
⚠️ Após validar, seu acesso dura 1 hora.
⚠️ Quando expirar, use .validar novamente com um novo token.
`;

export default {
  name: "help",
  description: "Ajuda sobre comandos e fluxo de validação",
  commands: ["help"],
  usage: `${PREFIX}help [categoria]`,
  /** @param {import("../../utils/loadCommonFunctions.js").CommonFunctions} props */
  handle: async ({
    remoteJid,
    fullArgs,
    webMessage,
    sendReply,
    sendSuccessReply,
    sendErrorReply,
  }) => {
    const prefix = getPrefix(remoteJid);
    const section = fullArgs.trim().toLowerCase();

    if (section === "validar" || section === "validacao" || section === "auth") {
      return sendReply(VALIDATION_FLOW.trim());
    }

    if (section) {
      const helpByCategory = {
        download: `📥 *DOWNLOADS*
Use comandos de download respondendo ou enviando links.

${prefix}baixar <link>
${prefix}instagram <link>
${prefix}facebook <link>
${prefix}tiktok <link>
${prefix}tiktok-audio <link>
${prefix}xtwitter <link>
${prefix}pinterest <link>

⚠ Alguns downloads exigem validação prévia (${prefix}validar).
      `.trim(),
        validacao: VALIDATION_FLOW.trim(),
      };

      const content = helpByCategory[section];
      if (!content) {
        throw new InvalidParameterError(
          `Categoria desconhecida. Use ${prefix}help para ver o tema de validação.`,
        );
      }

      return sendReply(content);
    }

    return sendReply(
      `📖 *COMANDOS DISPONÍVEIS*

${prefix}menu — ver categorias
${prefix}help validar — como funciona a validação por anúncio
${prefix}validar <TOKEN> — ativar acesso

💡 Dica: para ver todos os comandos, use ${prefix}menu.
      `.trim(),
    );
  },
};
