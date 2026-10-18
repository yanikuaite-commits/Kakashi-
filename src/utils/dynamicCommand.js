/**
 * Direcionador
 * de comandos.
 *
 * @author Dev Gui
 */
import { BOT_EMOJI, ONLY_GROUP_ID, PREFIX } from "../config.js";
import {
  DangerError,
  InvalidParameterError,
  WarningError,
} from "../errors/index.js";
import {
  moderationMessage,
  permissionMessage,
  usageMessage,
} from "./formatMessage.js";
import {
  checkPermission,
  hasTypeAndCommand,
  isAdmin,
  isBotOwner,
  isLink,
  isOwnerInPrivateChat,
  verifyPrefix,
} from "../middlewares/index.js";
import { processAutoSticker } from "../services/sticker.js";
import {
  chargeCredits,
  commandCost,
  creditsExhaustedMessage,
  refundCredits,
  withCreditsContext,
} from "../services/credits.js";
import { badMacHandler } from "./badMacHandler.js";
import {
  getAutoResponderResponse,
  getPrefix,
  isBotEnabled,
  isCommandBlocked,
  isPrivateWhitelisted,
  isActiveAntiLinkGroup,
  isActiveAutoResponderGroup,
  isActiveAutoStickerGroup,
  isActiveGroup,
  isActiveOnlyAdmins,
} from "./database.js";
import { findCommandInMessage, onlyNumbers } from "./index.js";
import { errorLog } from "./logger.js";

/**
 * @param {CommandHandleProps} paramsHandler
 * @param {number} startProcess
 */
export async function dynamicCommand(paramsHandler, startProcess) {
  const {
    commandName,
    fullMessage,
    prefix,
    remoteJid,
    sendErrorReply,
    sendReact,
    sendReply,
    sendWarningReply,
    socket,
    userLid,
    webMessage,
  } = paramsHandler;

  const activeGroup = remoteJid.endsWith("@g.us") && isActiveGroup(remoteJid);
  const isPrivate = !remoteJid.endsWith("@g.us");
  // No chat privado não existe "participant", então o userLid vem vazio e o dono
  // é reconhecido também pelo próprio JID da conversa (ver OWNER_PRIVATE_ALL).
  const isOwner =
    isBotOwner({ userLid }) || (isPrivate && isOwnerInPrivateChat(webMessage));

  if (!isOwner && !isBotEnabled()) {
    return;
  }

  if (!isOwner && isPrivate && !isPrivateWhitelisted(remoteJid)) {
    return;
  }

  if (activeGroup && isActiveAntiLinkGroup(remoteJid) && isLink(fullMessage)) {
    if (!userLid) {
      return;
    }

    if (!(await isAdmin({ remoteJid, userLid, socket }))) {
      await socket.groupParticipantsUpdate(remoteJid, [userLid], "remove");

      await sendReply(
        moderationMessage({
          resumo: `🛡️ *@${onlyNumbers(userLid)}* foi removido do grupo.`,
          motivo: "enviou um link com o anti-link ativado",
        }),
        [userLid],
      );

      await socket.sendMessage(remoteJid, {
        delete: {
          remoteJid,
          fromMe: false,
          id: webMessage.key.id,
          participant: webMessage.key.participant,
        },
      });

      return;
    }
  }

  if (activeGroup && isActiveAutoStickerGroup(remoteJid)) {
    const processed = await processAutoSticker(paramsHandler);

    if (processed) {
      return;
    }
  }

  const groupPrefix = getPrefix(remoteJid);
  const validPrefix = verifyPrefix(prefix, remoteJid) ||
    prefix === "" || (prefix === "!" && ["baixar", "download"].includes(commandName));
  const resolved = validPrefix
    ? await findCommandInMessage(commandName, paramsHandler.fullArgs)
    : { type: "", command: null, commandName, fullArgs: paramsHandler.fullArgs, args: paramsHandler.args };
  const { type, command } = resolved;
  const invocation = { ...paramsHandler, ...resolved, prefix: prefix || groupPrefix };

  if (!isOwner && (isCommandBlocked(commandName) || command?.commands.some(isCommandBlocked))) {
    return;
  }

  if (ONLY_GROUP_ID && ONLY_GROUP_ID !== remoteJid && !(isOwner && isPrivate)) {
    return;
  }

  if (activeGroup) {
    if (
      !validPrefix ||
      !hasTypeAndCommand({ type, command })
    ) {
      if (isActiveAutoResponderGroup(remoteJid)) {
        const response = getAutoResponderResponse(fullMessage);

        if (response) {
          await sendReply(response);
        }
      }

      if (fullMessage.toLocaleLowerCase().includes("prefixo")) {
        await sendReact(BOT_EMOJI);
        const groupPrefix = getPrefix(remoteJid);
        await sendReply(
          `O padrão é: ${groupPrefix}\nUse ${groupPrefix}menu para ver os comandos disponíveis!`
        );
      }

      return;
    }

    if (!(await checkPermission({ type, ...invocation }))) {
      await sendErrorReply(
        permissionMessage("🚫 Você não tem permissão para executar este comando!")
      );
      return;
    }

    if (
      isActiveOnlyAdmins(remoteJid) &&
      !(await isAdmin({ remoteJid, userLid, socket }))
    ) {
      await sendWarningReply(permissionMessage());
      return;
    }
  }

  if (!isOwner && !activeGroup && remoteJid.endsWith("@g.us")) {
    if (
      validPrefix &&
      hasTypeAndCommand({ type, command })
    ) {
      if (command.name !== "on") {
        await sendWarningReply(
          "Este grupo está desativado! Peça para o dono do grupo ativar o bot!"
        );
        return;
      }

      if (!(await checkPermission({ type, ...invocation }))) {
        await sendErrorReply(
          permissionMessage("🚫 Você não tem permissão para executar este comando!")
        );
        return;
      }
    } else {
      return;
    }
  }

  if (!validPrefix) {
    return;
  }

  if (fullMessage === groupPrefix) {
    await sendReact(BOT_EMOJI);
    await sendReply(
      `Este é meu prefixo! Use ${groupPrefix}menu para ver os comandos disponíveis!`
    );

    return;
  }

  if (!hasTypeAndCommand({ type, command })) {
    if (!prefix) return;
    await sendWarningReply(
      `Comando não encontrado! Use ${groupPrefix}menu para ver os comandos disponíveis!`
    );

    return;
  }

  if (isPrivate && !isOwner && type !== "member") {
    await sendErrorReply(permissionMessage("🚫 Você não tem permissão para executar este comando!"));
    return;
  }

  // Créditos: funções de membro gastam créditos. O dono do bot não gasta.
  // Sem conta (dono), o contexto de mídia não cobra nada.
  const accountId = isOwner ? null : userLid || remoteJid;
  const cost = !isOwner && type === "member" ? commandCost(command, resolved.commandName) : 0;
  let chargedCredits = 0;

  if (cost > 0) {
    const charge = chargeCredits(accountId, cost, {
      reason: `comando:${command.name}`,
      countUsage: true,
    });

    if (!charge.ok) {
      await sendReply(
        creditsExhaustedMessage({
          commandName: command.name,
          cost,
          account: charge.account,
          prefix: groupPrefix,
        }),
      );

      return;
    }

    chargedCredits = charge.charged;
  }

  try {
    await withCreditsContext(accountId, () =>
      command.handle({
        ...invocation,
        type,
        startProcess,
        isOwner,
      }),
    );
  } catch (error) {
    if (chargedCredits > 0 && accountId) {
      refundCredits(accountId, chargedCredits);
    }

    if (badMacHandler.handleError(error, `command:${command?.name}`)) {
      await sendWarningReply(
        "Erro temporário de sincronização. Tente novamente em alguns segundos."
      );
      return;
    }

    if (badMacHandler.isSessionError(error)) {
      errorLog(
        `Erro de sessão durante execução de comando ${command?.name}: ${error.message}`
      );
      await sendWarningReply(
        "Erro de comunicação. Tente executar o comando novamente."
      );
      return;
    }

    if (error instanceof InvalidParameterError) {
      const usage = command?.usage?.split("\n")[0];
      const prettyUsage =
        usage && usage.startsWith(PREFIX)
          ? `${groupPrefix}${usage.slice(PREFIX.length)}`
          : usage;

      await sendWarningReply(
        usageMessage({ usage: prettyUsage, detalhe: error.message }),
      );
    } else if (error instanceof WarningError) {
      await sendWarningReply(error.message);
    } else if (error instanceof DangerError) {
      await sendErrorReply(error.message);
    } else if (error.isAxiosError) {
      const messageText = error.response?.data?.message || error.message;
      const url = error.config?.url || "URL não disponível";

      const isSpiderAPIError = url.includes("api.spiderx.com.br");

      await sendErrorReply(
        `Chamada remota falhou (${isSpiderAPIError ? "Spider X API" : url}) no comando ${command.name}: ${messageText}`,
      );
    } else {
      errorLog("Erro ao executar comando", error);
      await sendErrorReply(`No comando ${command.name}: ${error.message}`);
    }
  }
}
