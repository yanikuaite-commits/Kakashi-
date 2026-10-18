/**
 * Helper central de formatação visual das respostas do bot.
 *
 * TODA resposta de texto passa por aqui — diretamente pelo comando ou pelos
 * helpers centrais de loadCommonFunctions — e termina com o rodapé exato:
 *
 *   © Made by Yanik Uaite
 *
 * Molde padrão:
 *
 *   ┌─〔 ícone *KAKASHI BOT • TÍTULO* 〕─┐
 *   │
 *   │ linha de conteúdo
 *   └──────────────────┘
 *
 * Nunca monte o molde à mão num comando: use formatMessage ou os templates
 * prontos abaixo.
 */
import { BOT_NAME } from "../config.js";

export const RODAPE = "© Made by Yanik Uaite";

/** Marca de molde aplicado — evita emoldurar a mesma mensagem duas vezes. */
export const FRAME_MARK = "┌─〔";

// Textos gigantes (ex.: clearChat com ~1900 quebras de linha) ficam como estão:
// emoldurar só atrapalha e pode estourar o limite de 4096 caracteres.
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
 * @param {string} [options.icone] emoji da categoria (default 🎛️)
 * @param {string} [options.titulo] título da seção (fica em caixa alta)
 * @param {Array<string>} [options.campos] linhas de conteúdo (aceita \n)
 * @param {string|null} [options.rodape] rodapé exato (default "© Made by Yanik Uaite")
 * @param {string} [options.extra] bloco extra após os campos
 * @returns {string}
 */
export function formatMessage({
  icone = "🎛️",
  titulo,
  campos = [],
  rodape = RODAPE,
  extra,
} = {}) {
  const nome = BOT_NAME.toUpperCase();
  const secao = titulo
    ? `┌─〔 ${icone} *${nome} • ${String(titulo).toUpperCase()}* 〕─┐`
    : `┌─〔 ${icone} *${nome}* 〕─┐`;

  const linhas = [`🎛️ *${BOT_NAME}*`, "", secao, "│"];

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

  linhas.push("└──────────────────┘");

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

  return formatMessage({ ...options, campos: [value] });
}

/**
 * Anexa o rodapé exato de forma idempotente (nunca duplica e nunca estoura
 * o limite de 4096 caracteres do WhatsApp).
 */
export function withFooter(text = "") {
  const value = String(text ?? "");

  if (!value) return value;

  const trimmed = value.trimEnd();
  if (trimmed.endsWith(RODAPE)) return trimmed;

  const maxContentLength = 4096 - RODAPE.length - 2;
  let content = trimmed;
  if (content.length > maxContentLength) {
    content = content.slice(0, maxContentLength).trimEnd();
  }

  return `${content}\n\n${RODAPE}`;
}

/* ════════════ TEMPLATES PRONTOS ════════════ */

/** ⏳ CARREGANDO — espera de um pedido em processamento. */
export function loadingMessage({ usuario, detalhe } = {}) {
  const campos = [
    usuario
      ? `⏳ Já estou a tratar do teu pedido, @${usuario}... 🔄`
      : `⏳ Já estou a tratar do teu pedido... 🔄`,
  ];

  if (detalhe) {
    const jaTemIcone = /^[\p{Extended_Pictographic}\uFE0F]/u.test(detalhe);
    campos.push(jaTemIcone ? detalhe : `📌 ${detalhe}`);
  }

  return formatMessage({ icone: "⏳", titulo: "Carregando", campos });
}

/** ✅ SUCESSO — confirmação de que o pedido foi concluído. */
export function successMessage({ usuario, campos = [] } = {}) {
  return formatMessage({
    icone: "✅",
    titulo: "Sucesso",
    campos: [
      usuario
        ? `✅ Feito, @${usuario}! Aqui está o que pediste 🎉`
        : `✅ Feito! Aqui está o que pediste 🎉`,
      ...campos,
    ],
  });
}

/** ❌ ERRO — falha na processamento com dica de resolução. */
export function errorMessage(detalhe = "") {
  const campos = [
    `❌ Ops! Algo correu mal ao processar.`,
    `💡 Tenta de novo em instantes ou verifica o link.`,
  ];

  if (detalhe) campos.push("", `📄 *Detalhes:* ${detalhe}`);

  return formatMessage({ icone: "❌", titulo: "Erro", campos });
}

/** ⚠️ ATENÇÃO — aviso geral (não é erro de uso). */
export function warningMessage(texto = "") {
  return formatMessage({ icone: "⚠️", titulo: "Atenção", campos: [texto] });
}

/** ⚠️ ERRO DE USO — mostra o uso correto do comando. */
export function usageMessage({ usage, detalhe } = {}) {
  const campos = [
    usage
      ? `⚠️ Uso correto: ${usage}`
      : `⚠️ Este comando precisa de argumentos!`,
  ];

  if (detalhe) campos.push(`💡 ${detalhe}`);

  return formatMessage({ icone: "⚠️", titulo: "Uso incorreto", campos });
}

/** 🚫 SEM PERMISSÃO — comando restrito. */
export function permissionMessage(texto = "🚫 Só admins podem usar este comando.") {
  const campos = Array.isArray(texto) ? texto : [texto];
  return formatMessage({ icone: "🚫", titulo: "Sem permissão", campos });
}

/** 🤖 RESPOSTA DA IA — pergunta e resposta separadas. */
export function aiMessage({ pergunta, resposta } = {}) {
  const campos = [];

  if (pergunta) campos.push(`❓ *Pergunta:* ${pergunta}`, "");
  campos.push(`💬 *Resposta:* ${resposta ?? ""}`);

  return formatMessage({ icone: "🤖", titulo: "Resposta da IA", campos });
}

/** 📥 DOWNLOAD — card de download com os campos do pedido. */
export function downloadMessage({ titulo, canal, duracao, plataforma, usuario, extra } = {}) {
  const campos = [];

  if (titulo) campos.push(`📌 *Título:* ${titulo}`);
  if (canal) campos.push(`💬 *Canal:* ${canal}`);
  if (duracao) campos.push(`⏳ *Duração:* ${duracao}`);
  if (plataforma) campos.push(`🌐 *Fonte:* ${plataforma}`);
  if (usuario) campos.push(`👤 *Pedido de:* @${usuario}`);
  if (campos.length) campos.push("");
  campos.push(extra || "✨ Escolha a qualidade desejada abaixo!");

  return formatMessage({ icone: "📥", titulo: "Download", campos });
}

/** 🛡️ MODERAÇÃO — ação de administração aplicada a um membro. */
export function moderationMessage({ resumo, motivo, detalhes = [] } = {}) {
  const campos = [];

  if (resumo) campos.push(resumo);
  if (motivo) campos.push(`🔎 *Motivo:* _"${motivo}"_`);
  for (const detalhe of detalhes) campos.push(detalhe);

  return formatMessage({ icone: "🛡️", titulo: "Moderação", campos });
}

/** 🔧 PAINEL — campos em lista (admin/owner/créditos). */
export function panelMessage({ icone = "🔧", titulo = "Painel", campos = [] } = {}) {
  return formatMessage({ icone, titulo, campos });
}