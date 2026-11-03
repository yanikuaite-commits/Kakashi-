import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { runAiChat } from "../../../utils/aiChat.js";

export default {
  name: "gemini",
  description: "Use a inteligência artificial do Kakashi Bot!",
  commands: ["gemini", "kakashi", "ia"],
  usage: `${PREFIX}kakashi com quantos paus se faz uma canoa?`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async (props) => {
    const text = props.args.join(" ");

    if (!text) {
      throw new InvalidParameterError(
        "Você precisa me dizer o que eu devo responder!"
      );
    }

    await runAiChat(props, text, props.remoteJid);
  },
};
