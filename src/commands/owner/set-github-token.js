import { buildApiKeyCommand } from "../../utils/apiKeyCommand.js";

export default buildApiKeyCommand({
  key: "github_token",
  aliases: [
    "set-github-token",
    "altera-github-token",
    "alterar-github-token",
    "muda-github-token",
    "mudar-github-token",
    "github-token",
  ],
});
