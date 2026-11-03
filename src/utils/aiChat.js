/**
 * Fluxo de chat da IA, partilhado pelos comandos `.kakashi`/`.gemini`,
 * `.gpt-5-mini` e `.deepseek`.
 *
 * A IA pode responder em texto ou pedir a execução de um comando. A execução é
 * re-despachada pelo `dynamicCommand` sobre uma mensagem sintética: permissões,
 * anti-flood, créditos e erros continuam a valer exatamente como num comando
 * escrito à mão. A IA nunca escreve no estado do bot — só pede.
 *
 * @author Dev Yanik
 */
import { PREFIX } from "../config.js";
import { isAdmin } from "../middlewares/index.js";
import { askGroq } from "../services/ai.js";
import { acaoDoTexto, resolveAiAction } from "../services/botCommands.js";
import { resolveOwnerContext } from "../services/botSnapshot.js";
import { getPrefix } from "./database.js";
import { dynamicCommand } from "./dynamicCommand.js";
import { aiMessage } from "./formatMessage.js";
import { loadCommonFunctions } from "./loadCommonFunctions.js";
import { errorLog } from "./logger.js";

/** Um admin do grupo, sem rebentar quando o `groupMetadata` falha. */
async function adminOuFalso({ remoteJid, userLid, socket }) {
  try {
    return await isAdmin({ remoteJid, userLid, socket });
  } catch (error) {
    errorLog(`Falha ao verificar admin para a IA: ${error.message}`);
    return false;
  }
}

/**
 * Despacha o comando pedido pela IA como se o usuário o tivesse escrito.
 *
 * @param {CommandHandleProps} props props do comando de IA
 * @param {{comando: string, args: string}} resolved
 */
async function despachar(props, resolved) {
  const { socket, webMessage, startProcess, remoteJid, prefix } = props;
  const prefixo = prefix || getPrefix(remoteJid) || PREFIX;
  const comandoCompleto = [prefixo + resolved.comando, resolved.args]
    .filter(Boolean)
    .join(" ");

  const syntheticMessage = {
    ...webMessage,
    message: { ...webMessage.message, conversation: comandoCompleto },
  };

  const functions = loadCommonFunctions({
    socket,
    webMessage: syntheticMessage,
  });

  if (!functions) return false;

  await dynamicCommand(functions, startProcess);
  return true;
}

/**
 * Corre o chat da IA e executa a acção, quando ela existe.
 *
 * @param {CommandHandleProps} props props do comando de IA
 * @param {string} text pergunta do usuário
 * @param {string} chatId id da conversa (histórico da IA)
 */
export async function runAiChat(props, text, chatId) {
  const {
    remoteJid,
    isGroup,
    isOwner,
    userLid,
    socket,
    sendReply,
    sendSuccessReply,
    sendWaitReply,
    sendEditedReply,
    getGroupName,
    getGroupParticipants,
  } = props;

  const waitingMessage = await sendWaitReply("🤔 Pensando...");

  // Só o dono recebe o estado real do bot; para um membro o contexto é nulo.
  const context = await resolveOwnerContext({
    isOwner,
    socket,
    isGroup,
    remoteJid,
    getGroupName,
    getGroupParticipants,
  });

  // Executar comandos é para quem manda no grupo (dono ou admin) e só em grupo:
  // os interruptores agem sobre o grupo atual, e no privado não há grupo.
  const allowCommands =
    isGroup && (isOwner || (await adminOuFalso({ remoteJid, userLid, socket })));

  const { text: answer, action } = await askGroq(chatId, text, {
    context,
    allowCommands,
  });

  // O modelo devolve o pedido como JSON. Se, mesmo assim, responder em prosa
  // ("ativar anti status"), o próprio texto do usuário é lido como pedido —
  // senão a funcionalidade dependeria de o modelo acertar no protocolo.
  const pedido = action || (allowCommands ? await acaoDoTexto(text) : null);

  if (pedido) {
    const resolved = await resolveAiAction(pedido);

    if (!resolved.ok) {
      await sendReply(
        `Não conheço esse comando. Diz-me o nome exato (ex.: \`${PREFIX}anti-link 1\`) ou usa \`${PREFIX}menu\`.`,
      );
      return;
    }

    // O comando real responde por si (sucesso ou erro de permissão).
    await despachar(props, resolved);
    return;
  }

  const framed = aiMessage({ pergunta: text, resposta: answer });

  if (waitingMessage) {
    await sendEditedReply(framed, waitingMessage);
  } else {
    await sendSuccessReply(framed);
  }
}
