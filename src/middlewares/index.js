/**
 * Interceptadores diversos.
 *
 * @author Dev Gui
 */
import { messageHandler } from "./messageHandler.js";
import { onGroupParticipantsUpdate } from "./onGroupParticipantsUpdate.js";
import { onMessagesUpsert } from "./onMesssagesUpsert.js";

export { messageHandler, onGroupParticipantsUpdate, onMessagesUpsert };

import { delay } from "baileys";
import { OWNER_LID, OWNER_PRIVATE_ALL, OWNER_PRIVATE_JIDS } from "../config.js";
import { getPrefix } from "../utils/database.js";

export function verifyPrefix(prefix, groupJid) {
  const groupPrefix = getPrefix(groupJid);
  return groupPrefix === prefix;
}

export function hasTypeAndCommand({ type, command }) {
  return !!type && !!command;
}

export function isLink(text) {
  const cleanText = text.trim();

  if (/^\d+$/.test(cleanText)) {
    return false;
  }

  if (/[.]{2,3}/.test(cleanText)) {
    return false;
  }

  const ipPattern =
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  if (ipPattern.test(cleanText.split("/")[0])) {
    return true;
  }

  const urlPattern =
    /(https?:\/\/)?(www\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}(\/[^\s]*)?/g;

  const matches = cleanText.match(urlPattern);

  if (!matches || matches.length === 0) {
    return false;
  }

  const fileExtensions =
    /\.(txt|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|exe|jpg|jpeg|png|gif|mp4|mp3|avi)$/i;

  return matches.some((match) => {
    const cleanMatch = match.replace(/^https?:\/\//, "").replace(/^www\./, "");

    const matchIndex = cleanText.indexOf(match);

    const beforeMatch = cleanText.substring(0, matchIndex);

    const afterMatch = cleanText.substring(matchIndex + match.length);

    const charBefore = beforeMatch.slice(-1);

    const charAfter = afterMatch.slice(0, 1);

    if (
      charBefore &&
      /[a-zA-Z0-9]/.test(charBefore) &&
      !/[\s\.\,\:\;\!\?\(\)\[\]\{\}]/.test(charBefore)
    ) {
      return false;
    }

    if (
      charAfter &&
      /[a-zA-Z0-9]/.test(charAfter) &&
      !/[\s\.\,\:\;\!\?\(\)\[\]\{\}\/]/.test(charAfter)
    ) {
      return false;
    }

    if (/\s/.test(cleanMatch)) {
      return false;
    }

    if (fileExtensions.test(cleanMatch)) {
      return false;
    }

    const domainPart = cleanMatch.split("/")[0];
    if (domainPart.split(".").length < 2) {
      return false;
    }

    const parts = domainPart.split(".");
    const extension = parts[parts.length - 1];
    if (extension.length < 2) {
      return false;
    }

    try {
      const url = new URL("https://" + cleanMatch);
      return url.hostname.includes(".") && url.hostname.length > 4;
    } catch {
      return false;
    }
  });
}

export async function isAdmin({ remoteJid, userLid, socket }) {
  const { participants, owner } = await socket.groupMetadata(remoteJid);

  const participant = participants.find(
    (participant) => participant.id === userLid
  );

  if (!participant) {
    return userLid === OWNER_LID;
  }

  const isOwner = userLid === owner || participant.admin === "superadmin";

  const isAdmin = participant.admin === "admin";

  return isOwner || isAdmin;
}

export function isBotOwner({ userLid }) {
  return userLid === OWNER_LID;
}

const jidDigits = (jid) => String(jid || "").replace(/\D/g, "");

function isOwnerJid(jid) {
  const digits = jidDigits(jid);

  if (!digits) {
    return false;
  }

  if (jid === OWNER_LID || digits === jidDigits(OWNER_LID)) {
    return true;
  }

  return OWNER_PRIVATE_JIDS.some((entry) => jidDigits(entry) === digits);
}

/**
 * Reconhece o dono na conversa privada.
 *
 * Em grupo a identidade vem de key.participant (que no privado não existe),
 * por isso lá o dono é identificado pelo próprio JID da conversa: o OWNER_LID
 * tanto na forma LID quanto na forma alternativa (número <-> LID) que o
 * Baileys publica em key.remoteJidAlt.
 *
 * @param {WAMessage} webMessage mensagem recebida
 * @returns {boolean} true se a conversa privada é do dono
 */
export function isOwnerInPrivateChat(webMessage) {
  if (!OWNER_PRIVATE_ALL) {
    return false;
  }

  const key = webMessage?.key;

  if (!key) {
    return false;
  }

  // Só faz sentido em conversa privada: em grupo a identidade vem de
  // key.participant (checado por isBotOwner/checkPermission).
  if (key.remoteJid?.endsWith("@g.us")) {
    return false;
  }

  return [key.remoteJid, key.remoteJidAlt, key.participant, key.participantAlt].some(isOwnerJid);
}

export async function checkPermission({ type, socket, userLid, remoteJid }) {
  if (type === "owner" && userLid === OWNER_LID) {
    return true;
  }

  if (type === "member") {
    return true;
  }

  try {
    await delay(500);

    const { participants, owner } = await socket.groupMetadata(remoteJid);

    const participant = participants.find(
      (participant) => participant.id === userLid
    );

    if (!participant) {
      return false;
    }

    const isBotOwner = userLid === OWNER_LID;

    const isOwner = userLid === owner || participant.admin === "superadmin";

    const isAdmin = isOwner || participant.admin === "admin";

    const ownerStillInGroup = participants.some(
      (participant) => participant.id === owner
    );

    const hasSuperAdmin = participants.some(
      (participant) => participant.admin === "superadmin"
    );

    if (type === "admin") {
      return isOwner || isAdmin || isBotOwner;
    }

    if (type === "owner") {
      if (isBotOwner) {
        return true;
      }

      if (isOwner) {
        return true;
      }

      if (!ownerStillInGroup || !hasSuperAdmin) {
        return isAdmin;
      }

      return false;
    }

    return false;
  } catch (error) {
    return false;
  }
}
