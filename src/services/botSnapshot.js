/**
 * Instantâneo do estado do bot para a IA do dono.
 *
 * A IA só consegue responder a "quantos usuários estão na whitelist?" se lhe
 * dermos os números. Este módulo reúne o estado real (lido pelos acessores do
 * `database.js`, nunca com `fs` direto) num bloco de texto compacto que vai como
 * mensagem de sistema.
 *
 * Regra de segurança: NUNCA incluir valores de chaves/segredos. Só nomes e
 * estados (`definida`/`ausente`), porque este bloco acaba dentro do pedido HTTP
 * para a Groq.
 *
 * @author Dev Yanik
 */
import { accountBalance } from "./credits.js";
import { listActiveSubscriptions } from "./subscriptions.js";
import { listActiveBans } from "./blacklist.js";
import { recentEvents, topCommands, topUsers } from "./activity.js";
import { backupStatus, databaseStatus, systemStatus } from "./dashboard.js";
import {
  getBlockedCommands,
  getPrivateWhitelist,
  isBotEnabled,
  listApiKeys,
  listAutoResponderItems,
  readCreditsAccounts,
  readMutedMembers,
  readPendingRecharges,
} from "../utils/database.js";

/** Formata um saldo/valor inteiro sem casas decimais. */
function inteiro(valor) {
  return Math.max(0, Math.round(Number(valor) || 0));
}

/**
 * Números agregados que a IA pode citar com segurança.
 *
 * @returns {object}
 */
export function botCounts() {
  const whitelist = getPrivateWhitelist();
  const bans = listActiveBans();
  const subscriptions = listActiveSubscriptions();
  const credits = readCreditsAccounts() || {};
  const pending = readPendingRecharges() || {};
  const autoResponder = listAutoResponderItems();
  const blocked = getBlockedCommands();
  const apiKeys = listApiKeys();
  const muted = readMutedMembers() || {};

  const contas = Object.values(credits);
  const saldoTotal = contas.reduce(
    (soma, conta) => soma + accountBalance(conta),
    0,
  );

  const silenciados = Object.values(muted).reduce(
    (soma, lista) => soma + (Array.isArray(lista) ? lista.length : 0),
    0,
  );

  return {
    ligado: isBotEnabled(),
    whitelist: whitelist.length,
    banidos: bans.length,
    assinaturas: subscriptions.length,
    contasCredito: contas.length,
    saldoTotal,
    recargasPendentes: Object.keys(pending).length,
    autoRespostas: autoResponder.length,
    comandosBloqueados: blocked.length,
    silenciados,
    chavesConfiguradas: apiKeys.filter((k) => k.configured).length,
    chavesTotais: apiKeys.length,
  };
}

/**
 * Bloco de texto com o estado atual, pronto para ir como mensagem de sistema.
 *
 * Mantém-se compacto de propósito: é enviado em cada pedido do dono.
 *
 * @param {{grupos?: number|null, grupoAtual?: {nome?: string, participantes?: number}|null}} [options]
 *   `grupos` vem do socket (contagem real); sem ele a linha é omitida em vez de
 *   inventada. `grupoAtual` descreve o grupo da conversa, quando é um grupo.
 * @returns {string}
 */
export function botSnapshotText({ grupos = null, grupoAtual = null } = {}) {
  const c = botCounts();
  const status = systemStatus();
  const backup = backupStatus();
  const banco = databaseStatus();
  const top = topCommands(5);
  const usuarios = topUsers(5);
  const eventos = recentEvents(5);

  const linhas = [
    "ESTADO ATUAL DO BOT (dados reais, lidos agora):",
    `- bot: ${c.ligado ? "ligado" : "desligado"}`,
    `- whitelist privada: ${c.whitelist} usuário(s)`,
    `- banidos ativos (blacklist): ${c.banidos}`,
    `- silenciados: ${c.silenciados}`,
    `- assinaturas ativas: ${c.assinaturas}`,
    `- contas de crédito: ${c.contasCredito} (saldo somado: ${inteiro(c.saldoTotal)})`,
    `- recargas pendentes de confirmação: ${c.recargasPendentes}`,
    `- auto-respostas registadas: ${c.autoRespostas}`,
    `- comandos bloqueados: ${c.comandosBloqueados}`,
    `- chaves de API configuradas: ${c.chavesConfiguradas} de ${c.chavesTotais}`,
    `- dados: ${banco.ficheiros.length} ficheiro(s), ${inteiro(banco.totalBytes / 1024)} KB`,
    `- sistema: RAM ${status.ramPct}%, CPU ${status.cpuPct ?? "n/d"}%, disco ${status.discoPct ?? "n/d"}%, uptime ${status.uptimeTexto}`,
    `- versão: ${status.versao} (Node ${status.node})`,
  ];

  if (Number.isFinite(grupos)) {
    linhas.splice(2, 0, `- grupos onde o bot está: ${grupos}`);
  }

  if (grupoAtual) {
    const nome = grupoAtual.nome || "grupo sem nome";
    const membros = Number.isFinite(grupoAtual.participantes)
      ? `, ${grupoAtual.participantes} participante(s)`
      : "";
    linhas.push(`- grupo atual: "${nome}"${membros}`);
  }

  if (backup.ultimo) {
    linhas.push(
      `- último backup: ${backup.ultimo} (${backup.ok ? "ok" : "falhou"})`,
    );
  }

  if (top.length) {
    linhas.push(
      `- comandos mais usados: ${top.map((t) => `${t.nome} (${t.count})`).join(", ")}`,
    );
  }

  if (usuarios.length) {
    linhas.push(
      `- usuários mais ativos: ${usuarios.map((u) => `${u.name || u.jid} (${u.count})`).join(", ")}`,
    );
  }

  if (eventos.length) {
    linhas.push(
      `- eventos recentes: ${eventos
        .map((e) => `${e.tipo}: ${e.acao}`)
        .slice(0, 5)
        .join(" | ")}`,
    );
  }

  return linhas.join("\n");
}

/**
 * Contexto pronto para o `askGroq` do dono, ou `null` fora dele.
 *
 * @param {boolean} isOwner
 * @param {{grupos?: number|null, grupoAtual?: object|null}} [options]
 * @returns {string|null}
 */
export function ownerSnapshotContext(isOwner, { grupos = null, grupoAtual = null } = {}) {
  if (!isOwner) {
    return null;
  }

  try {
    return botSnapshotText({ grupos, grupoAtual });
  } catch (error) {
    // O estado é um extra: se uma leitura falhar, a IA responde sem ele em vez
    // de o comando rebentar.
    return null;
  }
}

/**
 * Igual a `ownerSnapshotContext`, mas busca ao socket a contagem real de grupos
 * e, quando a conversa é um grupo, o nome e o total de participantes.
 *
 * Nunca lança: qualquer falha de rede do socket devolve o instantâneo sem esses
 * extras, para o comando da IA continuar a responder.
 *
 * @param {object} params
 * @param {boolean} params.isOwner
 * @param {import("baileys").WASocket} [params.socket]
 * @param {boolean} [params.isGroup]
 * @param {string} [params.remoteJid]
 * @param {() => Promise<string>} [params.getGroupName]
 * @param {() => Promise<Array>} [params.getGroupParticipants]
 * @returns {Promise<string|null>}
 */
export async function resolveOwnerContext({
  isOwner,
  socket,
  isGroup = false,
  remoteJid = "",
  getGroupName,
  getGroupParticipants,
} = {}) {
  if (!isOwner) {
    return null;
  }

  let grupos = null;
  let grupoAtual = null;

  try {
    if (typeof socket?.groupFetchAllParticipating === "function") {
      const todos = await socket.groupFetchAllParticipating();
      grupos = Object.keys(todos || {}).length;
    }
  } catch {
    grupos = null;
  }

  if (isGroup && remoteJid.endsWith("@g.us")) {
    try {
      const [nome, participantes] = await Promise.all([
        typeof getGroupName === "function" ? getGroupName() : null,
        typeof getGroupParticipants === "function" ? getGroupParticipants() : null,
      ]);

      grupoAtual = {
        nome: nome || "",
        participantes: Array.isArray(participantes) ? participantes.length : null,
      };
    } catch {
      grupoAtual = null;
    }
  }

  return ownerSnapshotContext(isOwner, { grupos, grupoAtual });
}
