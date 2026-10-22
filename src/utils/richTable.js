/**
 * Tabela em "rich response" (a tabela nativa do WhatsApp).
 *
 * O payload é o mesmo que o Meta AI usa: uma mensagem `botForwardedMessage` com
 * `richResponseMessage` e a capacidade `RICH_RESPONSE_TABLE`. O `unifiedResponse`
 * repete o conteúdo em base64 para os clientes que leem o formato novo.
 *
 * `sendTabela` é o atalho de alto nível: monta a tabela a partir de
 * `src/utils/tabelaPrecos.js` e cai no texto quando o relay falha, porque nem
 * todos os clientes mostram a tabela nativa.
 */
import { randomBytes } from "node:crypto";
import { generateWAMessageFromContent, proto } from "baileys";
import { panelMessage } from "./formatMessage.js";
import { errorLog } from "./logger.js";
import { formatTabelaTexto, getTabela } from "./tabelaPrecos.js";

const META_AI_BOT_JID = "867051314767696@bot";
const META_AI_BOT_NAME = "Meta AI";
const META_AI_CREATOR_NAME = "Meta";
const FORWARD_ORIGIN_META_AI = 4;
const BOT_ENTRY_POINT_INVOKE_META_AI_1ON1 = 29;
const BOT_ENTRY_POINT_INVOKE_META_AI_GROUP = 30;

/** Linhas no formato da tabela nativa (primeira linha = cabeçalho). */
export function buildTableRows(rows) {
  return rows.map((items, index) => ({
    items: items.map((value) => String(value ?? "")),
    isHeading: index === 0,
  }));
}

function makeTextSubmessage(messageText) {
  return {
    messageType: 2,
    messageText: String(messageText || ""),
  };
}

function makeTableSubmessage(rows) {
  return {
    messageType: 4,
    tableMetadata: {
      rows,
    },
  };
}

function buildRichResponse(submessages) {
  return {
    messageType: 1,
    submessages,
    unifiedResponse: {
      data: encodeUnifiedResponseData({
        response_id: `takeshi-table-${Date.now()}-${randomBytes(6).toString("hex")}`,
        sections: submessages.map(buildUnifiedSection).filter(Boolean),
      }),
    },
  };
}

function buildUnifiedSection(submessage) {
  if (submessage.messageType === 2) {
    return {
      view_model: {
        primitive: {
          text: submessage.messageText,
          __typename: "GenAIMarkdownTextUXPrimitive",
        },
        __typename: "GenAISingleLayoutViewModel",
      },
    };
  }

  if (submessage.messageType === 4) {
    return {
      view_model: {
        primitive: {
          rows: submessage.tableMetadata.rows.map((row) => ({
            is_header: !!row.isHeading,
            cells: row.items.map((value) => String(value ?? "")),
          })),
          __typename: "GenATableUXPrimitive",
        },
        __typename: "GenAISingleLayoutViewModel",
      },
    };
  }

  return null;
}

function buildBotMetadata(extraCapabilities = []) {
  return {
    modelMetadata: {
      modelType: "LLAMA_PROD",
      premiumModelStatus: "AVAILABLE",
    },
    botAgeCollectionMetadata: {},
    botResponseId: `takeshi-table-${Date.now()}-${randomBytes(6).toString("hex")}`,
    verificationMetadata: {
      proofs: [],
    },
    botInfrastructureDiagnostics: {},
    capabilityMetadata: {
      capabilities: [
        "RICH_RESPONSE_STRUCTURED_RESPONSE",
        "RICH_RESPONSE_UNIFIED_RESPONSE",
        "RICH_RESPONSE_UNIFIED_TEXT_COMPONENT",
        "SESSION_TRANSPARENCY_SYSTEM_MESSAGE",
        ...extraCapabilities,
      ],
    },
  };
}

function applyForwardedMetaAiContext(richResponse, remoteJid) {
  return {
    ...richResponse,
    contextInfo: {
      isForwarded: true,
      forwardingScore: 1,
      forwardOrigin: FORWARD_ORIGIN_META_AI,
      forwardedAiBotMessageInfo: {
        botName: META_AI_BOT_NAME,
        botJid: META_AI_BOT_JID,
        creatorName: META_AI_CREATOR_NAME,
      },
      botMessageSharingInfo: {
        botEntryPointOrigin: String(remoteJid || "").endsWith("@g.us")
          ? BOT_ENTRY_POINT_INVOKE_META_AI_GROUP
          : BOT_ENTRY_POINT_INVOKE_META_AI_1ON1,
        forwardScore: 1,
      },
    },
  };
}

function encodeUnifiedResponseData(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

/**
 * Opções do `generateWAMessageFromContent`.
 *
 * A citação só entra quando a mensagem tem a forma completa que o Baileys
 * exige; uma citação parcial faz o gerador rebentar, por isso é descartada.
 */
function buildGenerationOptions(quoted) {
  if (!quoted?.key?.remoteJid || !quoted?.key?.id) return {};

  try {
    return { quoted: JSON.parse(JSON.stringify(quoted)) };
  } catch {
    return {};
  }
}

/**
 * Envia um título e uma tabela como rich response.
 *
 * @param {{socket: object, remoteJid: string, quoted?: object, titulo?: string, rows: Array<Array<string>>}} options
 */
export async function sendRichTable({
  socket,
  remoteJid,
  quoted,
  titulo = "",
  rows,
}) {
  const submessages = [];
  if (titulo) submessages.push(makeTextSubmessage(titulo));
  submessages.push(makeTableSubmessage(rows));

  const rich = applyForwardedMetaAiContext(
    buildRichResponse(submessages),
    remoteJid,
  );
  const payload = proto.Message.fromObject({
    botForwardedMessage: {
      message: {
        richResponseMessage: rich,
      },
    },
    messageContextInfo: {
      messageSecret: randomBytes(32),
      botMetadata: buildBotMetadata(["RICH_RESPONSE_TABLE"]),
    },
  });
  const waMessage = generateWAMessageFromContent(
    remoteJid,
    payload,
    buildGenerationOptions(quoted),
  );

  return socket.relayMessage(remoteJid, waMessage.message, {
    messageId: waMessage.key.id,
  });
}

/**
 * Envia uma tabela de preços pelo id ("dias" ou "creditos").
 *
 * Tenta a tabela nativa e, se o relay falhar, envia o mesmo conteúdo como texto
 * alinhado (`formatTabelaTexto`), para a informação nunca se perder.
 *
 * @param {{socket: object, remoteJid: string, quoted?: object, sendReply?: Function, id: string}} options
 * @returns {Promise<boolean>} `true` quando algo foi enviado.
 */
export async function sendTabela({ socket, remoteJid, quoted, sendReply, id }) {
  const tabela = getTabela(id);
  if (!tabela) return false;

  const rows = buildTableRows([tabela.cabecalho, ...tabela.linhas]);

  try {
    await sendRichTable({
      socket,
      remoteJid,
      quoted,
      titulo: `*${tabela.titulo}*`,
      rows,
    });
    return true;
  } catch (error) {
    errorLog(`Falha ao enviar a tabela "${id}" como rich response: ${error.message}`);
  }

  if (!sendReply) return false;

  await sendReply(
    panelMessage({
      icone: "📋",
      titulo: tabela.titulo,
      campos: [formatTabelaTexto(id)],
    }),
  );

  return true;
}
