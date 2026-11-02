import { buildApiKeyCommand } from "../../utils/apiKeyCommand.js";

export default buildApiKeyCommand({
  key: "gemini_api_key",
  aliases: [
    "set-gemini-api-token",
    "set-gemini-key",
    "gemini-api-token",
    "muda-gemini-api-token",
    "alterar-gemini-api-token",
  ],
});
