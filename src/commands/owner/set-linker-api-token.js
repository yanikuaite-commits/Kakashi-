import { buildApiKeyCommand } from "../../utils/apiKeyCommand.js";

export default buildApiKeyCommand({
  key: "linker_api_key",
  aliases: [
    "set-linker-api-token",
    "set-linker-key",
    "linker-api-token",
    "muda-linker-api-token",
    "alterar-linker-api-token",
  ],
});
