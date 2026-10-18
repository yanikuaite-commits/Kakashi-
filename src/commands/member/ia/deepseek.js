import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { askGroq } from "../../../services/ai.js";
import { aiMessage } from "../../../utils/formatMessage.js";

export default {
  name: "deepseek",
  description: "Use a inteligência artificial DeepSeek V4 Flash!",
  commands: ["deepseek", "deep-seek"],
  usage: `${PREFIX}deepseek Crie um resumo curto sobre inteligência artificial`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ sendSuccessReply, sendWaitReply, args, remoteJid }) => {
    const text = args.join(" ");

    if (!text) {
      throw new InvalidParameterError(
        "Você precisa me dizer o que eu devo responder!",
      );
    }

    await sendWaitReply();

    const responseText = await askGroq(remoteJid, text);

    await sendSuccessReply(aiMessage({ pergunta: text, resposta: responseText }));
  },
};
