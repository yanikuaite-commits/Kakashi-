import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { googleTtsUrl } from "../../../services/public-ai.js";

const ALLOWED_VOICES = ["ana", "joao", "joão", "pedro"];
const MIN_TEXT_LENGTH = 5;
const MAX_TEXT_LENGTH = 2048;

export default {
  name: "tts",
  description:
    "Converte texto em áudio falado (TTS) com as vozes Ana, João ou Pedro.",
  commands: ["tts", "falar", "text-to-speech"],
  usage: `${PREFIX}tts texto / voz`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    args,
    sendWaitReply,
    sendSuccessReact,
    sendAudioFromURL,
  }) => {
    const text = args.slice(0, -1).join(" ").trim() || args[0]?.trim();
    const voice = (args[1]?.trim() || "joao").toLowerCase();

    if (!text) {
      throw new InvalidParameterError(
        `Você precisa informar o texto!\n\nExemplo: ${PREFIX}tts Olá, tudo bem? / joao\nVozes: ana, joao, pedro`,
      );
    }

    if (text.length < MIN_TEXT_LENGTH) {
      throw new InvalidParameterError(
        `O texto deve ter no mínimo ${MIN_TEXT_LENGTH} caracteres.`,
      );
    }

    if (text.length > MAX_TEXT_LENGTH) {
      throw new InvalidParameterError(
        `O texto deve ter no máximo ${MAX_TEXT_LENGTH} caracteres.`,
      );
    }

    if (!ALLOWED_VOICES.includes(voice)) {
      throw new InvalidParameterError("Voz inválida! Use: joao, ana ou pedro.");
    }

    await sendWaitReply("Gerando áudio...");

    const audioUrl = googleTtsUrl(text);

    await sendSuccessReact();
    await sendAudioFromURL(audioUrl, true);
  },
};
