/**
 * Direcionador
 * de comandos.
 *
 * @author Dev Yanik
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
  hasSufficientCredits,
  refundCredits,
  withCreditsContext,
} from "../services/credits.js";
import { badMacHandler } from "./badMacHandler.js";
import { withDownloadNotifier } from "../services/downloadQueue.js";
import { withKakashiVoice } from "../services/kakashiVoice.js";
import { isBanned } from "../services/blacklist.js";
import {
  recordCommandUsage,
  recordEvent,
  recordEventThrottled,
} from "../services/activity.js";
import {
  checkRateLimit,
  isRateLimited,
  rateLimitMessage,
  registerCommandUse,
} from "../services/rateLimit.js";
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
  isPrefixlessEnabled,
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

  // Blacklist global: quem está banido não é atendido em lado nenhum. O dono
  // fica de fora para não se trancar fora do próprio bot (e para poder
  // desbanir quem banir por engano).
  if (!isOwner && isBanned(userLid || remoteJid)) {
    const alvo = userLid || remoteJid;
    recordEventThrottled({
      chave: `banido:${alvo}`,
      tipo: "acesso-negado",
      usuario: alvo,
      acao: "mensagem de usuário banido",
      resultado: "bloqueado",
    });
    return;
  }

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
  const prefixless = isPrefixlessEnabled(remoteJid);
  // O prefixo `!` é o "cantinho" dos clientes que não renderizam botões (iOS):
  // além de invocar o comando, pede a resposta em TEXTO. Sem ele, estes
  // utilizadores recebiam cards que não conseguem abrir.
  const textOnly = prefix === "!";
  const validPrefix =
    verifyPrefix(prefix, remoteJid) || textOnly || prefixless;

  // Quando o prefixless está ativo, se a mensagem não tinha o prefixo, ajustamos a forma de encontrar o comando simulando o prefixo do grupo
  let effectiveCommandName = commandName;
  let effectiveFullArgs = paramsHandler.fullArgs;
  let effectiveArgs = paramsHandler.args;

  if (prefixless && !verifyPrefix(prefix, remoteJid) && prefix !== "!" && fullMessage) {
    const resolvedPrefixless = await findCommandInMessage(fullMessage.startsWith(groupPrefix) ? fullMessage.slice(groupPrefix.length) : fullMessage, fullMessage);
    if (resolvedPrefixless && resolvedPrefixless.command) {
      effectiveCommandName = resolvedPrefixless.commandName;
      effectiveFullArgs = resolvedPrefixless.fullArgs;
      effectiveArgs = resolvedPrefixless.args;
    }
  }

  const resolved = validPrefix
    ? await findCommandInMessage(effectiveCommandName, effectiveFullArgs)
    : { type: "", command: null, commandName: effectiveCommandName, fullArgs: effectiveFullArgs, args: effectiveArgs };
  const { type, command } = resolved;
  const invocation = { ...paramsHandler, ...resolved, prefix: prefix || groupPrefix, textOnly };

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
    if (!prefix && !prefixless) return;
    // No modo prefixless, ignora silenciosamente mensagens que não são comandos.
    // Só responde quando há prefixo explícito (erro normal) ou quando a mensagem
    // é claramente um comando que não existe.
    if (prefixless && !prefix && !fullMessage.startsWith(groupPrefix)) return;
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

  // Anti-flood: antes de cobrar, para quem é travado não gastar saldo.
  // Vale só para os comandos que gastam recursos caros (ver RATE_LIMITED_COMMANDS).
  if (accountId && isRateLimited(command)) {
    const travado = checkRateLimit(accountId, { isOwner });

    if (!travado.ok) {
      await sendReply(
        rateLimitMessage({
          commandName: command.name,
          reason: travado.reason,
          retryInSeconds: travado.retryInSeconds,
          count: travado.count,
          limit: travado.limit,
        }),
      );

      return;
    }
  }

  // Verificação explícita ANTES de executar: sem saldo, o comando nem começa.
  if (cost > 0) {
    const saldo = hasSufficientCredits(accountId, cost);

    if (!saldo.ok) {
      await sendReply(
        creditsExhaustedMessage({
          commandName: command.name,
          cost,
          account: saldo.account,
          prefix: groupPrefix,
        }),
      );

      return;
    }

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

  // Só conta para o anti-flood o que foi efetivamente autorizado: um comando
  // recusado por falta de saldo (acima) não gasta o teto diário.
  if (accountId && isRateLimited(command)) {
    registerCommandUse(accountId);
  }

  // Estatísticas do painel: também só o que foi autorizado. Registar antes das
  // verificações encheria o top de comandos com tentativas recusadas.
  recordCommandUsage({
    comando: command.name,
    usuario: accountId || "dono",
    nome: webMessage?.pushName || "",
    grupo: activeGroup ? remoteJid : "",
  });

  try {
    await withCreditsContext(accountId, () =>
      withDownloadNotifier(
        sendReply,
        () =>
          withKakashiVoice(
            paramsHandler.sendAudioFromFile,
            () =>
              command.handle({
                ...invocation,
                type,
                startProcess,
                isOwner,
              }),
          ),
        // O dono tem prioridade na fila: um ajuste urgente não fica atrás de
        // downloads de membros.
        { priority: isOwner },
      ),
    );
  } catch (error) {
    recordEvent({
      tipo: "erro",
      usuario: accountId || "dono",
      acao: `comando ${command.name}: ${error.message}`,
      resultado: "erro",
    });

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
