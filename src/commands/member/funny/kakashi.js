import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import {
  KAKASHI_AUDIOS,
  caminhoDoAudio,
  encontrarAudio,
} from "../../../services/kakashiAudio.js";
import { formatMessage } from "../../../utils/formatMessage.js";

const COMANDO = `${PREFIX}kakashi`;

function listaDeFalas() {
  return KAKASHI_AUDIOS.map(
    (audio) =>
      `• ${COMANDO} ${audio.nomes[0]}\n  ${audio.descricao}`,
  ).join("\n");
}

export default {
  name: "kakashi",
  description: "Envia uma fala do Kakashi.",
  commands: ["kakashi", "fala", "falas"],
  usage: `${PREFIX}kakashi <nome>`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ args, sendReply, sendAudioFromFile, sendSuccessReact }) => {
    const pedido = args[0];

    // Sem argumento (ou com um que não existe) mostramos a lista, para o
    // usuário descobrir os nomes sem ter de consultar o menu.
    const audio = pedido ? encontrarAudio(pedido) : null;

    if (!audio) {
      const campos = [listaDeFalas()];

      if (pedido) {
        campos.unshift(`Não conheço "${pedido}".`);
      }

      await sendReply(
        formatMessage({
          icone: "🎧",
          titulo: "Falas do Kakashi",
          campos,
          extra: `Use ${COMANDO} <nome>. Exemplo: ${COMANDO} chidori`,
        }),
      );

      return;
    }

    await sendAudioFromFile(caminhoDoAudio(audio));
    await sendSuccessReact();
  },
};
