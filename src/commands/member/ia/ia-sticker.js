import { exec as execChild } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PREFIX, TEMP_DIR } from "../../../config.js";
import { generateImage, isGeminiConfigured } from "../../../services/gemini.js";
import { imagePromptUrl } from "../../../services/public-ai.js";
import { getBuffer, getRandomName } from "../../../utils/index.js";
import { errorLog } from "../../../utils/logger.js";

export default {
  name: "ia-sticker",
  description: "Cria uma figurinha com base em uma descrição",
  commands: ["ia-sticker", "ia-fig"],
  usage: `${PREFIX}ia-sticker descrição`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    args,
    sendWaitReply,
    sendWarningReply,
    sendStickerFromFile,
    sendErrorReply,
    sendSuccessReact,
    fullArgs,
  }) => {
    if (!args[0]) {
      return sendWarningReply(
        "Você precisa fornecer uma descrição para a imagem."
      );
    }

    await sendWaitReply("gerando figurinha...");

    // Com a chave da Google configurada a imagem sai da Gemini. Se a chamada
    // falhar (billing desativado, quota, bloqueio), cai no gerador gratuito
    // para o usuário não ficar sem resposta.
    const extensionByMimeType = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    };

    let buffer = null;
    let extension = "png";

    if (isGeminiConfigured()) {
      try {
        const image = await generateImage(fullArgs);

        buffer = image.buffer;
        extension =
          extensionByMimeType[String(image.mimeType).split(";")[0].trim()] ||
          "png";
      } catch (error) {
        errorLog(`IA sticker (Gemini): ${error.message}`);
        buffer = await getBuffer(imagePromptUrl(fullArgs));
      }
    } else {
      buffer = await getBuffer(imagePromptUrl(fullArgs));
    }

    if (buffer?.length) {
      const inputTempPath = path.resolve(TEMP_DIR, getRandomName(extension));
      const outputTempPath = path.resolve(TEMP_DIR, getRandomName("webp"));

      fs.writeFileSync(inputTempPath, buffer);

      const cmd = `ffmpeg -i "${inputTempPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease" -f webp -quality 90 "${outputTempPath}"`;

      execChild(cmd, async (error, _, stderr) => {
        if (error) {
          console.error("FFmpeg error:", error);
          await sendErrorReply(
            `Houve um erro ao processar a imagem. Tente novamente mais tarde!
            
Detalhes: ${stderr}`
          );
        } else {
          await sendSuccessReact();
          await sendStickerFromFile(outputTempPath);
          fs.unlinkSync(inputTempPath);
          fs.unlinkSync(outputTempPath);
        }
      });
    } else {
      await sendWarningReply(
        "Não foi possível gerar a figurinha. Tente novamente mais tarde."
      );
    }
  },
};
