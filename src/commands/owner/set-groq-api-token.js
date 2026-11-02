import { buildApiKeyCommand } from "../../utils/apiKeyCommand.js";

export default buildApiKeyCommand({
  key: "groq_api_key",
  aliases: [
    "set-groq-api-token",
    "set-groq-key",
    "groq-api-token",
    "muda-groq-api-token",
    "alterar-groq-api-token",
  ],
});
