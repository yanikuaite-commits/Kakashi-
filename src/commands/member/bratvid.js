import fs from "node:fs";
import path from "node:path";
import { BOT_EMOJI, BOT_NAME, PREFIX, TEMP_DIR } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { generateTtp } from "../../services/ttp.js";
import { processAnimatedGifToSticker } from "../../services/sticker.js";
import { getRandomName } from "../../utils/index.js";

export default {
  name: "bratvid",
  description: "Gera figurinha animada no estilo brat com o texto informado.",
  commands: ["bratvid", "abrat"],
  usage: `${PREFIX}bratvid Nem judas mentiu tanto assim ☠️`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    sendWaitReact,
    fullArgs,
    sendStickerFromFile,
    sendSuccessReact,
    sendErrorReply,
    webMessage,
    userLid,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa informar o texto que deseja transformar em figurinha animada.",
      );
    }

    await sendWaitReact();

    let inputPath = null;
    let finalStickerPath = null;

    try {
      inputPath = path.resolve(TEMP_DIR, getRandomName("gif"));

      const generatedPath = await generateTtp(fullArgs.trim());
      await fs.promises.copyFile(generatedPath, inputPath);
      await fs.promises.unlink(generatedPath).catch(() => {});

      const username =
        webMessage.pushName ||
        webMessage.notifyName ||
        userLid.replace(/@lid/, "");

      const metadata = {
        username,
        botName: `${BOT_EMOJI} ${BOT_NAME}`,
      };

      finalStickerPath = await processAnimatedGifToSticker(inputPath, metadata);

      await sendSuccessReact();

      await sendStickerFromFile(finalStickerPath);
    } finally {
      if (inputPath && fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
      }

      if (finalStickerPath && fs.existsSync(finalStickerPath)) {
        fs.unlinkSync(finalStickerPath);
      }
    }
  },
};
