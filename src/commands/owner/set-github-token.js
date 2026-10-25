import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { setGithubToken } from "../../utils/database.js";

export default {
  name: "set-github-token",
  description: "Mudo o token do GitHub usado no backup",
  commands: [
    "set-github-token",
    "altera-github-token",
    "alterar-github-token",
    "muda-github-token",
    "mudar-github-token",
    "github-token",
  ],
  usage: `${PREFIX}set-github-token token aqui`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ args, sendSuccessReply }) => {
    if (!args.length) {
      throw new InvalidParameterError("Você deve fornecer um token!");
    }

    const newToken = args[0];

    // Os tokens atuais do GitHub têm 40+ caracteres (clássicos `ghp_`/`github_pat_`).
    // O limite antigo de 25 era da API Spider e recusava tokens válidos.
    if (newToken.length < 20) {
      throw new InvalidParameterError("O token parece curto demais!");
    }

    setGithubToken(newToken);

    await sendSuccessReply(
      "Token do GitHub alterado com sucesso! Use `.backup` para testar."
    );
  },
};
