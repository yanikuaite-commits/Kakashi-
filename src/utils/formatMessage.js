/**
 * Helper central de formatação visual das respostas do bot.
 *
 * TODA resposta de texto passa por aqui — diretamente pelo comando ou pelos
 * helpers centrais de loadCommonFunctions — e termina com o rodapé exato:
 *
 *   ༺ ✦ ᴋᴀᴋᴀsʜɪ ʙᴏᴛ • sʏsᴛᴇᴍ ᴢᴇʀᴏ ᴠ4 ✦ ༻
 *
 * Tema visual "System Zero V4 / Tensura": design futurista, bordas limpas,
 * cabeçalho em caixa de status, símbolos místico-tecnológicos, letras estilizadas,
 * separadores elegantes e rodapé de sistema.
 */
import { PLAIN_MESSAGE_THEME } from "../config.js";

const BOT_DISPLAY_NAME = "Kakashi Bot";
const BOT_VERSION = "4.0";
const CREATOR_NAME = "Yanik Uaite";

const SMALL_CAPS_MAP = {
  a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ғ", g: "ɢ", h: "ʜ", i: "ɪ",
  j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ",
  s: "s", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ",
};

/**
 * Converte texto para estilo de letra Small Caps futurista/anime.
 */
export function toStylizedText(text = "") {
  return String(text).replace(/[a-z]/gi, (char) => {
    const lower = char.toLowerCase();
    return SMALL_CAPS_MAP[lower] || char;
  });
}

export const RODAPE = `༺ ✦ ${toStylizedText(BOT_DISPLAY_NAME)} • sʏsᴛᴇᴍ ᴢᴇʀᴏ ᴠ${BOT_VERSION} ✦ ༻`;

export const FRAME_MARK = "╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮";

let plainTheme = PLAIN_MESSAGE_THEME;

export function isPlainTheme() {
  return plainTheme;
}

export function __setMessageThemeForTests(plain) {
  plainTheme = Boolean(plain);
}

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
    ? `╭━━ ༺ ${icone} *${nomeEstilizado.toUpperCase()} • ${toStylizedText(titulo).toUpperCase()}* ༻ ━━╮`
    : `╭━━ ༺ ${icone} *${nomeEstilizado.toUpperCase()}* ༻ ━━╮`;

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

export function ensureFrame(text, options = {}) {
  const value = String(text ?? "");
  if (!value || isFramed(value)) return value;
  if (value.length > MAX_FRAME_LENGTH) return value;
  if (value.split("\n").length > MAX_FRAME_LINES) return value;
  return formatMessage({ ...inferReplyStyle(value), ...options, campos: [value] });
}

function inferReplyStyle(text) {
  const normalized = String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  if (/carregando|processando|ja estou a tratar|a baixar|a descarregar/.test(normalized)) return { icone: "⏳", titulo: "Processando" };
  if (/sem permissao|nao tens permissao|so admins|acesso negado/.test(normalized)) return { icone: "🛡️", titulo: "Acesso Restrito" };
  if (/erro|falha|nao consegui|nao foi possivel|invalido|invalida/.test(normalized)) return { icone: "❌", titulo: "Erro" };
  if (/aviso|atencao|uso correto|ja esta (?:ativado|desativado)|precisa informar/.test(normalized)) return { icone: "⚠️", titulo: "Atenção" };
  if (/bem-vind|boas-vind|entrou no grupo|saiu do grupo|despedida/.test(normalized)) return { icone: "👋", titulo: "Grupo" };
  if (/foi removid|foi banid|advertencia|advertido|silenciado|moderacao/.test(normalized)) return { icone: "⚔️", titulo: "Moderação" };
  if (/jogo|pontuacao|pontos|experiencia|\bxp\b|ranking|dado rolado/.test(normalized)) return { icone: "🎮", titulo: "Sistema de Jogo" };
  if (/inteligencia artificial|resposta da ia|gemini|deepseek|gpt|\bia\b/.test(normalized)) return { icone: "🔮", titulo: "Núcleo de IA" };
  if (/painel|administrador|configuracao|saldo de creditos|comando bloqueado/.test(normalized)) return { icone: "⚙️", titulo: "Painel de Controle" };
  if (/sucesso|concluido|enviado|criado|ativado|desativado|feito|adicionado|removido/.test(normalized)) return { icone: "✅", titulo: "Concluído" };
  return { icone: "✧", titulo: "Resposta" };
}

export function withFooter(text = "") {
  const value = String(text ?? "");
  if (!value) return value;
  const trimmed = value.trimEnd();
  const rodape = footerAtual();
  if (!rodape || trimmed.endsWith(rodape)) return trimmed;
  const maxContentLength = 4096 - rodape.length - 2;
  let content = trimmed;
  if (content.length > maxContentLength) content = content.slice(0, maxContentLength).trimEnd();
  return `${content}\n\n${rodape}`;
}

/* ════════════ TEMPLATES PRONTOS ════════════ */

export function loadingMessage({ usuario, detalhe } = {}) {
  const campos = [usuario ? `⏳ ᴘʀᴏᴄᴇssᴀɴᴅᴏ sᴏʟɪᴄɪᴛᴀçãᴏ ᴘᴀʀᴀ @${usuario}... ⚡` : `⏳ ᴘʀᴏᴄᴇssᴀɴᴅᴏ sᴏʟɪᴄɪᴛᴀçãᴏ ɴᴏ ɴúᴄʟᴇᴏ... ⚡`];
  if (detalhe) campos.push(/^[\p{Extended_Pictographic}\uFE0F]/u.test(detalhe) ? detalhe : `📌 ${detalhe}`);
  return formatMessage({ icone: "⏳", titulo: "ᴇᴍ ᴘʀᴏᴄᴇssᴀᴍᴇɴᴛᴏ", campos });
}

export function successMessage({ usuario, campos = [] } = {}) {
  return formatMessage({
    icone: "✅",
    titulo: "ᴄᴏɴᴄʟᴜíᴅᴏ",
    campos: [usuario ? `✅ ᴏᴘᴇʀᴀçãᴏ ғɪɴᴀʟɪᴢᴀᴅᴀ ᴄᴏᴍ sᴜᴄᴇssᴏ, @${usuario}! 🎯` : `✅ ᴏᴘᴇʀᴀçãᴏ ғɪɴᴀʟɪᴢᴀᴅᴀ ᴄᴏᴍ sᴜᴄᴇssᴏ! 🎯`, ...campos],
  });
}

export function errorMessage(detalhe = "") {
  const campos = [`❌ ᴏᴘs! ᴏᴄᴏʀʀᴇᴜ ᴜᴍᴀ ғᴀʟʜᴀ ɴᴏ ᴘʀᴏᴄᴇssᴀᴍᴇɴᴛᴏ.`, `💡 ᴛᴇɴᴛᴇ ɴᴏᴠᴀᴍᴇɴᴛᴇ ᴇᴍ ᴀʟɢᴜɴs ɪɴsᴛᴀɴᴛᴇs.`];
  if (detalhe) campos.push("", `📄 *ᴅᴇᴛᴀʟʜᴇs:* ${detalhe}`);
  return formatMessage({ icone: "❌", titulo: "ᴇʀʀᴏ ᴅᴇ sɪsᴛᴇᴍᴀ", campos });
}

export function warningMessage(texto = "") { return formatMessage({ icone: "⚠️", titulo: "ᴀᴠɪsᴏ ᴅᴇ sɪsᴛᴇᴍᴀ", campos: [texto] }); }

export function usageMessage({ usage, detalhe } = {}) {
  const campos = [usage ? `⚠️ sɪɴᴛᴀxᴇ ᴄᴏʀʀᴇᴛᴀ: ${usage}` : `⚠️ é ɴᴇᴄᴇssáʀɪᴏ ғᴏʀɴᴇᴄᴇʀ ᴀʀɢᴜᴍᴇɴᴛᴏs ᴘᴀʀᴀ ᴇsᴛᴇ ᴄᴏᴍᴀɴᴅᴏ!`];
  if (detalhe) campos.push(`💡 ${detalhe}`);
  return formatMessage({ icone: "⚠️", titulo: "sɪɴᴛᴀxᴇ ɪɴᴄᴏʀʀᴇᴛᴀ", campos });
}

export function permissionMessage(texto = "🚫 ᴘᴇʀᴍɪssãᴏ ɴᴇɢᴀᴅᴀ. ᴀᴘᴇɴᴀs ᴀᴅᴍɪɴɪsᴛʀᴀᴅᴏʀᴇs.") {
  return formatMessage({ icone: "🛡️", titulo: "ᴀᴄᴇssᴏ ɴᴇɢᴀᴅᴏ", campos: Array.isArray(texto) ? texto : [texto] });
}

export function aiMessage({ pergunta, resposta } = {}) {
  const campos = [];
  if (pergunta) campos.push(`❓ *ᴘᴇʀɢᴜɴᴛᴀ:* ${pergunta}`, "");
  campos.push(`🔮 *ʀᴇsᴘᴏsᴛᴀ:* ${resposta ?? ""}`);
  return formatMessage({ icone: "🔮", titulo: "móᴅᴜʟᴏ ɪᴀ", campos });
}

export function downloadMessage({ titulo, canal, duracao, plataforma, usuario, extra, rodape = footerAtual() } = {}) {
  const campos = [];
  if (titulo) campos.push(`📌 *ᴛíᴛᴜʟᴏ:* ${titulo}`);
  if (canal) campos.push(`💬 *ᴄᴀɴᴀʟ/ᴀᴜᴛᴏʀ:* ${canal}`);
  if (duracao) campos.push(`⏳ *ᴅᴜʀᴀçãᴏ:* ${duracao}`);
  if (plataforma) campos.push(`🌐 *ғᴏɴᴛᴇ:* ${plataforma}`);
  if (usuario) campos.push(`👤 *sᴏʟɪᴄɪᴛᴀɴᴛᴇ:* @${usuario}`);
  if (campos.length) campos.push("");
  campos.push(extra || "⚡ sᴇʟᴇᴄɪᴏɴᴇ ᴀ ᴏçãᴏ ᴅᴇsᴇᴊᴀᴅᴀ ᴀʙᴀɪxᴏ:");
  return formatMessage({ icone: "📥", titulo: "móᴅᴜʟᴏ ᴅᴏᴡɴʟᴏᴀᴅ", campos, rodape });
}

export function mediaCaption({ titulo, canal, seguidores, duracao, qualidade, extra, rodape = footerAtual() } = {}) {
  const campos = [
    `🎬 *ᴛíᴛᴜʟᴏ:* ${titulo || "Mídia"}`,
    `👤 *ᴄᴀɴᴀʟ/ᴄᴏɴᴛᴀ:* ${canal || "Não disponível"}`,
    `👥 *sᴇɢᴜɪᴅᴏʀᴇs:* ${seguidores ?? "Não disponível"}`,
    `⏱️ *ᴅᴜʀᴀçãᴏ:* ${duracao || "Não disponível"}`,
    `📺 *ǫᴜᴀʟɪᴅᴀᴅᴇ:* ${qualidade || "Melhor disponível"}`,
  ];
  if (extra) campos.push("", extra);
  return formatMessage({ icone: "📥", titulo: "ᴅᴏᴡɴʟᴏᴀᴅ ᴄᴏɴᴄʟᴜíᴅᴏ", campos, rodape });
}

export function moderationMessage({ resumo, motivo, detalhes = [] } = {}) {
  const campos = [];
  if (resumo) campos.push(resumo);
  if (motivo) campos.push(`🔎 *ᴍᴏᴛɪᴠᴏ:* _"${motivo}"_`);
  for (const detalhe of detalhes) campos.push(detalhe);
  return formatMessage({ icone: "⚔️", titulo: "móᴅᴜʟᴏ ᴍᴏᴅᴇʀᴀçãᴏ", campos });
}

export function panelMessage({ icone = "⚙️", titulo = "ᴘᴀɪɴᴇʟ ᴅᴇ ᴄᴏɴᴛʀᴏʟᴇ", campos = [] } = {}) {
  return formatMessage({ icone, titulo, campos });
}

/**
 * MENSAGEM PRINCIPAL & MENUS INTERATIVOS (SYSTEM ZERO V4 / TENSURA STYLE REFINED)
 */
export function mainMenuMessage({
  usuario = "Utilizador",
  prefixo = "/",
  modo = "Público",
  dataHora = "",
  uptime = "0h 00m 00s",
  ping = "0ms",
  ram = "0MB / 0MB",
  velocidade = "0ms",
  cargo = "Membro",
  tipoUsuario = "FREE USER",
  grupo,
  totalComandos = "0",
  versao = BOT_VERSION,
  status = "ONLINE",
  categorias = [],
} = {}) {
  const cleanUser = usuario.replace(/^@/, "");
  const campos = [
    `༺ ⟡ ༻ ${BOT_DISPLAY_NAME.toUpperCase()} ༺ ⟡ ༻`,
    `   ⊹ ࣪ ˖ ✦ ${toStylizedText("KAKASHI CORE")} ✦ ˖ ࣪ ⊹`,
    `   ☽༺✧༻ CREATOR » ${CREATOR_NAME}`,
    `   ☽༺✧༻ BOT    » ${BOT_DISPLAY_NAME}`,
    `   ☽༺✧༻ VERSION » ${versao}`,
    `   ☽༺✧༻ STATUS » ${tipoUsuario}`,
    `   ☽༺✧༻ UPTIME » ${uptime}`,
    `   ☽༺✧༻ PREFIX » [ ${prefixo} ]`,
    `   ──────── ✦ ────────`,
    `   ˚₊· ͟͟͞͞➳ USE O PREFIXO ➳`,
    `   ✧･ﾟ: *✧･ﾟ:* ${BOT_DISPLAY_NAME.toUpperCase()} *:･ﾟ✧*:･ﾟ✧`,
    `   © Made by ${CREATOR_NAME}`,
    "",
    `╭━━━ ༺ ⟡ ${toStylizedText("SYSTEM INFOS")} ⟡ ༻ ━━━╮`,
    `│ ☽ *${toStylizedText("Utilizador")}:* @${cleanUser}`,
    `│ 💎 *${toStylizedText("Tipo")}:* ${tipoUsuario}`,
    `│ 👑 *${toStylizedText("Cargo")}:* ${cargo}`,
    ...(grupo ? [`│ 🏰 *${toStylizedText("Grupo")}:* ${grupo}`] : []),
    `│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `│ ⟡ *${toStylizedText("Prefixo")}:* [ ${prefixo} ]`,
    `│ ✧ *${toStylizedText("Modo")}:* ${modo}`,
    ...(dataHora ? [`│ ⊹ *${toStylizedText("Data/Hora")}:* ${dataHora}`] : []),
    `│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `│ ⏳ *${toStylizedText("Uptime")}:* ${uptime}`,
    `│ ⚡ *${toStylizedText("Latência")}:* ${ping}`,
    `│ 💻 *${toStylizedText("RAM")}:* ${ram}`,
    `│ 🚀 *${toStylizedText("Velocidade")}:* ${velocidade}`,
    `│ 📜 *${toStylizedText("Comandos")}:* ${totalComandos}`,
    `│ ⚙️ *${toStylizedText("Versão")}:* v${versao}`,
    `│ 🛡️ *${toStylizedText("Status")}:* ${status}`,
    `│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `│ 👤 *${toStylizedText("Criador")}:* ${CREATOR_NAME}`,
    `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯`,
    "",
    `✦ ᴇsᴄᴏʟʜᴀ ᴜᴍᴀ ᴅᴀs ᴄᴀᴛᴇɢᴏʀɪᴀs ᴀʙᴀɪxᴏ ɴᴏ ᴍᴇɴᴜ ɪɴᴛᴇʀᴀᴛɪᴠᴏ, @${cleanUser}!`,
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
    titulo: "ᴍᴇɴᴜ ᴘʀɪɴᴄɪᴘᴀʟ",
    campos,
  });
}
