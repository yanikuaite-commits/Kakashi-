import { PREFIX } from "../../../config.js";
import { generateImage, isGeminiConfigured } from "../../../services/gemini.js";
import { imagePromptUrl } from "../../../services/public-ai.js";

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

    // Com a chave da Google configurada a imagem sai da Gemini; sem ela,
    // continua no gerador gratuito (Pollinations).
    if (isGeminiConfigured()) {
      const { buffer } = await generateImage(fullArgs);

      return await sendImageFromBuffer(buffer);
    }

    await sendImageFromURL(imagePromptUrl(fullArgs));
  },
};
