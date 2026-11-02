import { buildApiKeyCommand } from "../../utils/apiKeyCommand.js";

export default buildApiKeyCommand({
  key: "spider_api_token",
  aliases: [
    "set-spider-api-token",
    "altera-spider-api-token",
    "alterar-spider-api-token",
    "muda-spider-api-token",
    "mudar-spider-api-token",
    "spider-api-token",
  ],
});
