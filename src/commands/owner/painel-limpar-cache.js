import { PREFIX } from "../../config.js";
import { resetActivity, recordEvent } from "../../services/activity.js";
import { saveSystemSamples } from "../../utils/database.js";

export default {
  name: "painel-limpar-cache",
  description: "Repõe o registo de atividade e as amostras de sistema do painel.",
  commands: ["painel-limpar-cache", "plimpar"],
  usage: `${PREFIX}painel-limpar-cache`,
  handle: async ({ sendSuccessReply }) => {
    resetActivity();
    saveSystemSamples([]);
    await recordEvent({
      tipo: "painel",
      usuario: "dono",
      acao: "registo de atividade e amostras de sistema limpos",
    });

    await sendSuccessReply(
      "🧹 Registo de atividade e amostras de sistema do painel foram repostos.",
    );
  },
};
