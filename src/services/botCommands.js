/**
 * Catálogo de comandos que a IA pode executar.
 *
 * Isto é um acelerador de linguagem natural, NÃO um canal de privilégios: a
 * acção é re-despachada pelo `dynamicCommand`, por isso permissões, anti-flood,
 * créditos e erros continuam a valer como num comando escrito à mão. O catálogo
 * existe só para a IA (1) não inventar nomes e (2) não poder tocar em comandos
 * destrutivos (ban, apagar, chaves, backup).
 *
 * @author Dev Yanik
 */
import { PREFIX } from "../config.js";
import { readCommandImports } from "../utils/index.js";

/**
 * Comandos de admin que a IA pode executar, sempre com um valor explícito
 * (1 = ligar, 0 = desligar). São só interruptores de recurso do grupo: nada
 * aqui remove, pune ou apaga.
 */
export const AI_TOGGLE_COMMANDS = [
  "anti-link",
  "anti-audio",
  "anti-video",
  "anti-image",
  "anti-sticker",
  "anti-document",
  "anti-product",
  "anti-event",
  "anti-call",
  "anti-payment",
  "anti-lottie-sticker",
  "anti-status-grupo",
  "auto-responder",
  "auto-sticker",
  "welcome",
  "exit",
  "only-admin",
];

/** Comandos de admin sem valor (a IA não lhes acrescenta nada). */
export const AI_SIMPLE_COMMANDS = ["abrir", "fechar"];

/**
 * Comandos de ligar/desligar que NÃO entram: mexem no silêncio do usuário, não
 * num recurso do grupo, e um "0" acidental é destrutivo e silencioso.
 */
const FORA_POR_SEGURANCA = ["mute", "unmute", "limpar-chat", "agendar-mensagem"];

/**
 * Comandos que a IA NUNCA executa, mesmo que o dono peça. A lista é redundante
 * com o catálogo positivo de propósito: é a segunda barreira, para uma futura
 * entrada no catálogo não abrir sozinha uma porta perigosa.
 */
export const AI_FORBIDDEN_COMMANDS = [
  "ban",
  "block-wpp",
  "delete",
  "limpar-chat",
  "mute",
  "unmute",
  "promover",
  "rebaixar",
  "warn",
  "unwarn",
  "set-name",
  "backup",
  "restore",
  "apagar-dados",
  "private-whitelist",
  "recarregar",
  "remover-creditos",
];

const PALAVRAS_LIGAR = ["ativar", "ativa", "ligar", "liga", "ligue", "on"];
const PALAVRAS_DESLIGAR = [
  "desativar",
  "desativa",
  "desligar",
  "desliga",
  "desligue",
  "off",
];

/**
 * Minúsculas, sem acentos e em tokens. "Anti-Marcação Status" e
 * "anti marcacao status" passam a `["anti","marcacao","status"]`.
 *
 * `\p{Diacritic}` exige a flag `u`.
 */
export function tokenizar(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Traduz a frase do usuário numa intenção de ligar/desligar, se houver.
 *
 * @param {string} texto
 * @returns {"on"|"off"|null}
 */
export function intencaoDoTexto(texto) {
  for (const palavra of tokenizar(texto)) {
    if (PALAVRAS_LIGAR.includes(palavra)) return "on";
    if (PALAVRAS_DESLIGAR.includes(palavra)) return "off";
  }

  return null;
}

/**
 * Quantos tokens de um alias aparecem, em sequência, dentro do texto.
 *
 * Um alias de várias palavras conta como correspondência quando o usuário diz
 * pelo menos as duas primeiras ("anti status" → `anti-status-grupo`). Um alias
 * de uma palavra só corresponde pelo token inteiro. Assim "anti status" NÃO cai
 * em `anti-link` (só partilha o primeiro token).
 */
function tokensCorrespondidos(tokens, aliasTokens) {
  if (!aliasTokens.length) return 0;

  if (aliasTokens.length === 1) {
    const alvo = aliasTokens[0];

    if (tokens.includes(alvo)) return 1;

    // Alias de uma palavra que o usuário escreve separado ("bem vindo" →
    // `bemvindo`, "boas vindas" → `boasvindas`). Junta até 3 tokens seguidos.
    for (let i = 0; i < tokens.length; i++) {
      let junto = "";

      for (let j = i; j < Math.min(i + 3, tokens.length); j++) {
        junto += tokens[j];
        if (junto === alvo) return 1;
      }
    }

    return 0;
  }

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== aliasTokens[0]) continue;

    let iguais = 1;
    while (
      iguais < aliasTokens.length &&
      tokens[i + iguais] === aliasTokens[iguais]
    ) {
      iguais++;
    }

    if (iguais >= 2) return iguais;
  }

  return 0;
}

/** Alias (nome e comandos) de um comando, em tokens. */
function aliasesDoComando(comando) {
  return [...new Set([comando.name, ...comando.commands])].map(tokenizar);
}

/** Melhor correspondência entre o texto e os alias de um comando. */
function melhorCorrespondencia(comando, tokens) {
  return Math.max(
    0,
    ...aliasesDoComando(comando).map((alias) =>
      tokensCorrespondidos(tokens, alias),
    ),
  );
}

/** Nomes e aliases de todos os comandos executáveis pela IA. */
export async function aiCommandNames() {
  const nomes = new Set();

  for (const { comando } of await comandosPermitidosCached()) {
    for (const alias of comando.commands) nomes.add(alias);
  }

  return [...nomes].sort();
}

/** Uma linha "nome: descrição" por comando executável (para o prompt). */
export async function aiCommandCatalogText() {
  return (await comandosPermitidosCached())
    .map(({ comando }) => {
      const descricao = String(comando.description || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      return `${comando.name}: ${descricao}`;
    })
    .join("\n");
}

/** Comandos que a IA pode despachar, com o tipo (`member`/`admin`). */
async function comandosPermitidos() {
  const imports = await readCommandImports();
  const permitidos = new Set([...AI_TOGGLE_COMMANDS, ...AI_SIMPLE_COMMANDS]);
  const lista = [];

  // Só os interruptores de grupo e abrir/fechar. Um comando de membro executado
  // por engano ("Kakashi, anime X") começava um download pago a partir de uma
  // frase ambígua; quem quer o comando escreve-o. Em texto, a IA explica-o.
  for (const tipo of ["admin"]) {
    for (const comando of imports[tipo] || []) {
      if (!comando?.commands?.length) continue;
      if (AI_FORBIDDEN_COMMANDS.includes(comando.name)) continue;
      if (FORA_POR_SEGURANCA.includes(comando.name)) continue;
      if (!permitidos.has(comando.name)) continue;

      lista.push({ comando, tipo });
    }
  }

  return lista;
}

/**
 * A mesma lista, em cache. `readCommandImports` reimporta ~175 ficheiros, o que
 * não pode acontecer a cada mensagem: o catálogo não muda durante a execução.
 */
let cachePermitidos = null;

function comandosPermitidosCached() {
  if (!cachePermitidos) {
    cachePermitidos = comandosPermitidos().catch((error) => {
      cachePermitidos = null;
      throw error;
    });
  }

  return cachePermitidos;
}

/** Só para os testes: descarta a cache do catálogo. */
export function resetBotCommandsCache() {
  cachePermitidos = null;
}

/** Melhor comando para os tokens do pedido, ou `null`. */
function melhorComandoPara(tokens, permitidos) {
  let melhor = null;
  let melhorPontuacao = 0;

  for (const { comando } of permitidos) {
    const pontuacao = melhorCorrespondencia(comando, tokens);

    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhor = comando;
    }
  }

  return melhor;
}

/**
 * Resolve o pedido da IA num comando real e pronto a despachar.
 *
 * Tenta primeiro o nome exato (o modelo segue a lista) e só depois a
 * correspondência por tokens, para "anti status" também cair em
 * `anti-status-grupo` sem o modelo ter de acertar no nome interno.
 *
 * @param {{command?: string, intent?: string}} action acção pedida pela IA
 * @returns {Promise<{ok: true, comando: string, tipo: string, args: string} | {ok: false, motivo: string}>}
 */
export async function resolveAiAction(action) {
  const pedido = tokenizar(action?.command).join("-");

  if (!pedido) {
    return { ok: false, motivo: "sem-comando" };
  }

  const permitidos = await comandosPermitidosCached();

  const encontrado =
    permitidos.find(({ comando }) =>
      aliasesDoComando(comando).some((alias) => alias.join("-") === pedido),
    ) ||
    (() => {
      const comando = melhorComandoPara(tokenizar(action.command), permitidos);
      return comando ? { comando, tipo: "admin" } : null;
    })();

  if (!encontrado) {
    return { ok: false, motivo: "comando-desconhecido" };
  }

  const { comando, tipo } = encontrado;
  const ehInterruptor =
    tipo === "admin" && !AI_SIMPLE_COMMANDS.includes(comando.name);

  // Interruptor de recurso: exige valor explícito. A intenção "desligar" manda;
  // sem ela assume-se ligar (é o que "ativar X" pede).
  const args = ehInterruptor ? (action?.intent === "off" ? "0" : "1") : "";

  return { ok: true, comando: comando.name, tipo, args };
}

/**
 * Frases que os menus ensinam e que a IA pode executar diretamente, sem
 * depender do campo `intent` do modelo. É o que faz "Kakashi, ativar anti
 * status" funcionar mesmo que o modelo responda só com o texto.
 *
 * Usa os alias REAIS de cada comando (ex.: `boas vindas` → `welcome`), não só o
 * nome canónico, para o usuário não precisar de saber o nome interno.
 *
 * @param {string} texto
 * @returns {Promise<{command: string, intent: "on"|"off"}|null>}
 */
export async function acaoDoTexto(texto) {
  const tokens = tokenizar(texto);
  const permitidos = await comandosPermitidosCached();

  let melhor = null;
  let melhorPontuacao = 0;

  for (const { comando } of permitidos) {
    const pontuacao = melhorCorrespondencia(comando, tokens);

    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhor = comando;
    }
  }

  if (!melhor) return null;

  // Abrir/fechar só é pedido quando se fala do GRUPO: "abre o menu" tem de
  // continuar a ser uma pergunta normal, não um "abrir grupo".
  if (AI_SIMPLE_COMMANDS.includes(melhor.name)) {
    const falaDoGrupo = tokens.includes("grupo") || tokens.includes("chat");
    const intent = intencaoDoTexto(texto);

    if (!falaDoGrupo && !intent) return null;

    return {
      command: melhor.name,
      intent: melhor.name === "fechar" ? "off" : "on",
    };
  }

  const intent = intencaoDoTexto(texto);

  return intent ? { command: melhor.name, intent } : null;
}

/** Texto de ajuda com a sintaxe de cada interruptor, para o prompt. */
export function aiActionHelpText() {
  return [
    "AÇÕES QUE PODES PEDIR:",
    `Só executas comandos quando o pedido é EXPLÍCITO (ex.: "ativar anti-link", "desliga o anti-video", "abre o grupo"). Se o usuário só conversa ou pergunta, responde em texto e NÃO devolvas acção.`,
    "Liga/desliga de recursos do grupo:",
    ...AI_TOGGLE_COMMANDS.map((nome) => `- ${nome}`),
    `Sem valor: ${AI_SIMPLE_COMMANDS.join(", ")}.`,
    `Na acção usa o nome SEM prefixo (ex.: "anti-link", não "${PREFIX}anti-link").`,
  ].join("\n");
}
