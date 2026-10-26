/**
 * Registo de atividade do bot.
 *
 * Guarda três coisas, todas servidas ao `.painel`:
 *
 * - `commands`: quantas vezes cada comando correu e quando foi a última;
 * - `users`: quem usou o bot, quantas vezes e com que nome;
 * - `events`: as últimas ações relevantes (comandos, bans, backups, acessos
 *   negados) — a auditoria que o painel mostra em "Logs".
 *
 * O registo é limitado de propósito (`MAX_EVENTS`, `MAX_USERS`): este ficheiro
 * entra no backup a cada 2h, por isso não pode crescer sem fim. O que sai da
 * lista é o mais antigo, que é o menos útil num painel.
 *
 * @author Dev Gui
 */
import { readActivity, saveActivity } from "../utils/database.js";

export const MAX_EVENTS = 200;
export const MAX_USERS = 500;
export const MAX_COMMANDS = 200;

function emptyActivity() {
  return { commands: {}, users: {}, events: [] };
}

function read() {
  const activity = readActivity();
  return {
    commands: activity?.commands || {},
    users: activity?.users || {},
    events: Array.isArray(activity?.events) ? activity.events : [],
  };
}

/**
 * Podar um objeto `{ chave: { count, lastAt } }` para as entradas mais usadas.
 *
 * Um objeto de contadores só cresce; sem poda, `commands`/`users` acabariam com
 * uma entrada por comando e por pessoa que já falou com o bot, para sempre.
 */
function prune(map, limit) {
  const entries = Object.entries(map);
  if (entries.length <= limit) return map;

  const mantidas = entries
    .sort(([, a], [, b]) => (b?.count || 0) - (a?.count || 0))
    .slice(0, limit);

  return Object.fromEntries(mantidas);
}

/**
 * Regista a execução de um comando e o usuário que o usou.
 *
 * Chamado no despacho, depois de o comando ser autorizado: um comando recusado
 * (sem saldo, sem permissão) não é atividade real.
 *
 * @param {{comando?: string, usuario?: string, nome?: string, grupo?: string}} options
 */
export function recordCommandUsage({ comando, usuario, nome, grupo } = {}) {
  const activity = read();
  const agora = new Date().toISOString();

  if (comando) {
    const atual = activity.commands[comando] || { count: 0, lastAt: "" };
    activity.commands[comando] = { count: (atual.count || 0) + 1, lastAt: agora };
  }

  if (usuario) {
    const atual = activity.users[usuario] || {
      count: 0,
      lastAt: "",
      firstAt: "",
      name: "",
    };
    activity.users[usuario] = {
      count: (atual.count || 0) + 1,
      lastAt: agora,
      // `firstAt` é o que alimenta o gráfico de "usuários novos": só é escrito
      // na primeira vez que esta pessoa aparece.
      firstAt: atual.firstAt || agora,
      name: nome || atual.name || "",
      grupo: grupo || atual.grupo || "",
    };
  }

  activity.commands = prune(activity.commands, MAX_COMMANDS);
  activity.users = prune(activity.users, MAX_USERS);

  saveActivity(activity);
}

/**
 * Regista um evento na auditoria.
 *
 * @param {{tipo: string, usuario?: string, acao: string, resultado?: string}} event
 */
export function recordEvent({ tipo, usuario = "", acao, resultado = "sucesso" }) {
  const activity = read();

  activity.events.unshift({
    at: new Date().toISOString(),
    tipo: String(tipo || "geral"),
    usuario: String(usuario || ""),
    acao: String(acao || "").slice(0, 200),
    resultado: String(resultado || "sucesso"),
  });

  // `unshift` + `slice` mantém as mais recentes: são as que o painel mostra.
  activity.events = activity.events.slice(0, MAX_EVENTS);

  saveActivity(activity);
}

/** Os comandos mais usados, do maior para o menor. */
export function topCommands(limit = 10) {
  return Object.entries(read().commands)
    .map(([nome, dados]) => ({
      nome,
      count: dados?.count || 0,
      lastAt: dados?.lastAt || "",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Os usuários mais ativos, do maior para o menor. */
export function topUsers(limit = 10) {
  return Object.entries(read().users)
    .map(([jid, dados]) => ({
      jid,
      count: dados?.count || 0,
      lastAt: dados?.lastAt || "",
      name: dados?.name || "",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

const ultimoEvento = new Map();

/**
 * Igual a `recordEvent`, mas com um limiar por chave.
 *
 * O caminho de "usuário banido enviou mensagem" corre em TODA mensagem dessa
 * pessoa. Sem limiar, cada mensagem reescrevia o `activity.json` inteiro — uma
 * amplificação de I/O causada por quem está justamente a ser bloqueado. O
 * registo continua a existir, só que no máximo uma vez por janela.
 *
 * @param {{chave: string, janelaMs?: number, tipo: string, usuario?: string, acao: string, resultado?: string}} event
 * @returns {boolean} true se o evento foi registado
 */
export function recordEventThrottled({
  chave,
  janelaMs = 5 * 60 * 1000,
  tipo,
  usuario = "",
  acao,
  resultado = "sucesso",
}) {
  const agora = Date.now();
  const anterior = ultimoEvento.get(chave) || 0;

  if (agora - anterior < janelaMs) return false;

  ultimoEvento.set(chave, agora);
  recordEvent({ tipo, usuario, acao, resultado });

  return true;
}

/** Os eventos mais recentes (já vêm do mais novo para o mais antigo). */
export function recentEvents(limit = 50, { tipo } = {}) {
  const eventos = read().events;
  const filtrados = tipo ? eventos.filter((evento) => evento.tipo === tipo) : eventos;
  return filtrados.slice(0, limit);
}

/**
 * Contagem de uso por hora do dia (0-23), para o gráfico de atividade.
 *
 * Lê os eventos, que trazem o horário exato; os contadores por comando só
 * guardam a última vez e não serviriam para uma série temporal.
 *
 * @returns {Array<{hora: number, count: number}>} 24 posições, sempre completas
 */
export function activityByHour() {
  const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, count: 0 }));

  for (const evento of read().events) {
    const hora = new Date(evento.at).getHours();
    if (Number.isInteger(hora) && hora >= 0 && hora < 24) {
      porHora[hora].count += 1;
    }
  }

  return porHora;
}

/**
 * Usuários novos por dia nos últimos `dias` dias.
 *
 * "Novo" é o primeiro evento registado para aquele usuário: o registo de
 * atividade começa quando o bot é instalado, não quando a pessoa entra no
 * WhatsApp, e isso fica explícito no painel.
 *
 * @param {number} [dias]
 * @returns {Array<{dia: string, count: number}>}
 */
export function newUsersByDay(dias = 7) {
  const agora = new Date();
  const diasLista = [];

  for (let i = dias - 1; i >= 0; i--) {
    const data = new Date(agora);
    data.setDate(agora.getDate() - i);
    diasLista.push(data.toISOString().slice(0, 10));
  }

  const porDia = Object.fromEntries(diasLista.map((dia) => [dia, 0]));

  for (const dados of Object.values(read().users)) {
    const dia = String(dados?.firstAt || dados?.lastAt || "").slice(0, 10);
    if (dia in porDia) porDia[dia] += 1;
  }

  return diasLista.map((dia) => ({ dia, count: porDia[dia] }));
}

/** Limpa todo o registo de atividade (ação do painel). */
export function resetActivity() {
  ultimoEvento.clear();
  saveActivity(emptyActivity());
}
