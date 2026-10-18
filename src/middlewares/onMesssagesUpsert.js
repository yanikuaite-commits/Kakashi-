/**
 * Evento chamado quando uma mensagem
 * é enviada para o grupo do WhatsApp
 *
 * @author Dev Gui
 */
import { DEVELOPER_MODE } from "../config.js";
import { badMacHandler } from "../utils/badMacHandler.js";
import { checkIfMemberIsMuted } from "../utils/database.js";
import { dynamicCommand } from "../utils/dynamicCommand.js";
import {
  GROUP_PARTICIPANT_ADD,
  GROUP_PARTICIPANT_LEAVE,
  isAddOrLeave,
  isAtLeastMinutesInPast,
} from "../utils/index.js";
import { loadCommonFunctions } from "../utils/loadCommonFunctions.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { customMiddleware } from "./customMiddleware.js";
import { messageHandler } from "./messageHandler.js";
import { recordMessageEnvelope } from "../utils/messageEnvelopeRegistry.js";
import { hasPaymentMessage } from "../utils/paymentMessage.js";
import { handleAfkReferences } from "./afkHandler.js";
import { onGroupParticipantsUpdate } from "./onGroupParticipantsUpdate.js";
import { handlePendingDocOffer, handlePendingResolution } from "../services/downloader.js";
import { handleAudioFormatReply } from "../utils/audioFormatMenu.js";
import { handleInteractiveMenuReply } from "../utils/interactive.js";

export async function onMessagesUpsert({ socket, messages, startProcess }) {
  if (!messages.length) {
    return;
  }

  for (const webMessage of messages) {
    if (DEVELOPER_MODE) {
      infoLog(
        `\n\n⪨========== [ MENSAGEM RECEBIDA ] ==========⪩ \n\n${JSON.stringify(
          messages,
          null,
          2,
        )}`,
      );
    }

    try {
      if (!webMessage?.key?.remoteJid) {
        continue;
      }

      const timestamp = webMessage.messageTimestamp;

      // Registra o envelope (id -> autor/estado) de TODA mensagem de grupo,
      // para corroborar marcações de pagamento e impedir forja (banir inocente).
      recordMessageEnvelope(webMessage, hasPaymentMessage(webMessage));

      if (webMessage?.message) {
        messageHandler(socket, webMessage);
      }

      if (isAtLeastMinutesInPast(timestamp)) {
        continue;
      }

      if (isAddOrLeave.includes(webMessage.messageStubType)) {
        let action = "";
        if (webMessage.messageStubType === GROUP_PARTICIPANT_ADD) {
          action = "add";
        } else if (webMessage.messageStubType === GROUP_PARTICIPANT_LEAVE) {
          action = "remove";
        }

        await customMiddleware({
          socket,
          webMessage,
          type: "participant",
          action,
          data: webMessage.messageStubParameters[0],
          commonFunctions: null,
        });

        await onGroupParticipantsUpdate({
          data: webMessage.messageStubParameters[0],
          remoteJid: webMessage.key.remoteJid,
          socket,
          action,
        });

        return;
      }
      if (
        checkIfMemberIsMuted(
          webMessage?.key?.remoteJid,
          webMessage?.key?.participant?.replace(/:[0-9][0-9]|:[0-9]/g, ""),
        )
      ) {
        try {
          const { id, remoteJid, participant } = webMessage.key;

          const deleteKey = {
            remoteJid,
            fromMe: false,
            id,
            participant,
          };

          await socket.sendMessage(remoteJid, { delete: deleteKey });
        } catch (error) {
          errorLog(
            `Erro ao deletar mensagem de membro silenciado, provavelmente eu não sou administrador do grupo! ${error.message}`,
          );
        }

        return;
      }

      const commonFunctions = loadCommonFunctions({ socket, webMessage });

      if (!commonFunctions) {
        continue;
      }

      if (await handlePendingResolution({
        chatId: commonFunctions.remoteJid,
        jid: commonFunctions.userLid,
        text: commonFunctions.fullMessage,
        sendReply: commonFunctions.sendReply,
        sendVideoFromFile: commonFunctions.sendVideoFromFile,
      })) {
        continue;
      }

      if (await handlePendingDocOffer({
        chatId: commonFunctions.remoteJid,
        text: commonFunctions.fullMessage,
        sendReply: commonFunctions.sendReply,
        sendAudioDocumentFromFile: commonFunctions.sendAudioDocumentFromFile,
      })) {
        continue;
      }

      if (await handleAudioFormatReply({
        chatId: commonFunctions.remoteJid,
        senderLid: commonFunctions.userLid,
        senderName: webMessage?.pushName,
        text: commonFunctions.fullMessage,
        socket,
        sendReply: commonFunctions.sendReply,
        sendErrorReply: commonFunctions.sendErrorReply,
        sendAudioFromFile: commonFunctions.sendAudioFromFile,
        sendAudioDocumentFromFile: commonFunctions.sendAudioDocumentFromFile,
      })) {
        continue;
      }

      const interactiveReply = await handleInteractiveMenuReply({
        chatId: commonFunctions.remoteJid,
        senderId:
          commonFunctions.userLid ||
          (!commonFunctions.remoteJid.endsWith("@g.us")
            ? commonFunctions.remoteJid
            : ""),
        text: commonFunctions.fullMessage,
        sendReply: commonFunctions.sendReply,
      });

      if (interactiveReply?.handled) {
        continue;
      }

      let commandFunctions = commonFunctions;
      if (interactiveReply?.selectedId) {
        commandFunctions = loadCommonFunctions({
          socket,
          webMessage: {
            ...webMessage,
            message: {
              ...webMessage.message,
              conversation: interactiveReply.selectedId,
            },
          },
        });
      }

      await customMiddleware({
        socket,
        webMessage,
        type: "message",
        commonFunctions: commandFunctions,
      });

      await handleAfkReferences({
        webMessage,
        commonFunctions: commandFunctions,
      });

      await dynamicCommand(commandFunctions, startProcess);
    } catch (error) {
      if (badMacHandler.handleError(error, "message-processing")) {
        continue;
      }

      if (badMacHandler.isSessionError(error)) {
        errorLog(`Erro de sessão ao processar mensagem: ${error.message}`);
        continue;
      }

      errorLog(
        `Erro ao processar mensagem: ${error.message} | Stack: ${error.stack}`,
      );

      continue;
    }
  }
}
