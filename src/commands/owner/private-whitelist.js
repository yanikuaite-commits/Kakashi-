import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import {
  addPrivateWhitelist,
  getPrivateWhitelist,
  removePrivateWhitelist,
} from "../../utils/database.js";

const ACOES = ["add", "remove", "list"];

/**
 * Normaliza o LID enviado para a forma guardada na whitelist.
 *
 * O dono pode enviar o LID como o `.meu-lid` mostra (`275381038891241@lid`), só
 * os números, ou com o sufixo de aparelho que o WhatsApp acrescenta em alguns
 * eventos (`275381038891241:12@lid`). Todos apontam para a mesma pessoa, por isso
 * ficam na forma canónica `dígitos@lid`; um domínio explícito
 * (`@s.whatsapp.net`) é preservado, porque a whitelist compara o JID inteiro.
 *
 * @param {string} value
 * @returns {string} LID normalizado, ou "" quando não há dígitos.
 */
function normalizeLid(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const [local, domain] = raw.split("@");
  const digits = String(local || "").split(":")[0].replace(/\D/g, "");
  if (!digits) return "";

  return domain ? `${digits}@${domain.toLowerCase()}` : `${digits}@lid`;
}

function listaDaWhitelist() {
  const entries = getPrivateWhitelist();

  if (!entries.length) return "📋 A whitelist privada está vazia.";

  return `📋 *Whitelist privada* (${entries.length}):\n${entries
    .map((entry) => `• ${entry}`)
    .join("\n")}`;
}

export default {
  name: "private-whitelist",
  description: "Controla quem pode usar o bot no privado.",
  commands: ["private-whitelist", "whitelist-private", "privado"],
  usage: `${PREFIX}private-whitelist add|remove|list [lid]`,
  handle: async ({ fullArgs, remoteJid, sendSuccessReply }) => {
    // `args` do projeto separa por `\`, `|` e `/` — NÃO por espaço, pelo que
    // `.private-whitelist add <lid>` partia o LID junto com a ação e o comando
    // nunca funcionava com a sintaxe documentada. A leitura é feita sobre
    // `fullArgs`, tal como o `recarregar` faz.
    const partes = String(fullArgs || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const acao = (partes[0] || "").toLowerCase();

    if (acao === "list") {
      return sendSuccessReply(listaDaWhitelist());
    }

    if (!ACOES.includes(acao)) {
      throw new InvalidParameterError(
        `Uso: ${PREFIX}private-whitelist add|remove|list [lid]`,
      );
    }

    // Sem LID explícito vale o próprio chat — desde que seja privado.
    // Um número colado com espaços (`+275 381 038 891 241`) chega partido em
    // vários pedaços: o pedaço com `@` manda, senão juntam-se todos e os
    // dígitos são extraídos na normalização.
    const comArroba = partes.slice(1).find((parte) => parte.includes("@"));
    const bruto =
      comArroba ||
      partes.slice(1).join("") ||
      (remoteJid?.endsWith("@g.us") ? "" : remoteJid);
    const lid = normalizeLid(bruto);

    if (!lid) {
      throw new InvalidParameterError(
        `Envie o LID da pessoa. Ex: ${PREFIX}private-whitelist ${acao} 275381038891241@lid`,
      );
    }

    if (acao === "add") {
      addPrivateWhitelist(lid);
      return sendSuccessReply(`✅ Privado autorizado: ${lid}`);
    }

    removePrivateWhitelist(lid);
    return sendSuccessReply(`🗑️ Removido da whitelist privada: ${lid}`);
  },
};