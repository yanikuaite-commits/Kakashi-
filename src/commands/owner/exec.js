/**
 * Desenvolvido por: Mkg
 * Refatorado por: Dev Gui
 * Proteções de segurança implementadas
 *
 * @author Dev Gui
 */
import { exec as execChild } from "child_process";
import { PREFIX } from "../../config.js";
import { DangerError } from "../../errors/index.js";
import { isBotOwner } from "../../middlewares/index.js";

const DANGEROUS_COMMANDS = [
  ":()",
  "mkfs",
  "fdisk",
  "parted",
  "format",
  "halt",
  "poweroff",
  "reboot",
  "shutdown",
  "init 0",
  "init 6",
];

const DANGEROUS_PATTERNS = [
  /:\(\)\s*\{/i,
  /rm\s+-rf\s+\/($|\s)/i,
  /rm\s+-rf\s+~\/\*/i,
  /rm\s+-rf\s+\*($|\s)/i,
  /dd\s+.*of=\/dev\/sd[a-z]/i,
  /mkfs\.[a-z]+\s+\/dev/i,
  /:\(\)\s*\{.*fork/i,
  /curl.*\|\s*bash/i,
  /wget.*\|\s*bash/i,
  /curl.*\|\s*sh/i,
  /wget.*\|\s*sh/i,
  /chmod\s+777\s+\//i,
  /chown\s+.*\s+\//i,
  />\s*\/dev\/sd[a-z]/i,
];

function isSafeCommand(command) {
  const trimmedCommand = command.trim();
  const lowerCommand = trimmedCommand.toLowerCase();

  for (const dangerous of DANGEROUS_COMMANDS) {
    if (lowerCommand.includes(dangerous.toLowerCase())) {
      return {
        safe: false,
        reason: `Comando perigoso detectado: ${dangerous}`,
      };
    }
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return {
        safe: false,
        reason: `Padrão perigoso detectado: operação destrutiva bloqueada`,
      };
    }
  }

  return { safe: true };
}

export default {
  name: "exec",
  description: "Executa comandos do terminal diretamente pelo bot.",
  commands: ["exec"],
  usage: `${PREFIX}exec comando
  
Apenas comandos destrutivos do sistema são bloqueados (formatação, shutdown, fork bombs, etc).

Exemplos permitidos: 
- ls, pwd, cat arquivo.txt
- npm install, yarn add, pnpm install
- git status, git pull, git commit
- node script.js, python arquivo.py
- rm arquivo.txt, mv origem destino
- chmod 755 script.sh
- mkdir, touch, cp, etc.
Execute qualquer comando do terminal. 
Apenas operações destrutivas críticas são bloqueadas (formatação de disco, shutdown, fork bombs, etc)

Este comando pode causar danos críticos ao sistema.`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ fullArgs, sendSuccessReply, sendErrorReply, userLid, isOwner }) => {
    // "isOwner" vem do dispetche (no privado o userLid fica vazio, então o dono
    // é reconhecido pelo JID da conversa). Sem ele, vale o userLid do grupo.
    if (!(isOwner ?? isBotOwner({ userLid }))) {
      throw new DangerError("Apenas o dono do bot pode usar este comando!");
    }

    if (!fullArgs) {
      throw new DangerError(
        `Uso correto: ${PREFIX}exec comando\n\nExecute qualquer comando do terminal. \nApenas operações destrutivas críticas são bloqueadas (formatação de disco, shutdown, fork bombs, etc).`
      );
    }

    const safetyCheck = isSafeCommand(fullArgs);

    if (!safetyCheck.safe) {
      throw new DangerError(
        `⛔ Comando bloqueado por segurança!\n\nMotivo: ${safetyCheck.reason}\n\nEste comando pode causar danos críticos ao sistema.`
      );
    }

    const timeoutMs = 15000;
    const maxBuffer = 1024 * 1024;

    execChild(
      fullArgs,
      {
        timeout: timeoutMs,
        maxBuffer: maxBuffer,
      },
      async (error, stdout, stderr) => {
        if (error) {
          if (error.code === "ETIMEDOUT") {
            await sendErrorReply("⏱️ Comando cancelado por timeout (15s)");
          }

          if (error.message.includes("maxBuffer")) {
            await sendErrorReply("📊 Saída muito grande, comando cancelado");
          }

          await sendErrorReply(error.message);
        }

        let output = stdout || stderr || "Comando executado sem saída.";

        const maxOutputLength = 3500;

        if (output.length > maxOutputLength) {
          output =
            output.substring(0, maxOutputLength) + "\n\n... (saída truncada)";
        }

        output = output.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

        await sendSuccessReply(
          `Resultado do comando: \`${fullArgs}\`\n\n` +
            `\`\`\`\n${output.trim()}\n\`\`\``
        );
      }
    );
  },
};
