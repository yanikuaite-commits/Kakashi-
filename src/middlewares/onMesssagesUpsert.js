/**
 * Evento chamado quando uma mensagem
 * é enviada para o grupo do WhatsApp
 *
 * @author Dev Gui
 */
import { DEVELOPER_MODE, PREFIX } from "../config.js";
import { badMacHandler } from "../utils/badMacHandler.js";
import { checkIfMemberIsMuted, getPrefix } from "../utils/database.js";
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
import { handlePendingDocOffer } from "../services/downloader.js";
import { handleAudioFormatReply } from "../utils/audioFormatMenu.js";
import { handleInteractiveMenuReply } from "../utils/interactive.js";
import { handleVideoFormatReply } from "../utils/videoFormatMenu.js";
import { handleGuidedFlow, resumePendingFunction } from "../interactive/flow.js";
import { handleAnimeReply } from "../utils/animeMenu.js";

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

      // Fluxo de animes (HiAnime): antes do fluxo guiado, porque com uma
      // sessão de anime aberta o próximo texto é o NOME do anime.
      if (await handleAnimeReply({
        socket,
        chatId: commonFunctions.remoteJid,
        senderLid: commonFunctions.userLid,
        senderLids: [
          webMessage?.key?.participant,
          webMessage?.key?.participantAlt,
        ].filter(Boolean),
        senderName: webMessage?.pushName,
        text: commonFunctions.fullMessage,
        sendReply: commonFunctions.sendReply,
        sendVideoFromFile: commonFunctions.sendVideoFromFile,
        prefix: getPrefix(commonFunctions.remoteJid) || PREFIX,
      })) {
        continue;
      }

      // Fluxo guiado (menu → categoria → função → execução).
      if (await handleGuidedFlow({
        socket,
        chatId: commonFunctions.remoteJid,
        senderId: commonFunctions.userLid,
        senderName: webMessage?.pushName,
        text: commonFunctions.fullMessage,
        webMessage,
        commonFunctions,
        sendReply: commonFunctions.sendReply,
        dispatch: async ({ comando, input, args }) => {
          const prefixo = getPrefix(commonFunctions.remoteJid) || PREFIX;
          const comandoCompleto = [
            `${prefixo}${comando}`,
            args,
            input,
          ]
            .filter(Boolean)
            .join(" ");

          const syntheticMessage = {
            ...webMessage,
            message: {
              ...webMessage.message,
              conversation: comandoCompleto,
            },
          };

          const functions = loadCommonFunctions({
            socket,
            webMessage: syntheticMessage,
          });

          if (!functions) return;

          await dynamicCommand(functions, startProcess);
        },
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
        jid: commonFunctions.userLid,
        sendReply: commonFunctions.sendReply,
        sendErrorReply: commonFunctions.sendErrorReply,
        sendAudioFromFile: commonFunctions.sendAudioFromFile,
        sendAudioDocumentFromFile: commonFunctions.sendAudioDocumentFromFile,
        // Depois do áudio enviado, mantém a função do fluxo guiado ativa
        // ("Envie outro link ...") por mais 2 minutos.
        onFinished: async () => {
          await resumePendingFunction({
            chatId: commonFunctions.remoteJid,
            senderId: commonFunctions.userLid,
            sendReply: commonFunctions.sendReply,
          });
        },
      })) {
        continue;
      }

      if (await handleVideoFormatReply({
        chatId: commonFunctions.remoteJid,
        senderLid: commonFunctions.userLid,
        senderName: webMessage?.pushName,
        text: commonFunctions.fullMessage,
        socket,
        jid: commonFunctions.userLid,
        sendReply: commonFunctions.sendReply,
        sendErrorReply: commonFunctions.sendErrorReply,
        sendVideoFromFile: commonFunctions.sendVideoFromFile,
        // Depois do vídeo enviado, mantém a função do fluxo guiado ativa
        // ("Envie outro link ...") por mais 2 minutos.
        onFinished: async () => {
          await resumePendingFunction({
            chatId: commonFunctions.remoteJid,
            senderId: commonFunctions.userLid,
            sendReply: commonFunctions.sendReply,
          });
        },
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
