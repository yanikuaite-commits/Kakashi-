import { PREFIX } from "../../../config.js";
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
    await sendImageFromURL(imagePromptUrl(fullArgs));
  },
};
