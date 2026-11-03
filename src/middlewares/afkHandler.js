import {
  getAfkSnapshot,
  getPrefix,
  removeAfkMember,
  removeGlobalAfkMember,
} from "../utils/database.js";

const MESSAGE_WRAPPERS = [
  "documentWithCaptionMessage",
  "editedMessage",
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
];

function normalizeUserId(userId) {
  return userId?.replace(/:\d+(?=@)/, "");
}

function getMessageContextInfo(message) {
  if (!message) {
    return null;
  }

  for (const content of Object.values(message)) {
    if (content?.contextInfo) {
      return content.contextInfo;
    }
  }

  for (const wrapper of MESSAGE_WRAPPERS) {
    const wrappedMessage = message[wrapper]?.message;

    if (wrappedMessage) {
      return getMessageContextInfo(wrappedMessage);
    }
  }

  return null;
}

/**
 * Responde quando uma mensagem menciona ou cita um membro ausente.
 *
 * A ausência por grupo vale no grupo onde foi escrita; a ausência global (do
 * dono) vale em todos os grupos. Ao responder, marca o membro ausente na
 * mensagem, para a pessoa ver a quem o aviso se refere.
 *
 * @param {{ webMessage: import("baileys").WAMessage, commonFunctions: CommandHandleProps }} params
 */
export async function handleAfkReferences({ webMessage, commonFunctions }) {
  if (!commonFunctions.isGroup) {
    return;
  }

  const { commandName, prefix, remoteJid, userLid } = commonFunctions;
  const afk = getAfkSnapshot(remoteJid);
  const isAfkCommand =
    (prefix === "" || prefix === getPrefix(remoteJid)) &&
    ["afk", "ausente"].includes(commandName);

  // Qualquer mensagem de quem estava ausente cancela a ausência — é o sinal de
  // que voltou. O comando `.afk` fica de fora: escrever `.afk <motivo>` renova
  // a ausência em vez de a cancelar.
  if (!isAfkCommand) {
    if (afk.group[userLid]) {
      removeAfkMember(remoteJid, userLid);
      delete afk.group[userLid];
    }

    if (afk.global[userLid]) {
      removeGlobalAfkMember(userLid);
      delete afk.global[userLid];
    }
  }

  const contextInfo = getMessageContextInfo(webMessage.message);

  if (!contextInfo) {
    return;
  }

  const referencedMembers = new Set(
    (contextInfo.mentionedJid || []).map(normalizeUserId).filter(Boolean),
  );

  if (contextInfo.quotedMessage && contextInfo.participant) {
    referencedMembers.add(normalizeUserId(contextInfo.participant));
  }

  if (!referencedMembers.size) {
    return;
  }

  for (const memberId of referencedMembers) {
    // A ausência global (dono) cobre todos os grupos; a por grupo só o grupo
    // onde foi registada.
    const reason = afk.global[memberId] || afk.group[memberId];

    if (reason) {
      // O `@<número>` no texto é o que o WhatsApp transforma na menção; sem ele
      // a lista `mentions` não mostra nada e o aviso fica sem destinatário.
      await commonFunctions.sendReply(
        `Ei! @${memberId.split("@")[0]} encontra-se ausente!\n\nMotivo: ${reason}`,
        [memberId],
      );
    }
  }
}
