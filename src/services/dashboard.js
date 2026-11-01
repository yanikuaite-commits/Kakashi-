/**
 * Métricas do painel de administração (`.painel`).
 *
 * Junta num só sítio tudo o que o painel mostra sobre o bot:
 *
 * - sistema: RAM, CPU, disco, uptime, versão, processos;
 * - banco de dados: nº de registos e tamanho por ficheiro, integridade;
 * - backup: último resultado, destino e estado do agendador;
 * - gráficos: RAM das últimas 24h, top de comandos, atividade por hora,
 *   usuários novos nos últimos 7 dias.
 *
 * A leitura de RAM/CPU é feita com o módulo `os` do Node, sem dependências
 * externas: o painel tem de funcionar em qualquer host onde o bot corra,
 * incluindo containers sem `/proc` completo. Quando um dado não está
 * disponível, o campo vem `null` e o painel mostra "n/d" — nunca um número
 * inventado.
 *
 * @author Dev Yanik
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATABASE_DIR } from "../config.js";
import {
  readBackupState,
  readSystemSamples,
  saveSystemSamples,
} from "../utils/database.js";
import { errorLog } from "../utils/logger.js";
import {
  activityByHour,
  newUsersByDay,
  recentEvents,
  topCommands,
  topUsers,
} from "./activity.js";
import { listActiveBans } from "./blacklist.js";

const pkg = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

/** Intervalo entre amostras de sistema. */
export const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
/** Janela mostrada nos gráficos. */
export const SAMPLE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Limite de amostras guardadas (24h a cada 5 min = 288). */
export const MAX_SAMPLES = 300;

/**
 * Amostra de CPU desde a leitura anterior.
 *
 * `os.cpus()` devolve tempos ACUMULADOS desde o arranque, não uma percentagem.
 * A percentagem só existe como diferença entre duas leituras, por isso guardamos
 * a anterior no módulo. A primeira chamada não tem com que comparar e devolve
 * `null` — melhor "n/d" do que um 0% que pareceria um sistema ocioso.
 */
let ultimaCpu = null;

function cpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    for (const tipo of Object.keys(cpu.times)) {
      total += cpu.times[tipo];
    }
    idle += cpu.times.idle;
  }

  return { idle, total };
}

/**
 * Uso de CPU (%) desde a chamada anterior, ou `null` na primeira.
 *
 * @returns {number|null} 0-100
 */
export function cpuUsagePercent() {
  const atual = cpuSnapshot();

  if (!ultimaCpu) {
    ultimaCpu = atual;
    return null;
  }

  const idleDelta = atual.idle - ultimaCpu.idle;
  const totalDelta = atual.total - ultimaCpu.total;
  ultimaCpu = atual;

  if (totalDelta <= 0) return null;

  const pct = (1 - idleDelta / totalDelta) * 100;
  return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
}

/**
 * Uso de RAM (% do total), arredondado a 1 decimal.
 *
 * @returns {number}
 */
export function ramUsagePercent() {
  const total = os.totalmem();
  if (!total) return 0;

  const usado = total - os.freemem();
  return Math.round((usado / total) * 1000) / 10;
}

/**
 * Uso de disco (%) do volume que guarda os dados.
 *
 * `fs.statfs` é usado quando existe (Node >= 18.15). Um sistema de ficheiros
 * sem `statfs` devolve `null` em vez de rebentar o painel.
 *
 * @returns {number|null}
 */
export function diskUsagePercent(dir = DATABASE_DIR) {
  if (typeof fs.statfsSync !== "function") return null;

  try {
    const stats = fs.statfsSync(dir);
    const total = (stats.blocks || 0) * (stats.bsize || 0);
    if (!total) return null;

    const livre = (stats.bavail || 0) * (stats.bsize || 0);
    return Math.round(((total - livre) / total) * 1000) / 10;
  } catch {
    return null;
  }
}

/** Estado geral do bot: uptime, versão, memória do processo. */
export function systemStatus() {
  const memoria = process.memoryUsage();
  const segundos = Math.floor(process.uptime());

  return {
    status: "online",
    versao: pkg.version,
    node: process.version,
    plataforma: `${os.type()} ${os.release()}`,
    uptimeSegundos: segundos,
    uptimeTexto: formatUptime(segundos),
    ramPct: ramUsagePercent(),
    ramTotalBytes: os.totalmem(),
    ramProcessoBytes: memoria.rss,
    cpuPct: cpuUsagePercent(),
    nucleos: os.cpus().length,
    discoPct: diskUsagePercent(),
    processos: process.env.PROCESSOS || null,
    agora: new Date().toISOString(),
  };
}

/** "3d 4h 12min" — legível sem o utilizador contar segundos. */
export function formatUptime(segundos) {
  const total = Math.max(0, Math.floor(Number(segundos) || 0));
  const dias = Math.floor(total / 86400);
  const horas = Math.floor((total % 86400) / 3600);
  const minutos = Math.floor((total % 3600) / 60);

  if (dias) return `${dias}d ${horas}h ${minutos}min`;
  if (horas) return `${horas}h ${minutos}min`;
  return `${minutos}min`;
}

/** Tamanho legível em bytes. */
export function formatBytes(bytes) {
  const valor = Number(bytes);
  if (!Number.isFinite(valor) || valor < 0) return "n/d";
  if (valor < 1024) return `${valor} B`;

  const unidades = ["KB", "MB", "GB", "TB"];
  let tamanho = valor / 1024;
  let indice = 0;

  while (tamanho >= 1024 && indice < unidades.length - 1) {
    tamanho /= 1024;
    indice += 1;
  }

  return `${tamanho.toFixed(tamanho >= 10 ? 0 : 1)} ${unidades[indice]}`;
}

/**
 * Estado do banco de dados: ficheiros, registos e tamanho total.
 *
 * "Integridade" aqui é o que faz sentido neste projeto: cada JSON tem de ser
 * legível e ter a forma esperada (objeto ou lista). Um ficheiro truncado é
 * reportado — o `readJSON` repara-o sozinho na próxima leitura, mas o dono tem
 * de saber que aconteceu.
 *
 * @returns {{ficheiros: Array, totalBytes: number, totalRegistos: number, ilegiveis: Array<string>}}
 */
export function databaseStatus(dir = DATABASE_DIR) {
  let nomes = [];

  try {
    nomes = fs.readdirSync(dir).filter((nome) => nome.endsWith(".json"));
  } catch {
    return { ficheiros: [], totalBytes: 0, totalRegistos: 0, ilegiveis: [] };
  }

  const ficheiros = [];
  const ilegiveis = [];
  let totalBytes = 0;
  let totalRegistos = 0;

  for (const nome of nomes) {
    const caminho = path.join(dir, nome);
    let bytes = 0;
    let registos = 0;

    try {
      bytes = fs.statSync(caminho).size;
      const conteudo = JSON.parse(fs.readFileSync(caminho, "utf8"));
      registos = Array.isArray(conteudo)
        ? conteudo.length
        : conteudo && typeof conteudo === "object"
          ? Object.keys(conteudo).length
          : 0;
    } catch {
      ilegiveis.push(nome);
    }

    totalBytes += bytes;
    totalRegistos += registos;
    ficheiros.push({ nome, bytes, registos });
  }

  ficheiros.sort((a, b) => b.bytes - a.bytes);

  return { ficheiros, totalBytes, totalRegistos, ilegiveis };
}

/** Estado do backup, do agendador e do destino remoto. */
export function backupStatus() {
  const state = readBackupState();
  const pasta = path.resolve(process.cwd(), "backups");

  let local = [];
  try {
    local = fs.readdirSync(pasta).filter((nome) => nome.endsWith(".tar.gz"));
  } catch {
    // A pasta só existe depois do primeiro backup local.
  }

  return {
    ultimo: state.lastBackupAt || "",
    ok: state.lastBackupOk === true,
    erro: state.lastBackupError || "",
    destino: state.lastDestination || "",
    arquivosLocais: local.length,
  };
}

/**
 * Regista uma amostra de sistema (RAM/CPU/disco) para os gráficos.
 *
 * Podado a `MAX_SAMPLES` e à janela de 24h: o ficheiro alimenta o painel, não é
 * um histórico de longo prazo, e entra no backup a cada 2h.
 */
export function recordSystemSample() {
  const agora = Date.now();
  const amostras = readSystemSamples()
    .filter((amostra) => {
      const at = Date.parse(amostra?.at || "");
      return Number.isFinite(at) && agora - at <= SAMPLE_WINDOW_MS;
    })
    .slice(-MAX_SAMPLES);

  amostras.push({
    at: new Date(agora).toISOString(),
    ramPct: ramUsagePercent(),
    cpuPct: cpuUsagePercent(),
    diskPct: diskUsagePercent(),
  });

  saveSystemSamples(amostras);
}

/**
 * Amostras das últimas 24h, para o gráfico de RAM/CPU.
 *
 * @returns {Array<{at: string, ramPct: number, cpuPct: number|null, diskPct: number|null}>}
 */
export function systemSamples() {
  const agora = Date.now();
  return readSystemSamples().filter((amostra) => {
    const at = Date.parse(amostra?.at || "");
    return Number.isFinite(at) && agora - at <= SAMPLE_WINDOW_MS;
  });
}

/**
 * Alertas ativos, pela ordem em que o dono deve olhar para eles.
 *
 * Os limites são os do pedido original (RAM 80%, CPU 75%, disco 85%) e cada um
 * traz a sugestão de saída, para o alerta ser acionável.
 *
 * @param {object} [status]
 * @returns {Array<{nivel: string, icone: string, texto: string, acao: string}>}
 */
export function activeAlerts(status = systemStatus()) {
  const alertas = [];

  if (status.ramPct >= 80) {
    alertas.push({
      nivel: "critico",
      icone: "🧠",
      texto: `RAM em ${status.ramPct}%`,
      acao: "reinicia o serviço; se voltar a subir, o plano precisa de mais memória",
    });
  }

  if (typeof status.cpuPct === "number" && status.cpuPct >= 75) {
    alertas.push({
      nivel: "aviso",
      icone: "🔥",
      texto: `CPU em ${status.cpuPct}%`,
      acao: "verifica downloads a correr em paralelo",
    });
  }

  if (typeof status.discoPct === "number" && status.discoPct >= 85) {
    alertas.push({
      nivel: "critico",
      icone: "💾",
      texto: `Disco em ${status.discoPct}%`,
      acao: "apaga temporários e backups antigos (`.limpar-backups`)",
    });
  }

  const backup = backupStatus();
  if (backup.ultimo && !backup.ok) {
    alertas.push({
      nivel: "aviso",
      icone: "☁️",
      texto: `Último backup falhou: ${backup.erro || "motivo não registado"}`,
      acao: "confirma o token do GitHub com `.set-github-token`",
    });
  }

  const bans = listActiveBans();
  if (bans.length >= 20) {
    alertas.push({
      nivel: "info",
      icone: "🚫",
      texto: `${bans.length} usuários banidos`,
      acao: "revê a blacklist; bans antigos podem já não fazer sentido",
    });
  }

  return alertas;
}

/**
 * Amostras de sistema para os gráficos do painel.
 *
 * Separado do `startBackupScheduler` de propósito: o backup fala com o GitHub e
 * pode falhar por rede; as amostras são só leitura local. Um erro num não pode
 * calar o outro.
 *
 * @returns {NodeJS.Timeout}
 */
export function startSystemSampler() {
  // Primeira amostra imediata: sem ela o gráfico ficaria vazio nos primeiros
  // 5 minutos depois de um deploy, que é exatamente quando o dono o abre.
  recordSystemSample();

  const timer = setInterval(() => {
    try {
      recordSystemSample();
    } catch (error) {
      errorLog(`[painel] falha ao registar amostra de sistema: ${error.message}`);
    }
  }, SAMPLE_INTERVAL_MS);

  timer.unref?.();

  return timer;
}

/**
 * Instantâneo completo para o painel.
 *
 * @param {{limiteEventos?: number}} [options]
 */
export function dashboardSnapshot({ limiteEventos = 50 } = {}) {
  const status = systemStatus();

  return {
    status,
    alertas: activeAlerts(status),
    banco: databaseStatus(),
    backup: backupStatus(),
    bans: listActiveBans(),
    topComandos: topCommands(10),
    topUsuarios: topUsers(10),
    eventos: recentEvents(limiteEventos),
    amostras: systemSamples(),
    porHora: activityByHour(),
    novosUsuarios: newUsersByDay(7),
  };
}
