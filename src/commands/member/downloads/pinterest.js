import { delay } from "baileys";
import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import fs from "node:fs/promises";
import { errorLog } from "../../../utils/logger.js";

export default {
  name: "pinterest",
  description: "Baixo vídeos do Pinterest pelo link.",
  commands: ["pinterest", "pin"],
  usage: `${PREFIX}pinterest https://www.pinterest.com/pin/123456789/`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    fullArgs,
    sendWaitReact,
    sendSuccessReact,
    sendErrorReply,
    sendVideoFromFile,
    sendReply,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa enviar uma URL do Pinterest!",
      );
    }

    let data;
    try {
      await sendReply("⬇️ Baixando...");
      data = await downloadByCommand("pinterest", fullArgs.trim());
      await sendSuccessReact();
      await sendVideoFromFile(data.filePath, `📌 Resultado para: ${fullArgs}`);
    } catch (error) {
      errorLog(JSON.stringify(error, null, 2));
      await sendErrorReply(error.message);
    } finally {
      if (data?.filePath) await fs.rm(data.filePath, { force: true });
    }
  },
};
