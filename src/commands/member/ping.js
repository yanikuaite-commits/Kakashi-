/**
 * Melhorado por: Mkg
 *
 * @author Dev Gui
 */
import { PREFIX } from "../../config.js";
import { formatMessage } from "../../utils/formatMessage.js";

export default {
  name: "ping",
  description:
    "Verificar se o bot está online, o tempo de resposta e o tempo de atividade.",
  commands: ["ping", "pong"],
  usage: `${PREFIX}ping`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ sendReply, sendReact, startProcess, commandName }) => {
    const response = commandName === "ping" ? "🏓 *Pong!*" : "🏓 *Ping!*";

    await sendReact("🏓");

    const uptime = process.uptime();

    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);

    const ping = Date.now() - startProcess;

    await sendReply(
      formatMessage({
        icone: "🏓",
        titulo: "Ping",
        campos: [
          response,
          `📶 *Velocidade:* ${ping}ms`,
          `⏱️ *Uptime:* ${h}h ${m}m ${s}s`,
        ],
      }),
    );
  },
};