/**
 * Painel de administração do bot, renderizado no WhatsApp.
 *
 * Uso:
 *   .painel                 → início (resumo, alertas, saúde)
 *   .painel sistema         → RAM, CPU, disco, uptime
 *   .painel graficos        → RAM 24h, top comandos, atividade por hora
 *   .painel whitelist       → lista e gestão da whitelist privada
 *   .painel blacklist       → lista de banidos (e como banir/desbanir)
 *   .painel backup          → estado do backup e agendamento
 *   .painel logs            → últimas ações, erros e acessos negados
 *   .painel usuarios        → quem usa o bot, quantas vezes
 *   .painel banco           → ficheiros do banco de dados e integridade
 *   .painel config          → prefixos, bot on/off, tokens
 *
 * Todas as abas são também comandos de dono próprios (`.painel-sistema`, ...),
 * para funcionarem por atalho e para o menu poder apontar para elas.
 *
 * @author Dev Yanik
 */
import { BOT_NAME, PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import {
  activityByHour,
  newUsersByDay,
  recentEvents,
  topCommands,
  topUsers,
} from "../../services/activity.js";
import { listActiveBans } from "../../services/blacklist.js";
import {
  activeAlerts,
  backupStatus,
  databaseStatus,
  formatBytes,
  formatUptime,
  systemSamples,
  systemStatus,
} from "../../services/dashboard.js";
import {
  getPrivateWhitelist,
  isBotEnabled,
  listApiKeys,
} from "../../utils/database.js";
import { barra, barraDeEstado, sendPanel, sparkline } from "../../utils/dashboardMenu.js";
import { panelMessage } from "../../utils/formatMessage.js";

const ABAS = {
  home: "inicio",
  sistema: "sistema",
  graficos: "graficos",
  whitelist: "whitelist",
  blacklist: "blacklist",
  backup: "backup",
  logs: "logs",
  usuarios: "usuarios",
  banco: "banco",
  config: "config",
  inicio: "inicio",
};

function horaCurta(iso) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(data.getUTCDate())}/${pad(data.getUTCMonth() + 1)} ${pad(data.getUTCHours())}:${pad(data.getUTCMinutes())}`;
}

/** Distância legível até um instante futuro. */
function tempoRestante(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "expirado";

  const horas = Math.floor(ms / 3600000);
  if (horas >= 24) return `${Math.floor(horas / 24)}d ${horas % 24}h`;
  if (horas >= 1) return `${horas}h ${Math.floor((ms % 3600000) / 60000)}min`;
  return `${Math.max(1, Math.floor(ms / 60000))}min`;
}

function abaInicio() {
  const status = systemStatus();
  const alertas = activeAlerts(status);
  const banco = databaseStatus();
  const backup = backupStatus();
  const bans = listActiveBans();

  const saude = [];
  if (typeof status.ramPct === "number") saude.push(`🧠 RAM ${status.ramPct}%`);
  if (typeof status.cpuPct === "number") saude.push(`🔥 CPU ${status.cpuPct}%`);
  if (typeof status.discoPct === "number") saude.push(`💾 Disco ${status.discoPct}%`);

  return panelMessage({
    icone: "🏠",
    titulo: "Início",
    campos: [
      barraDeEstado({ ramPct: status.ramPct, cpuPct: status.cpuPct }),
      "",
      `🤖 *${BOT_NAME}* v${status.versao}`,
      `🟢 Estado: ${status.status}`,
      `⏱️ Ligado há: ${status.uptimeTexto}`,
      `🧩 Node ${status.node}`,
      `🖥️ ${status.plataforma}`,
      `🔢 Núcleos: ${status.nucleos}`,
      "",
      "📈 *Saúde*",
      ...(saude.length ? saude : ["sem métricas disponíveis"]),
      "",
      "📊 *Resumo*",
      `👥 Usuários registados: ${topUsers(999).length}`,
      `🚫 Banidos: ${bans.length}`,
      `🗄️ Banco: ${banco.totalRegistos} registos (${formatBytes(banco.totalBytes)})`,
      `☁️ Backup: ${backup.ultimo ? `${backup.ok ? "✅" : "⚠️"} ${horaCurta(backup.ultimo)}` : "nunca"}`,
      "",
      alertas.length
        ? `⚠️ *${alertas.length} alerta(s)*\n${alertas.map((a) => `${a.icone} ${a.texto} → ${a.acao}`).join("\n")}`
        : "✅ Sem alertas ativos",
    ],
  });
}

function abaSistema() {
  const status = systemStatus();
  const samples = systemSamples();
  const ramSerie = samples.map((s) => s.ramPct).slice(-40);

  return panelMessage({
    icone: "🖥️",
    titulo: "Sistema",
    campos: [
      barraDeEstado({ ramPct: status.ramPct, cpuPct: status.cpuPct }),
      "",
      `🧠 *RAM:* ${status.ramPct}% de ${formatBytes(status.ramTotalBytes)}`,
      `   processo: ${formatBytes(status.ramProcessoBytes)}`,
      typeof status.cpuPct === "number"
        ? `🔥 *CPU:* ${status.cpuPct}% em ${status.nucleos} núcleo(s)`
        : "🔥 *CPU:* a medir (primeira leitura)",
      typeof status.discoPct === "number"
        ? `💾 *Disco:* ${status.discoPct}%`
        : "💾 *Disco:* não disponível neste host",
      `⏱️ *Uptime:* ${status.uptimeTexto}`,
      `🧩 *Node:* ${status.node}`,
      `🖥️ *SO:* ${status.plataforma}`,
      "",
      "📉 *RAM nas últimas 24h*",
      ramSerie.length ? sparkline(ramSerie) : "sem amostras ainda",
      "",
      "Os limites de alerta são RAM 80%, CPU 75% e disco 85%.",
    ],
  });
}

function abaGraficos() {
  const samples = systemSamples();
  const ramSerie = samples.map((s) => s.ramPct);
  const cpuSerie = samples.map((s) => s.cpuPct);
  const comandos = topCommands(10);
  const maxComando = comandos[0]?.count || 0;
  const horas = activityByHour();
  const maxHora = Math.max(1, ...horas.map((h) => h.count));
  const novos = newUsersByDay(7);

  const campos = [
    "📊 *Gráficos do painel*",
    "",
    "🧠 *RAM (24h)*",
    ramSerie.length ? sparkline(ramSerie) : "sem amostras ainda",
    "",
    "🔥 *CPU (24h)*",
    cpuSerie.some((v) => typeof v === "number")
      ? sparkline(cpuSerie)
      : "sem amostras ainda",
    "",
    "🏆 *Top 10 comandos*",
    ...(comandos.length
      ? comandos.map(
          (c, i) =>
            `${String(i + 1).padStart(2, "0")}. ${barra(c.count, maxComando, 8)} ${c.nome} (${c.count})`,
        )
      : ["ainda sem comandos registados"]),
    "",
    "🕐 *Atividade por hora*",
    ...horas
      .filter((h) => h.count > 0)
      .map((h) => `${String(h.hora).padStart(2, "0")}h ${barra(h.count, maxHora, 10)} ${h.count}`),
    ...(horas.some((h) => h.count > 0) ? [] : ["ainda sem atividade registada"]),
    "",
    "🆕 *Usuários novos (7 dias)*",
    ...novos.map((d) => `${d.dia.slice(5)} ${barra(d.count, Math.max(1, ...novos.map((n) => n.count)), 8)} ${d.count}`),
  ];

  return panelMessage({ icone: "📊", titulo: "Gráficos", campos });
}

function abaWhitelist() {
  const lista = getPrivateWhitelist();

  return panelMessage({
    icone: "✅",
    titulo: "Whitelist privada",
    campos: [
      `👥 Autorizados: ${lista.length}`,
      "",
      ...(lista.length ? lista.map((jid, i) => `${i + 1}. ${jid}`) : ["A lista está vazia."]),
      "",
      "Gestão:",
      `${PREFIX}private-whitelist add <lid>`,
      `${PREFIX}private-whitelist remove <lid>`,
      `${PREFIX}private-whitelist list`,
    ],
  });
}

function abaBlacklist() {
  const bans = listActiveBans();

  return panelMessage({
    icone: "🚫",
    titulo: "Blacklist",
    campos: [
      `🚫 Banidos: ${bans.length}`,
      "",
      ...(bans.length
        ? bans.slice(0, 15).flatMap((ban, i) => [
            `*${i + 1}. ${ban.key}*`,
            `   ├ 🕒 ${horaCurta(ban.bannedAt)}`,
            `   ├ 📋 ${ban.motivo}`,
            `   └ ⏳ ${ban.permanent ? "permanente" : `expira em ${tempoRestante(ban.expiresAt)}`}`,
          ])
        : ["Ninguém está banido."]),
      ...(bans.length > 15 ? ["", `… e mais ${bans.length - 15}.`] : []),
      "",
      "Gestão:",
      `${PREFIX}banir <lid> [1h|1d|7d|30d] [motivo]`,
      `${PREFIX}desbanir <lid>`,
    ],
  });
}

function abaBackup() {
  const backup = backupStatus();

  return panelMessage({
    icone: "☁️",
    titulo: "Backup",
    campos: [
      `📅 Último: ${backup.ultimo ? horaCurta(backup.ultimo) : "nunca"}`,
      `📌 Resultado: ${backup.ultimo ? (backup.ok ? "✅ sucesso" : `⚠️ falhou — ${backup.erro}`) : "—"}`,
      `🎯 Destino: ${backup.destino || "não configurado"}`,
      `📦 Arquivos locais: ${backup.arquivosLocais}`,
      "",
      "⏰ O backup automático corre a cada 2 horas e nunca inclui a sessão do WhatsApp.",
      "",
      "Ações:",
      `${PREFIX}backup — cria agora (sem sessão)`,
      `${PREFIX}backup sessao — inclui a sessão do WhatsApp`,
      `${PREFIX}delete-backup — apaga os backups locais`,
      `${PREFIX}restore — restaura a partir do GitHub`,
    ],
  });
}

function abaLogs() {
  const status = systemStatus();
  const eventos = recentEvents(15);
  const banco = databaseStatus();

  return panelMessage({
    icone: "📜",
    titulo: "Logs e atividades",
    campos: [
      `📄 Eventos guardados: ${recentEvents(999).length}`,
      "",
      "🕒 *Últimas ações*",
      ...(eventos.length
        ? eventos.map((e) => {
            const quem = e.usuario ? ` @${String(e.usuario).split("@")[0]}` : "";
            const marca = e.resultado === "sucesso" ? "✅" : "⚠️";
            return `${marca} ${horaCurta(e.at)} [${e.tipo}]${quem} ${e.acao}`;
          })
        : ["ainda sem eventos registados"]),
      "",
      "🗄️ *Integridade do banco*",
      banco.ilegiveis.length
        ? `⚠️ Ficheiros ilegíveis: ${banco.ilegiveis.join(", ")}`
        : "✅ Todos os ficheiros legíveis",
      `📁 Ficheiros: ${banco.ficheiros.length}`,
      "",
      `Logs técnicos completos: assets/temp/wa-logs.txt`,
      `Uptime do processo: ${formatUptime(status.uptimeSegundos)}`,
    ],
  });
}

function abaUsuarios() {
  const usuarios = topUsers(15);

  return panelMessage({
    icone: "👥",
    titulo: "Usuários",
    campos: [
      `👥 Registados: ${topUsers(999).length}`,
      "",
      ...(usuarios.length
        ? usuarios.flatMap((u, i) => [
            `*${i + 1}. ${u.name || String(u.jid).split("@")[0]}*`,
            `   ├ 🆔 ${u.jid}`,
            `   ├ 📨 ${u.count} comando(s)`,
            `   └ 🕒 última: ${horaCurta(u.lastAt)}`,
          ])
        : ["ainda sem atividade registada"]),
      "",
      "O registo começa quando o bot é instalado: não é a data de criação da conta no WhatsApp.",
    ],
  });
}

function abaBanco() {
  const banco = databaseStatus();
  const maiores = banco.ficheiros.slice(0, 12);
  const max = maiores[0]?.bytes || 1;

  return panelMessage({
    icone: "🗄️",
    titulo: "Banco de dados",
    campos: [
      `📦 Tamanho total: ${formatBytes(banco.totalBytes)}`,
      `🔢 Registos: ${banco.totalRegistos}`,
      `📁 Ficheiros: ${banco.ficheiros.length}`,
      `🔎 Integridade: ${banco.ilegiveis.length ? `⚠️ ${banco.ilegiveis.length} ilegível(is)` : "✅ OK"}`,
      "",
      "*Maiores ficheiros*",
      ...maiores.map((f) => `${barra(f.bytes, max, 8)} ${f.nome} (${formatBytes(f.bytes)}, ${f.registos})`),
      "",
      "Ações:",
      `${PREFIX}painel-limpar-cache — repõe o registo de atividade`,
      `${PREFIX}backup — faz uma cópia do banco de dados`,
    ],
  });
}

function abaConfig() {
  return panelMessage({
    icone: "⚙️",
    titulo: "Configurações",
    campos: [
      `⚡ Prefixo padrão: ${PREFIX}`,
      `🤖 Bot global: ${isBotEnabled() ? "✅ ativado" : "⛔ desativado"}`,
      `✅ Whitelist privada: ${getPrivateWhitelist().length} autorizado(s)`,
      "",
      `🔐 *Chaves de API:* ${listApiKeys().filter((c) => c.configured).length}/${listApiKeys().length} configuradas`,
      ...listApiKeys().map(
        (c) =>
          `${c.configured ? "✅" : "❌"} ${c.label}${
            c.origin === "whatsapp" ? " (WhatsApp)" : c.origin === "ambiente" ? " (ambiente)" : ""
          }`,
      ),
      "",
      "Comandos:",
      `${PREFIX}set-prefix <caractere> — prefixo deste grupo`,
      `${PREFIX}bot-on | ${PREFIX}bot-off — liga/desliga o bot`,
      `${PREFIX}api-keys — ver e configurar todas as chaves`,
      `${PREFIX}private-whitelist add <lid>`,
    ],
  });
}

const RENDERIZADORES = {
  inicio: abaInicio,
  sistema: abaSistema,
  graficos: abaGraficos,
  whitelist: abaWhitelist,
  blacklist: abaBlacklist,
  backup: abaBackup,
  logs: abaLogs,
  usuarios: abaUsuarios,
  banco: abaBanco,
  config: abaConfig,
};

/**
 * Renderiza uma aba. Exportado para as abas-comando reutilizarem o mesmo
 * código, em vez de repetirem o corpo do painel.
 *
 * @param {string} nome
 * @returns {string}
 */
export function renderPanelTab(nome) {
  const chave = ABAS[String(nome || "").toLowerCase()];
  const renderizar = RENDERIZADORES[chave] || RENDERIZADORES.inicio;
  return renderizar();
}

export default {
  name: "painel",
  description: "Painel de administração do bot (somente dono)",
  commands: ["painel", "panel", "dashboard"],
  usage: `${PREFIX}painel [aba]`,
  handle: async ({ args, socket, remoteJid, userLid, sendReply, textOnly }) => {
    const aba = String(args[0] || "").toLowerCase();

    if (aba && !ABAS[aba]) {
      throw new InvalidParameterError(
        `Aba desconhecida. Usa: ${Object.keys(ABAS).slice(0, 10).join(", ")}`,
      );
    }

    await sendPanel({
      socket,
      chatId: remoteJid,
      ownerId: userLid || remoteJid,
      sendReply,
      corpo: renderPanelTab(aba || "inicio"),
      textOnly,
    });
  },
};
