import { DAILY_FREE_CREDITS, PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { ownerContactLine } from "../../services/credits.js";
import { getPrefix } from "../../utils/database.js";

const CREDITS_FLOW = `
💳 *COMO FUNCIONAM OS CRÉDITOS*

Cada função do bot gasta créditos.

🎁 Você recebe ${DAILY_FREE_CREDITS} créditos grátis por dia.
🕛 Os créditos gratuitos são renovados todos os dias às 00h00 (horário de Moçambique).
💎 Créditos recarregados com pagamento não expiram.

📌 Passo a passo:
1️⃣ Envie o comando normalmente, ex: ${PREFIX}tiktok <link>
2️⃣ O custo é descontado da sua conta
3️⃣ Mídias longas gastam créditos extras (duração/tamanho do arquivo)
4️⃣ Acompanhe tudo com ${PREFIX}conta

📌 Comandos:
${PREFIX}conta — seu saldo, estatísticas e próxima renovação
${PREFIX}conta custos — tabela de custos por função

⚠️ Sem créditos o comando não roda: o bot avisa e você recarrega com o dono.
${ownerContactLine()}
`;

export default {
  name: "help",
  description: "Ajuda sobre comandos e sobre os créditos",
  commands: ["help"],
  usage: `${PREFIX}help [categoria]`,
  /** @param {import("../../utils/loadCommonFunctions.js").CommonFunctions} props */
  handle: async ({ fullArgs, remoteJid, sendReply }) => {
    const prefix = getPrefix(remoteJid);
    const section = fullArgs.trim().toLowerCase();

    if (["creditos", "credito", "credits", "conta", "carteira"].includes(section)) {
      return sendReply(CREDITS_FLOW.trim());
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

⚠ Cada download gasta créditos (veja ${prefix}conta - ${prefix}conta custos).
      `.trim(),
      };

      const content = helpByCategory[section];
      if (!content) {
        throw new InvalidParameterError(
          `Categoria desconhecida. Use ${prefix}help para ver o tema de créditos.`,
        );
      }

      return sendReply(content);
    }

    return sendReply(
      `📖 *COMANDOS DISPONÍVEIS*

${prefix}menu — ver categorias
${prefix}conta — seus créditos e estatísticas
${prefix}conta custos — tabela de custos das funções
${prefix}help creditos — como funcionam os créditos

💡 Dica: para ver todos os comandos, use ${prefix}menu.
      `.trim(),
    );
  },
};
