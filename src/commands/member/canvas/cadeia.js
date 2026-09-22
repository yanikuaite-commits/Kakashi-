import fs from "node:fs";
import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { transformImage } from "../../../services/image.js";
import { getRandomNumber } from "../../../utils/index.js";

export default {
  name: "cadeia",
  description:
    "Gero uma montagem como se a pessoa estivesse na cadeia com a imagem que você enviar",
  commands: ["cadeia", "jail"],
  usage: `${PREFIX}cadeia (marque a imagem) ou ${PREFIX}cadeia (responda a imagem)`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    isImage,
    downloadImage,
    sendSuccessReact,
    sendWaitReact,
    sendErrorReply,
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

    const outputPath = await transformImage(filePath, "grayscale");
    await sendSuccessReact();
    await sendImageFromFile(outputPath, "Imagem gerada!");

    fs.unlinkSync(filePath);
    fs.unlinkSync(outputPath);
  },
};
