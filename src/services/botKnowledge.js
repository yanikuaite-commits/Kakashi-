/**
 * Conhecimento do bot para a IA do chat.
 *
 * Sem isto a IA respondia "não sei" (ou pior, inventava) a perguntas como "como
 * recarregar?" ou "que comando baixa do TikTok?". Aqui construímos um guia com
 * os comandos REAIS (lidos do mesmo loader que o despacho usa) e o fluxo de
 * pagamento/recarga real (lido de `tabelaPrecos.js` e do `config.js`).
 *
 * A construção é cacheada: o catálogo de comandos não muda durante a execução e
 * não vale a pena reimportar ~175 ficheiros a cada pergunta.
 *
 * @author Dev Yanik
 */
import {
  BOT_NAME,
  DAILY_FREE_CREDITS,
  PAYMENT_E_MOLA_NAME,
  PAYMENT_E_MOLA_NUMBER,
  PAYMENT_M_PESA_NAME,
  PAYMENT_M_PESA_NUMBER,
  PREFIX,
} from "../config.js";
import { readCommandImports } from "../utils/index.js";
import { TABELAS } from "../utils/tabelaPrecos.js";

/** Tipos de comando que valem a pena anunciar à IA (owner/dev ficam de fora). */
const TIPOS_PUBLICOS = ["member", "admin"];

/** Comandos de dono que descrevem um fluxo público (entram mesmo sendo `owner`). */
const COMANDOS_PUBLICOS_EXTRA = ["recargas-pendentes"];

/**
 * Amostras de desenvolvedor: vivem na pasta `member`, mas servem para quem
 * escreve comandos (a categoria `dev` do menu é restrita ao dono). Anunciá-las a
 * um membro comum seria ruído e prometeria funções que ele não tem.
 */
const EXEMPLOS_DEV = /^(enviar-|exemplo|exemplos-|funcoes-|obter-|raw-message)/;

/** Uma linha por comando, "nome: descrição". */
function linhaDoComando(comando) {
  const nome = comando.commands[0];
  const descricao = String(comando.description || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

  return descricao ? `${nome}: ${descricao}` : nome;
}

/**
 * Catálogo de comandos, agrupado por tipo, com o nome canónico de cada um.
 *
 * @returns {Promise<string>} bloco de texto
 */
export async function commandCatalogText() {
  const imports = await readCommandImports();
  const blocos = [];

  for (const tipo of TIPOS_PUBLICOS) {
    const linhas = (imports[tipo] || [])
      .filter((comando) => comando?.commands?.length)
      .filter((comando) => !EXEMPLOS_DEV.test(comando.commands[0]))
      .map(linhaDoComando);

    if (linhas.length) {
      blocos.push(`[${tipo}]\n${linhas.join("\n")}`);
    }
  }

  const extras = (imports.owner || [])
    .filter((comando) => COMANDOS_PUBLICOS_EXTRA.includes(comando?.name))
    .map(linhaDoComando);

  if (extras.length) {
    blocos.push(`[dono]\n${extras.join("\n")}`);
  }

  return blocos.join("\n\n");
}

/** Tabela de preços formatada como linhas simples. */
function tabelaTexto(tabela) {
  return tabela.linhas.map((linha) => linha.join(" → ")).join("\n");
}

/** Fluxo de pagamento e recarga, com os valores reais. */
export function paymentGuideText() {
  return [
    "COMO RECARREGAR (pagamento):",
    `1. Abra o painel de pagamento com ${PREFIX}pagamento (mostra os números).`,
    `   - e-mola: ${PAYMENT_E_MOLA_NUMBER} (${PAYMENT_E_MOLA_NAME})`,
    `   - m-pesa: ${PAYMENT_M_PESA_NUMBER} (${PAYMENT_M_PESA_NAME})`,
    "2. Faz a transferência do valor do pacote ou plano.",
    "3. Reencaminha o SMS do comprovativo para o chat do bot.",
    "4. O dono confirma o pagamento e os créditos entram na conta.",
    "",
    `PACOTES DE CRÉDITOS (${PREFIX}tabela-creditos):`,
    tabelaTexto(TABELAS.creditos),
    "",
    `PLANOS POR DIAS (${PREFIX}tabela-dias): paga uma vez e recebe créditos extra TODOS os dias até acabar.`,
    tabelaTexto(TABELAS.dias),
    "",
    `Cada usuário recebe ${DAILY_FREE_CREDITS} créditos grátis por dia.`,
    `Saldo e plano: ${PREFIX}conta. Sem créditos? Recarregue ou espere pelo reset diário.`,
  ].join("\n");
}

/**
 * Bloco completo de conhecimento (catálogo + pagamento), em cache.
 *
 * A cache guarda a PROMESSA, não o resultado: duas perguntas simultâneas no
 * arranque não podem importar os ~175 ficheiros de comando duas vezes.
 *
 * @returns {Promise<string>}
 */
export function botKnowledgeText() {
  if (!cache) {
    cache = construirConhecimento().catch((error) => {
      // A cache não guarda uma falha: a próxima pergunta tenta de novo.
      cache = null;
      throw error;
    });
  }

  return cache;
}

async function construirConhecimento() {
  const catalogo = await commandCatalogText();

  return [
    `SOBRE O ${BOT_NAME.toUpperCase()}:`,
    `- bot de WhatsApp com prefixo "${PREFIX}" (nos grupos pode haver prefixo próprio).`,
    `- ${PREFIX}menu abre o menu; ${PREFIX}help mostra os comandos; ${PREFIX}suporte é o suporte técnico.`,
    "- funções de membro gastam créditos; o dono do bot não gasta.",
    "",
    "COMANDOS DISPONÍVEIS (nome: o que faz):",
    catalogo,
    "",
    paymentGuideText(),
  ].join("\n");
}

let cache = null;

/** Só para os testes: descarta a cache. */
export function resetBotKnowledgeCache() {
  cache = null;
}
