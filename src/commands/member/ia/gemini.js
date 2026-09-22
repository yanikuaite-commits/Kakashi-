import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { askHuggingFace } from "../../../services/ai.js";

export default {
  name: "gemini",
  description: "Use a inteligência artificial da Google Gemini!",
  commands: ["gemini", "takeshi", "ia"],
  usage: `${PREFIX}gemini com quantos paus se faz uma canoa?`,
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

    const responseText = await askHuggingFace(remoteJid, text);

    if (waitingMessage) {
      await sendEditedReply(responseText, waitingMessage);
    } else {
      await sendSuccessReply(responseText);
    }
  },
};
