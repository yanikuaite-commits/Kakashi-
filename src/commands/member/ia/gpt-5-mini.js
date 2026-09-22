import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { askHuggingFace } from "../../../services/ai.js";

export default {
  name: "gpt-5-mini",
  description: "Use a inteligência artificial GPT-5 Mini!",
  commands: ["gpt-5-mini", "gpt-5", "gpt"],
  usage: `${PREFIX}gpt-5-mini qual o sentido da vida?`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ sendSuccessReply, sendWaitReply, args, remoteJid }) => {
    const text = args.join(" ");

    if (!text) {
      throw new InvalidParameterError(
        "Você precisa me dizer o que eu devo responder!"
      );
    }

    await sendWaitReply();

    const responseText = await askHuggingFace(remoteJid, text);

    await sendSuccessReply(responseText);
  },
};
