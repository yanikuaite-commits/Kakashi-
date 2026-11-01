/**
 * Menu e visuais do painel de administração (`.painel`).
 *
 * O painel é uma interface no WhatsApp, não uma página web: não há como servir
 * HTML de dentro do bot sem expor um servidor novo e um segundo caminho de
 * autenticação. As "abas" são uma lista nativeFlow (com fallback numerado) e
 * cada aba é um comando de dono — a mesma permissão que já protege `.backup` e
 * `.recarregar` protege o painel, sem inventar login nem token de sessão.
 *
 * Os visuais imitam a tela de um celular (barra de estado, bateria, abas) e os
 * gráficos são desenhados em texto (blocos ▁▂▃), porque o WhatsApp só renderiza
 * texto: uma imagem obrigaria a subir um renderizador e a esperar pelo envio de
 * mídia a cada consulta.
 *
 * @author Dev Yanik
 */
import { BOT_NAME, PREFIX } from "../config.js";
import {
  createInteractiveActionId,
  numberedFallback,
  sendInteractiveWithFallback,
  singleSelectList,
} from "./interactive.js";
import { errorLog } from "./logger.js";

/** Abas do painel. `target` é o comando que a aba executa. */
export const PANEL_TABS = [
  {
    id: "home",
    icone: "🏠",
    titulo: "Início",
    descricao: "Resumo geral, alertas e saúde do bot",
    target: `${PREFIX}painel`,
  },
  {
    id: "sistema",
    icone: "🖥️",
    titulo: "Sistema",
    descricao: "RAM, CPU, disco, uptime e processos",
    target: `${PREFIX}painel-sistema`,
  },
  {
    id: "graficos",
    icone: "📊",
    titulo: "Gráficos",
    descricao: "RAM 24h, top comandos, atividade por hora",
    target: `${PREFIX}painel-graficos`,
  },
  {
    id: "whitelist",
    icone: "✅",
    titulo: "Whitelist",
    descricao: "Quem pode usar o bot no privado",
    target: `${PREFIX}painel-whitelist`,
  },
  {
    id: "blacklist",
    icone: "🚫",
    titulo: "Blacklist",
    descricao: "Usuários banidos e duração do ban",
    target: `${PREFIX}painel-blacklist`,
  },
  {
    id: "backup",
    icone: "☁️",
    titulo: "Backup",
    descricao: "Último backup, agendamento e arquivos",
    target: `${PREFIX}painel-backup`,
  },
  {
    id: "logs",
    icone: "📜",
    titulo: "Logs",
    descricao: "Últimas ações, erros e acessos negados",
    target: `${PREFIX}painel-logs`,
  },
  {
    id: "usuarios",
    icone: "👥",
    titulo: "Usuários",
    descricao: "Quem usa o bot, quantas vezes e quando",
    target: `${PREFIX}painel-usuarios`,
  },
  {
    id: "banco",
    icone: "🗄️",
    titulo: "Banco de dados",
    descricao: "Ficheiros, tamanho e integridade",
    target: `${PREFIX}painel-banco`,
  },
  {
    id: "config",
    icone: "⚙️",
    titulo: "Configurações",
    descricao: "Prefixos, bot on/off e tokens",
    target: `${PREFIX}painel-config`,
  },
];

/** Blocos do gráfico em texto, do menor para o maior. */
const BLOCOS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Desenha uma série de números como gráfico de blocos.
 *
 * Sem escala fixa: o eixo vai do mínimo ao máximo da própria série, senão uma
 * série estável (RAM entre 40% e 45%) apareceria sempre em branco.
 *
 * @param {Array<number|null>} valores
 * @returns {string} ex.: "▃▄▅▆▇█▇▆"
 */
export function sparkline(valores = []) {
  const numeros = valores.filter((valor) => typeof valor === "number");
  if (!numeros.length) return "";

  const minimo = Math.min(...numeros);
  const maximo = Math.max(...numeros);
  const amplitude = maximo - minimo;

  return valores
    .map((valor) => {
      if (typeof valor !== "number") return "·";
      if (amplitude === 0) return BLOCOS[3];
      const indice = Math.round(((valor - minimo) / amplitude) * (BLOCOS.length - 1));
      return BLOCOS[Math.min(BLOCOS.length - 1, Math.max(0, indice))];
    })
    .join("");
}

/**
 * Barra proporcional para o maior valor da lista.
 *
 * @param {number} valor
 * @param {number} maximo
 * @param {number} [largura]
 * @returns {string}
 */
export function barra(valor, maximo, largura = 10) {
  const total = Number(maximo) || 0;
  if (total <= 0) return "░".repeat(largura);

  const cheios = Math.round((Number(valor) / total) * largura);
  const n = Math.min(largura, Math.max(0, cheios));

  return "█".repeat(n) + "░".repeat(largura - n);
}

/** Ícone da bateria conforme a percentagem. */
function iconeBateria(pct) {
  if (typeof pct !== "number") return "🔋";
  if (pct >= 80) return "🔋";
  if (pct >= 50) return "🔋";
  if (pct >= 20) return "🪫";
  return "🪫";
}

/**
 * Barra de estado no topo, como a de um celular.
 *
 * A bateria mostra a RAM livre do host e o "sinal" mostra o uso de CPU: é o
 * equivalente útil destes dois indicadores num bot, em vez de decoração.
 *
 * @param {{ramPct?: number|null, cpuPct?: number|null, agora?: Date}} [options]
 */
export function barraDeEstado({ ramPct = null, cpuPct = null, agora = new Date() } = {}) {
  const hora = agora.toTimeString().slice(0, 5);

  const bateria =
    typeof ramPct === "number"
      ? `${iconeBateria(100 - ramPct)} ${(100 - ramPct).toFixed(0)}%`
      : `${iconeBateria(null)} n/d`;

  const sinal =
    typeof cpuPct === "number"
      ? cpuPct >= 75
        ? "📶 ▁▁▁"
        : cpuPct >= 40
          ? "📶 ▂▄▁"
          : "📶 ▂▄▆"
      : "📶 ▂▄▆";

  return `🕒 ${hora}   ${sinal}   ${bateria}`;
}

/**
 * Monta a lista de abas com IDs de resposta novos.
 *
 * @returns {{content: object, responseMappings: Array, fallbackText: string, fallbackActions: Array}}
 */
export function buildPanelMenu({ texto, titulo = "Painel", rodape } = {}) {
  const responseMappings = [];
  const fallbackActions = [];
  const rows = [];

  PANEL_TABS.forEach((tab, indice) => {
    const id = createInteractiveActionId();
    responseMappings.push({ id, target: tab.target });
    fallbackActions.push({ number: String(indice + 1), id: tab.target });
    rows.push({
      title: `${tab.icone} ${tab.titulo}`,
      description: tab.descricao,
      rowId: id,
    });
  });

  const content = singleSelectList({
    text: texto || `🎛️ *${BOT_NAME}* — Painel de administração`,
    title: titulo,
    footer: rodape ?? `© ${BOT_NAME}`,
    buttonText: "Abrir aba",
    sections: [{ title: "Abas do painel", rows }],
  });

  return {
    content,
    responseMappings,
    fallbackActions,
    fallbackText: numberedFallback(
      PANEL_TABS.map((tab, indice) => ({
        number: String(indice + 1),
        title: `${tab.icone} ${tab.titulo}`,
      })),
      "Responde com o número da aba 👇",
    ),
  };
}

/**
 * Envia o painel (uma aba) com o menu de navegação anexado.
 *
 * @param {{socket: object, chatId: string, ownerId: string, sendReply: Function, corpo: string, textOnly?: boolean, titulo?: string}} options
 * @returns {Promise<boolean>}
 */
export async function sendPanel({
  socket,
  chatId,
  ownerId,
  sendReply,
  corpo,
  textOnly = false,
  titulo = "Painel",
}) {
  const menu = buildPanelMenu({ texto: corpo, titulo });

  return Boolean(
    await sendInteractiveWithFallback({
      socket,
      chatId,
      content: menu.content,
      fallbackText: `${corpo}\n\n${menu.fallbackText}`,
      sendReply,
      ownerId,
      responseMappings: menu.responseMappings,
      fallbackActions: menu.fallbackActions,
      textOnly: Boolean(textOnly),
      onSendError: (error) =>
        errorLog(`Erro ao enviar o painel: ${error.message}`),
    }),
  );
}
