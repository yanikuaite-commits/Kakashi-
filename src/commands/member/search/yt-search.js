import { PREFIX } from "../../../config.js";
import { InvalidParameterError, WarningError } from "../../../errors/index.js";
import { getSearchResult } from "../../../services/downloader.js";

export default {
  name: "yt-search",
  description: "Consulta Google",
  commands: ["yt-search", "youtube-search"],
  usage: `${PREFIX}yt-search MC Hariel`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, sendSuccessReply }) => {
    if (fullArgs.length <= 1) {
      throw new InvalidParameterError(
        "Você precisa fornecer uma pesquisa para o YouTube."
      );
    }

    const maxLength = 100;

    if (fullArgs.length > maxLength) {
      throw new InvalidParameterError(
        `O tamanho máximo da pesquisa é de ${maxLength} caracteres.`
      );
    }

    const data = await getSearchResult(fullArgs);

    if (!data) {
      throw new WarningError(
        "Não foi possível encontrar resultados para a pesquisa."
      );
    }

    let text = "";

    text += `Título: *${data.title}*\n\n`;
    text += `Duração: ${data.duration}\n\n`;
    text += `URL: ${data.url}`;

    await sendSuccessReply(`*Pesquisa realizada*

*Termo*: ${fullArgs}
      
*Resultados*
${text}`);
  },
};
