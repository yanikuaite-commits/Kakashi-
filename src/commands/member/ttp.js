import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { generateTtp } from "../../services/ttp.js";
import fs from "node:fs/promises";

export default {
  name: "ttp",
  description: "Faz figurinhas de texto.",
  commands: ["ttp"],
  usage: `${PREFIX}ttp teste`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    sendWaitReact,
    args,
    sendImageFromFile,
    sendSuccessReact,
    sendErrorReply,
  }) => {
    if (!args.length) {
      throw new InvalidParameterError(
        "Você precisa informar o texto que deseja transformar em figurinha.",
      );
    }

    await sendWaitReact();

    const filePath = await generateTtp(args.join(" "));
    await sendSuccessReact();
    try {
      await sendImageFromFile(filePath);
    } finally {
      await fs.rm(filePath, { force: true });
    }
  },
};
