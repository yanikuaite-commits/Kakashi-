import fs from "node:fs";
import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { transformImage } from "../../../services/image.js";
import { getRandomNumber } from "../../../utils/index.js";

export default {
  name: "bolsonaro",
  description: "Gero uma montagem do Bolsonaro com a imagem que você enviar",
  commands: ["bolsonaro"],
  usage: `${PREFIX}bolsonaro (marque a imagem) ou ${PREFIX}bolsonaro (responda a imagem)`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    isImage,
    downloadImage,
    sendSuccessReact,
    sendWaitReact,
    sendImageFromFile,
    webMessage,
  }) => {
    if (!isImage) {
      throw new InvalidParameterError(
        "Você precisa marcar uma imagem ou responder a uma imagem"
      );
    }

    await sendWaitReact();

    const fileName = getRandomNumber(10_000, 99_999).toString();
    const filePath = await downloadImage(webMessage, fileName);
    const outputPath = await transformImage(filePath, "pixelate");
    await sendSuccessReact();
    await sendImageFromFile(outputPath, "Imagem gerada!");
    fs.unlinkSync(filePath);
    fs.unlinkSync(outputPath);
  },
};
