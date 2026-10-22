import { delay } from "baileys";
import { PREFIX } from "../../../config.js";
import { buildTableRows, sendRichTable } from "../../../utils/richTable.js";

const TABLE_ROWS = [
  ["Comando", "Helper", "Uso"],
  ["menu", "sendReply", "Lista comandos"],
  ["sticker", "downloadImage", "Cria figurinha"],
  ["play-audio", "sendAudioFromBuffer", "Envia audio"],
];

export default {
  name: "enviar-tabela",
  description: "Exemplo de como enviar tabela em Rich Response",
  commands: ["enviar-tabela"],
  usage: `${PREFIX}enviar-tabela`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ socket, remoteJid, webMessage, sendReply, sendReact }) => {
    await sendReact("📊");

    await delay(2000);

    await sendRichTable({
      socket,
      remoteJid,
      quoted: webMessage,
      titulo: "*Tabela de comandos e helpers*",
      rows: buildTableRows(TABLE_ROWS),
    });

    await delay(2000);

    await sendReply(
      "Use `sendRichTable` (`src/utils/richTable.js`) para montar tabelas: a primeira linha é o cabeçalho (`isHeading`) e o `unifiedResponse` repete o conteúdo em base64 para os clientes que leem o formato novo.",
    );
  },
};
