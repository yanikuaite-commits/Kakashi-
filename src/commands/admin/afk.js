import { PREFIX } from "../../config.js";
import { DangerError } from "../../errors/index.js";
import {
  removeAfkMember,
  removeGlobalAfkMember,
  setAfkMember,
  setGlobalAfkMember,
} from "../../utils/database.js";
import { broadcastToAllGroups } from "../../utils/afkBroadcast.js";
import { formatMessage } from "../../utils/formatMessage.js";

function ausenciaMessage({ motivo, global, userLid }) {
  const mencao = userLid ? `@${userLid.split("@")[0]} ` : "";

  return formatMessage({
    icone: "🌙",
    titulo: global ? "Ausência global" : "Ausência",
    campos: [
      global
        ? `${mencao}estou ausente e o aviso foi enviado a todos os grupos.`
        : `${mencao}estou ausente neste grupo.`,
      `📝 *Motivo:* ${motivo}`,
      "Quem me marcar recebe este aviso automaticamente.",
      `Para cancelar, use ${PREFIX}afk voltei.`,
    ],
  });
}

export default {
  name: "afk",
  description: "Informa que você está ausente e registra o motivo.",
  commands: ["afk", "ausente"],
  usage: `${PREFIX}afk <motivo>`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    fullArgs,
    isGroup,
    isOwner,
    remoteJid,
    sendSuccessReply,
    socket,
    userLid,
  }) => {
    if (!isGroup) {
      throw new DangerError("Este comando só pode ser usado em grupos.");
    }

    const reason = fullArgs.trim() || "não informado";
    const cancelar = /^(voltei|voltei!|cheguei|cancele|cancelar)$/i.test(reason);

    // O dono avisa todos os grupos; um membro comum avisa só o grupo onde
    // escreveu. Sem esta separação, qualquer membro mandaria uma mensagem a
    // todos os grupos do bot.
    const global = isOwner;

    if (cancelar) {
      // O dono grava nas duas camadas, por isso o cancelamento limpa as duas:
      // remover só a global deixaria o registo do grupo onde ele escreveu.
      const removidoGlobal = global && removeGlobalAfkMember(userLid);
      const removidoGrupo = removeAfkMember(remoteJid, userLid);
      const removido = removidoGlobal || removidoGrupo;

      await sendSuccessReply(
        removido
          ? "✅ Ausência cancelada. Bem-vindo de volta!"
          : "ℹ️ Não tinhas nenhuma ausência registada.",
      );

      return;
    }

    if (global) {
      setGlobalAfkMember(userLid, reason);
    }

    // A ausência do dono vive nas duas camadas: a global cobre os grupos
    // futuros e a por grupo garante o grupo onde ele escreveu, mesmo que a
    // lista de grupos falhe.
    setAfkMember(remoteJid, userLid, reason);

    await sendSuccessReply(ausenciaMessage({ motivo: reason, global, userLid }));

    if (!global) {
      return;
    }

    const enviados = await broadcastToAllGroups({
      socket,
      text: ausenciaMessage({ motivo: reason, global: true, userLid }),
      mentions: userLid ? [userLid] : [],
      skipJid: remoteJid,
    });

    await sendSuccessReply(
      `📢 Aviso enviado a mais ${enviados} grupo(s), além deste.`,
    );
  },
};
