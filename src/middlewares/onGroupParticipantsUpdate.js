/**
 * Evento chamado quando um usuário
 * entra ou sai de um grupo de WhatsApp.
 *
 * @author Dev Gui
 */
import { exitMessage, welcomeMessage } from "../messages.js";
import { formatMessage } from "../utils/formatMessage.js";
import {
  getPrefix,
  isActiveExitGroup,
  isActiveGroup,
  isActiveWelcomeGroup,
} from "../utils/database.js";
import { extractUserLid, onlyNumbers } from "../utils/index.js";
import { errorLog } from "../utils/logger.js";

/**
 * Aplica o molde visual único (e o rodapé "© Made by Yanik Uaite") à mensagem
 * de boas-vindas/despedida, preenchendo {grupo} e {prefixo} quando presentes.
 */
async function frameParticipantMessage(socket, remoteJid, text, titulo) {
  let groupName = "este grupo";

  try {
    const metadata = await socket.groupMetadata(remoteJid);
    groupName = metadata?.subject || groupName;
  } catch (error) {
    errorLog(`Não foi possível ler o nome do grupo: ${error.message}`);
  }

  const content = text
    .replace("{grupo}", groupName)
    .replace("{prefixo}", getPrefix(remoteJid));

  return formatMessage({
    icone: "👋",
    titulo,
    campos: content.split("\n"),
  });
}

export async function onGroupParticipantsUpdate({
  data,
  remoteJid,
  socket,
  action,
}) {
  try {
    if (!remoteJid.endsWith("@g.us")) {
      return;
    }

    if (!isActiveGroup(remoteJid)) {
      return;
    }

    const userLid = extractUserLid(data);

    if (isActiveWelcomeGroup(remoteJid) && action === "add") {
      const hasMemberMention = welcomeMessage.includes("@member");

      const mentions = [];
      let finalWelcomeMessage = welcomeMessage;

      if (hasMemberMention) {
        const userNumber = onlyNumbers(userLid);
        finalWelcomeMessage = welcomeMessage.replace(
          "@member",
          `@${userNumber}`,
        );
        mentions.push(userLid);
      }

      await socket.sendMessage(remoteJid, {
        text: await frameParticipantMessage(
          socket,
          remoteJid,
          finalWelcomeMessage,
          "Boas-vindas",
        ),
        mentions,
      });
    } else if (isActiveExitGroup(remoteJid) && action === "remove") {
      const hasMemberMention = exitMessage.includes("@member");

      const mentions = [];
      let finalExitMessage = exitMessage;

      if (hasMemberMention) {
        const userNumber = onlyNumbers(userLid);
        finalExitMessage = exitMessage.replace("@member", `@${userNumber}`);
        mentions.push(userLid);
      }

      await socket.sendMessage(remoteJid, {
        text: await frameParticipantMessage(
          socket,
          remoteJid,
          finalExitMessage,
          "Despedida",
        ),
        mentions,
      });
    }
  } catch (error) {
    errorLog(`Erro em onGroupParticipantsUpdate: ${error.message}`);
    errorLog(error);
  }
}
