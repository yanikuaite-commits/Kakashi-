import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { toImage } from "../../services/converter.js";
import { getRandomName, removeFileIfExists } from "../../utils/index.js";

export default {
  name: "toimage",
  description: "Transformo figurinhas estáticas em imagem",
  commands: ["toimage", "toimg"],
  usage: `${PREFIX}toimage (marque a figurinha) ou ${PREFIX}toimage (responda a figurinha)`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    isSticker,
    downloadSticker,
    webMessage,
    sendWaitReact,
    sendSuccessReact,
    sendImageFromFile,
  }) => {
    if (!isSticker) {
      throw new InvalidParameterError("Você precisa enviar uma figurinha!");
    }

    await sendWaitReact();

    let inputPath = null;
    let outputPath = null;

    try {
      inputPath = await downloadSticker(webMessage, getRandomName());
      outputPath = await toImage(inputPath);
      await sendSuccessReact();
      await sendImageFromFile(outputPath);
    } finally {
      removeFileIfExists(inputPath);
      removeFileIfExists(outputPath);
    }
  },
};
