import { delay } from "baileys";
import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import fs from "node:fs/promises";
import { errorLog } from "../../../utils/logger.js";

export default {
  name: "pinterest",
  description: "Busco imagens no Pinterest e envio separadamente.",
  commands: ["pinterest", "pin"],
  usage: `${PREFIX}pinterest gatos fofos`,
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
        "Você precisa me dizer o que deseja buscar no Pinterest!",
      );
    }

    try {
      await sendReply("⬇️ Baixando...");
      const data = await downloadByCommand("pinterest", fullArgs.trim());
      await sendSuccessReact();
      await sendVideoFromFile(data.filePath, `📌 Resultado para: ${fullArgs}`);
      await fs.rm(data.filePath, { force: true });
    } catch (error) {
      errorLog(JSON.stringify(error, null, 2));
      await sendErrorReply(JSON.stringify(error.message));
    }
  },
};
