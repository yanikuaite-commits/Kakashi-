/**
 * Helper central de formatação visual das respostas do bot.
 *
 * TODA resposta de texto passa por aqui — diretamente pelo comando ou pelos
 * helpers centrais de loadCommonFunctions — e termina com o rodapé exato:
 *
 *   ༺ ✦ ᴋᴀᴋᴀsʜɪ ʙᴏᴛ • sʏsᴛᴇᴍ ᴢᴇʀᴏ ᴠ4 ✦ ༻
 *
 * Tema visual "System Zero V4 / Tensura": design futurista, bordas limpas,
 * cabeçalho em caixa de status, símbolos místicos/tecnológicos, letras estilizadas
 * e rodapé de sistema.
 *
 * Molde padrão:
 *
 *   ╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
 *   │ ༺ ⚡ ᴋᴀᴋᴀsʜɪ ʙᴏᴛ • sʏsᴛᴇᴍ ᴢᴇʀᴏ ᴠ4 ⚡ ༻ │
 *   ╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 *   ╭━━━ ༺ ⟡ *ᴋᴀᴋᴀsʜɪ ʙᴏᴛ • TÍTULO* ⟡ ༻ ━━━╮
 *   │
 *   │ linha de conteúdo
 *   ╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 *
 *   ༺ ✦ ᴋᴀᴋᴀsʜɪ ʙᴏᴛ • sʏsᴛᴇᴍ ᴢᴇʀᴏ ᴠ4 ✦ ༻
 */
import { PLAIN_MESSAGE_THEME } from "../config.js";

const BOT_DISPLAY_NAME = "Kakashi Bot";
const BOT_VERSION = "4.0";

const SMALL_CAPS_MAP = {
  a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ғ", g: "ɢ", h: "ʜ", i: "ɪ",
  j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ",
  s: "s", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ",
};

/**
 * Converte texto para estilo de letra Small Caps futurista/anime.
 * @param {string} text
 * @returns {string}
 */
export function toStylizedText(text = "") {
  return String(text).replace(/[a-z]/gi, (char) => {
    const lower = char.toLowerCase();
    return SMALL_CAPS_MAP[lower] || char;
  });
}

export const RODAPE = `༺ ✦ ${toStylizedText(BOT_DISPLAY_NAME)} • sʏsᴛᴇᴍ ᴢᴇʀᴏ ᴠ${BOT_VERSION} ✦ ༻`;

/** Marca de molde aplicado — evita emoldurar a mesma mensagem duas vezes. */
export const FRAME_MARK = "╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮";

let plainTheme = PLAIN_MESSAGE_THEME;

/** O tema ativo é o "plain" (só conteúdo)? */
export function isPlainTheme() {
  return plainTheme;
}

/** Só para os testes: troca o tema ativo. */
export function __setMessageThemeForTests(plain) {
  plainTheme = Boolean(plain);
}

/** Rodapé efetivo: no tema "plain" o rodapé não existe. */
export function footerAtual() {
  return plainTheme ? "" : RODAPE;
}

const MAX_FRAME_LENGTH = 1500;
const MAX_FRAME_LINES = 40;

export function isFramed(text = "") {
  return String(text ?? "").includes(FRAME_MARK);
}

function linesOf(value) {
  if (value === undefined || value === null || value === "") return [];
  return String(value).split("\n");
}

/**
 * Monta a mensagem no molde visual único do bot.
 *
 * @param {object} options
 * @param {string} [options.icone] emoji da categoria (default ⟡)
 * @param {string} [options.titulo] título da seção (fica em caixa alta estilizada)
 * @param {Array<string>} [options.campos] linhas de conteúdo (aceita \n)
 * @param {string|null} [options.rodape] rodapé exato (default `RODAPE`)
 * @param {string} [options.extra] bloco extra após os campos
 * @returns {string}
 */
export function formatMessage({
  icone = "⟡",
  titulo,
  campos = [],
  rodape = footerAtual(),
  extra,
} = {}) {
  if (isPlainTheme()) {
    const corpo = [...campos, extra]
      .flatMap((valor) => (valor === "" ? [""] : linesOf(valor)))
      .join("\n")
      .trim();

    const cabecalho = titulo ? `*${toStylizedText(titulo).toUpperCase()}*` : "";
    const partes = [cabecalho, corpo].filter(Boolean).join("\n\n");

    return rodape ? `${partes}\n\n${rodape}` : partes;
  }

  const nomeEstilizado = toStylizedText(BOT_DISPLAY_NAME);
  const secao = titulo
    ? `╭━━━ ༺ ${icone} *${nomeEstilizado.toUpperCase()} • ${toStylizedText(titulo).toUpperCase()}* ༻ ━━━╮`
    : `╭━━━ ༺ ${icone} *${nomeEstilizado.toUpperCase()}* ༻ ━━━╮`;

  const linhas = [
    FRAME_MARK,
    `│ ༺ ⚡ ${nomeEstilizado.toUpperCase()} • sʏsᴛᴇᴍ ᴢᴇʀᴏ ᴠ${BOT_VERSION} ⚡ ༻ │`,
    "╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    secao,
    "│",
  ];

  const push = (valor) => {
    const partes = linesOf(valor);

    if (!partes.length) {
      linhas.push("│");
      return;
    }

    for (const parte of partes) linhas.push(parte ? `│ ${parte}` : "│");
  };

  for (const campo of campos) push(campo);
  if (extra) push(extra);

  linhas.push("╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯");

  if (rodape) linhas.push("", rodape);

  return linhas.join("\n");
}

/**
 * Emoldura um texto simples no molde único. Textos que já têm molde ou que
 * são grandes demais (ex.: clearChat) passam intactos.
 */
export function ensureFrame(text, options = {}) {
  const value = String(text ?? "");

  if (!value || isFramed(value)) return value;
  if (value.length > MAX_FRAME_LENGTH) return value;
  if (value.split("\n").length > MAX_FRAME_LINES) return value;

  return formatMessage({ ...inferReplyStyle(value), ...options, campos: [value] });
}

function inferReplyStyle(text) {
  const normalized = String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();

  if (/carregando|processando|ja estou a tratar|a baixar|a descarregar/.test(normalized)) {
    return { icone: "⏳", titulo: "Processando" };
  }
  if (/sem permissao|nao tens permissao|so admins|acesso negado/.test(normalized)) {
    return { icone: "🛡️", titulo: "Acesso Restrito" };
  }
  if (/erro|falha|nao consegui|nao foi possivel|invalido|invalida/.test(normalized)) {
    return { icone: "❌", titulo: "Erro" };
  }
  if (/aviso|atencao|uso correto|ja esta (?:ativado|desativado)|precisa informar/.test(normalized)) {
    return { icone: "⚠️", titulo: "Atenção" };
  }
  if (/bem-vind|boas-vind|entrou no grupo|saiu do grupo|despedida/.test(normalized)) {
    return { icone: "👋", titulo: "Grupo" };
  }
  if (/foi removid|foi banid|advertencia|advertido|silenciado|moderacao/.test(normalized)) {
    return { icone: "⚔️", titulo: "Moderação" };
  }
  if (/jogo|pontuacao|pontos|experiencia|\bxp\b|ranking|dado rolado/.test(normalized)) {
    return { icone: "🎮", titulo: "Sistema de Jogo" };
  }
  if (/inteligencia artificial|resposta da ia|gemini|deepseek|gpt|\bia\b/.test(normalized)) {
    return { icone: "🔮", titulo: "Núcleo de IA" };
  }
  if (/painel|administrador|configuracao|saldo de creditos|comando bloqueado/.test(normalized)) {
    return { icone: "⚙️", titulo: "Painel de Controle" };
  }
  if (/sucesso|concluido|enviado|criado|ativado|desativado|feito|adicionado|removido/.test(normalized)) {
    return { icone: "✅", titulo: "Concluído" };
  }

  return { icone: "✧", titulo: "Resposta" };
}

/**
 * Anexa o rodapé exato de forma idempotente.
 */
export function withFooter(text = "") {
  const value = String(text ?? "");

  if (!value) return value;

  const trimmed = value.trimEnd();
  const rodape = footerAtual();
  if (!rodape || trimmed.endsWith(rodape)) return trimmed;

  const maxContentLength = 4096 - rodape.length - 2;
  let content = trimmed;
  if (content.length > maxContentLength) {
    content = content.slice(0, maxContentLength).trimEnd();
  }

  return `${content}\n\n${rodape}`;
}

/* ════════════ TEMPLATES PRONTOS ════════════ */

/** ⏳ CARREGANDO — espera de um pedido em processamento. */
export function loadingMessage({ usuario, detalhe } = {}) {
  const campos = [
    usuario
      ? `⏳ Processando solicitação para @${usuario}... ⚡`
      : `⏳ Processando solicitação no núcleo... ⚡`,
  ];

  if (detalhe) {
    const jaTemIcone = /^[\p{Extended_Pictographic}\uFE0F]/u.test(detalhe);
    campos.push(jaTemIcone ? detalhe : `📌 ${detalhe}`);
  }

  return formatMessage({ icone: "⏳", titulo: "Em Processamento", campos });
}

/** ✅ SUCESSO — confirmação de que o pedido foi concluído. */
export function successMessage({ usuario, campos = [] } = {}) {
  return formatMessage({
    icone: "✅",
    titulo: "Concluído",
    campos: [
      usuario
        ? `✅ Operação finalizada com sucesso, @${usuario}! 🎯`
        : `✅ Operação finalizada com sucesso! 🎯`,
      ...campos,
    ],
  });
}

/** ❌ ERRO — falha na processamento com dica de resolução. */
export function errorMessage(detalhe = "") {
  const campos = [
    `❌ Ops! Ocorreu uma falha no processamento.`,
    `💡 Tente novamente em alguns instantes.`,
  ];

  if (detalhe) campos.push("", `📄 *Detalhes:* ${detalhe}`);

  return formatMessage({ icone: "❌", titulo: "Erro de Sistema", campos });
}

/** ⚠️ ATENÇÃO — aviso geral. */
export function warningMessage(texto = "") {
  return formatMessage({ icone: "⚠️", titulo: "Aviso de Sistema", campos: [texto] });
}

/** ⚠️ ERRO DE USO — mostra o uso correto do comando. */
export function usageMessage({ usage, detalhe } = {}) {
  const campos = [
    usage
      ? `⚠️ Sintaxe correta: ${usage}`
      : `⚠️ É necessário fornecer argumentos para este comando!`,
  ];

  if (detalhe) campos.push(`💡 ${detalhe}`);

  return formatMessage({ icone: "⚠️", titulo: "Sintaxe Incorreta", campos });
}

/** 🚫 SEM PERMISSÃO — comando restrito. */
export function permissionMessage(texto = "🚫 Permissão negada. Apenas administradores.") {
  const campos = Array.isArray(texto) ? texto : [texto];
  return formatMessage({ icone: "🛡️", titulo: "Acesso Negado", campos });
}

/** 🔮 RESPOSTA DA IA — pergunta e resposta separadas. */
export function aiMessage({ pergunta, resposta } = {}) {
  const campos = [];

  if (pergunta) campos.push(`❓ *Pergunta:* ${pergunta}`, "");
  campos.push(`🔮 *Resposta:* ${resposta ?? ""}`);

  return formatMessage({ icone: "🔮", titulo: "Módulo IA", campos });
}

/** 📥 DOWNLOAD — card de download com os campos do pedido. */
export function downloadMessage({
  titulo,
  canal,
  duracao,
  plataforma,
  usuario,
  extra,
  rodape = footerAtual(),
} = {}) {
  const campos = [];

  if (titulo) campos.push(`📌 *Título:* ${titulo}`);
  if (canal) campos.push(`💬 *Canal/Autor:* ${canal}`);
  if (duracao) campos.push(`⏳ *Duração:* ${duracao}`);
  if (plataforma) campos.push(`🌐 *Fonte:* ${plataforma}`);
  if (usuario) campos.push(`👤 *Solicitante:* @${usuario}`);
  if (campos.length) campos.push("");
  campos.push(extra || "⚡ Selecione a opção desejada abaixo:");

  return formatMessage({ icone: "📥", titulo: "Módulo Download", campos, rodape });
}

/** 📥 LEGENDA DE MÍDIA — molde para o envio final do arquivo. */
export function mediaCaption({
  titulo,
  canal,
  seguidores,
  duracao,
  qualidade,
  extra,
  rodape = footerAtual(),
} = {}) {
  const seguidoresTexto =
    seguidores === 0 || seguidores
      ? String(seguidores)
      : "Não disponível";

  const campos = [
    `🎬 *Título:* ${titulo || "Mídia"}`,
    `👤 *Canal/Conta:* ${canal || "Não disponível"}`,
    `👥 *Seguidores:* ${seguidoresTexto}`,
    `⏱️ *Duração:* ${duracao || "Não disponível"}`,
    `📺 *Qualidade:* ${qualidade || "Melhor disponível"}`,
  ];

  if (extra) campos.push("", extra);

  return formatMessage({ icone: "📥", titulo: "Download Concluído", campos, rodape });
}

/** ⚔️ MODERAÇÃO — ação de administração aplicada a um membro. */
export function moderationMessage({ resumo, motivo, detalhes = [] } = {}) {
  const campos = [];

  if (resumo) campos.push(resumo);
  if (motivo) campos.push(`🔎 *Motivo:* _"${motivo}"_`);
  for (const detalhe of detalhes) campos.push(detalhe);

  return formatMessage({ icone: "⚔️", titulo: "Módulo Moderação", campos });
}

/** ⚙️ PAINEL — campos em lista (admin/owner/créditos). */
export function panelMessage({ icone = "⚙️", titulo = "Painel de Controle", campos = [] } = {}) {
  return formatMessage({ icone, titulo, campos });
}

/**
 * 🌀 MENSAGEM PRINCIPAL & MENUS INTERATIVOS (SYSTEM ZERO V4 / TENSURA STYLE)
 *
 * Exibe cartão de status dinâmico do utilizador/sistema, prefixo e categorias do menu.
 *
 * @param {object} options
 * @param {string} [options.usuario] Nome/menção do utilizador que solicitou
 * @param {string} [options.prefixo] Prefixo do bot (default '/')
 * @param {string} [options.modo] Modo do bot (ex: 'Público' / 'Privado')
 * @param {string} [options.dataHora] Hora/Data formatada
 * @param {string} [options.uptime] Tempo de atividade (ex: '2h 15m')
 * @param {string} [options.ping] Latência (ex: '45ms')
 * @param {string} [options.ram] Uso de memória (ex: '128 MB')
 * @param {string} [options.velocidade] Velocidade de resposta (ex: '0.2s')
 * @param {string} [options.cargo] Cargo/patente do utilizador (ex: 'Admin')
 * @param {string} [options.tipoUsuario] Tipo do utilizador (ex: 'FREE USER' / 'VIP')
 * @param {string} [options.grupo] Nome do grupo atual
 * @param {number|string} [options.totalComandos] Total de comandos disponíveis
 * @param {string} [options.versao] Versão do bot
 * @param {string} [options.status] Status do sistema (ex: 'Online', 'Otimizado')
 * @param {Array<{categoria: string, icone?: string, comandos: string[]}>} [options.categorias]
 * @returns {string}
 */
export function mainMenuMessage({
  usuario = "Utilizador",
  prefixo = "/",
  modo = "Público",
  dataHora = "",
  uptime,
  ping,
  ram,
  velocidade,
  cargo,
  tipoUsuario,
  grupo,
  totalComandos,
  versao = BOT_VERSION,
  status = "Online",
  categorias = [],
} = {}) {
  const infos = [
    `│ ☽ *${toStylizedText("Utilizador")}:* ${usuario.replace(/^@/, "")}`,
    tipoUsuario ? `│ 💎 *${toStylizedText("Tipo")}:* ${tipoUsuario}` : "",
    cargo ? `│ 👑 *${toStylizedText("Cargo")}:* ${cargo}` : "",
    grupo ? `│ 🏰 *${toStylizedText("Grupo")}:* ${grupo}` : "",
    `│ ⟡ *${toStylizedText("Prefixo")}:* [ ${prefixo} ]`,
    `│ ✧ *${toStylizedText("Modo")}:* ${modo}`,
    dataHora ? `│ ⊹ *${toStylizedText("Data/Hora")}:* ${dataHora}` : "",
    uptime ? `│ ⏳ *${toStylizedText("Uptime")}:* ${uptime}` : "",
    ping ? `│ ⚡ *${toStylizedText("Latência")}:* ${ping}` : "",
    ram ? `│ 💻 *${toStylizedText("RAM")}:* ${ram}` : "",
    velocidade ? `│ 🚀 *${toStylizedText("Velocidade")}:* ${velocidade}` : "",
    totalComandos ? `│ 📜 *${toStylizedText("Comandos")}:* ${totalComandos}` : "",
    versao ? `│ ⚙️ *${toStylizedText("Versão")}:* v${versao}` : "",
    status ? `│ 🛡️ *${toStylizedText("Status")}:* ${status}` : "",
  ].filter(Boolean);

  const campos = [
    `╭━━━ ༺ ⟡ ${toStylizedText("SYSTEM INFOS")} ⟡ ༻ ━━━╮`,
    ...infos,
    `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯`,
    "",
    "✦ Escolha uma das categorias abaixo no menu interativo para explorar os comandos!",
  ];

  if (categorias.length > 0) {
    campos.push("");
    for (const cat of categorias) {
      const icon = cat.icone || "✦";
      const catEstilizada = toStylizedText(cat.categoria).toUpperCase();
      campos.push(`╭━━━ ༺ ${icon} *${catEstilizada}* ༻ ━━━╮`);
      if (Array.isArray(cat.comandos)) {
        for (const cmd of cat.comandos) {
          campos.push(`│ ➳ ${prefixo}${cmd}`);
        }
      }
      campos.push(`╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯`);
    }
  }

  return formatMessage({
    icone: "🌀",
    titulo: "MENU PRINCIPAL",
    campos,
  });
}
