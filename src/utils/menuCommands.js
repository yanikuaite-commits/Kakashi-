/**
 * Gerador de menus de comandos para o Kakashi Bot.
 * 
 * Organiza os comandos em categorias com estilo premium,
 * utilizando símbolos decorativos e formatação estilizada.
 */
import { toStylizedText } from './formatMessage.js';

const CATEGORY_SYMBOLS = {
  geral: '⚔️',
  ia: '🔮',
  download: '📥',
  moderacao: '🛡️',
  utilidades: '⚙️',
  jogos: '🎮'
};

/**
 * Formata uma categoria de comandos para exibição.
 * @param {string} categoria - Nome da categoria
 * @param {Array<string>} comandos - Lista de comandos
 * @returns {string} Categoria formatada
 */
export function formatCategory(categoria, comandos = []) {
  const symbol = CATEGORY_SYMBOLS[categoria.toLowerCase()] || '✦';
  const title = toStylizedText(categoria).toUpperCase();
  
  let output = `╭━━━ ${symbol} *${title}* ━━━╮\n`;
  for (const cmd of comandos) {
    output += `│ ➳ ${cmd}\n`;
  }
  output += `╰━━━━━━━━━━━━━━━━━━━━━━━╯`;
  
  return output;
}

/**
 * Gera o menu completo de comandos.
 * @param {Array<Object>} menuData - Dados dos comandos organizados por categoria
 * @returns {string} Menu completo formatado
 */
export function generateCommandMenu(menuData = []) {
  return menuData
    .map(cat => formatCategory(cat.categoria, cat.comandos))
    .join('\n\n');
}
