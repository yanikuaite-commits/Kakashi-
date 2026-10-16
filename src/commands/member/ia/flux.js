import { PREFIX } from "../../../config.js";
import { generateImage, isGeminiConfigured } from "../../../services/gemini.js";
import { imagePromptUrl } from "../../../services/public-ai.js";
import { errorLog } from "../../../utils/logger.js";

export default {
  name: "flux",
  description: "Cria uma imagem usando a IA Flux",
  commands: ["flux"],
  usage: `${PREFIX}flux descrição`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    args,
    sendWaitReply,
    sendWarningReply,
    sendImageFromBuffer,
    sendImageFromURL,
    sendSuccessReact,
    fullArgs,
  }) => {
    if (!args[0]) {
      return sendWarningReply(
        "Você precisa fornecer uma descrição para a imagem."
      );
    }

    await sendWaitReply("gerando imagem...");

    await sendSuccessReact();

    // Com a chave da Google configurada a imagem sai da Gemini; se a chamada
    // falhar (billing desativado, quota, bloqueio), cai no gerador gratuito para
    // o usuário não ficar sem resposta.
    let buffer = null;

    if (isGeminiConfigured()) {
      try {
        buffer = (await generateImage(fullArgs)).buffer;
      } catch (error) {
        errorLog(`Flux (Gemini): ${error.message}`);
      }
    }

    if (buffer?.length) {
      return await sendImageFromBuffer(buffer);
    }

    await sendImageFromURL(imagePromptUrl(fullArgs));
  },
};
