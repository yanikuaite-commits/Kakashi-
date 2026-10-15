import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { askGroq } from "../../../services/ai.js";

export default {
  name: "gemini",
  description: "Use a inteligência artificial do Kakashi Bot!",
  commands: ["gemini", "kakashi", "ia"],
  usage: `${PREFIX}kakashi com quantos paus se faz uma canoa?`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ sendSuccessReply, sendWaitReply, sendEditedReply, args, remoteJid }) => {
    const text = args.join(" ");

    if (!text) {
      throw new InvalidParameterError(
        "Você precisa me dizer o que eu devo responder!"
      );
    }

    const waitingMessage = await sendWaitReply("🤔 Pensando...");

    const responseText = await askGroq(remoteJid, text);

    if (waitingMessage) {
      await sendEditedReply(responseText, waitingMessage);
    } else {
      await sendSuccessReply(responseText);
    }
  },
};
