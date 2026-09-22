import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { generateAttp } from "../../services/attp.js";

export default {
  name: "attp",
  description: "Faz figurinhas animadas de texto.",
  commands: ["attp"],
  usage: `${PREFIX}attp teste`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    sendWaitReact,
    args,
    sendStickerFromBuffer,
    sendSuccessReact,
    sendErrorReply,
  }) => {
    if (!args.length) {
      throw new InvalidParameterError(
        "Você precisa informar o texto que deseja transformar em figurinha."
      );
    }

    await sendWaitReact();

    const buffer = await generateAttp(args.join(" "));
    await sendSuccessReact();
    await sendStickerFromBuffer(buffer);
  },
};
