import { buildApiKeyCommand } from "../../utils/apiKeyCommand.js";

export default buildApiKeyCommand({
  key: "hf_token",
  aliases: [
    "set-hf-token",
    "set-huggingface-token",
    "hf-token",
    "muda-hf-token",
    "alterar-hf-token",
  ],
});
