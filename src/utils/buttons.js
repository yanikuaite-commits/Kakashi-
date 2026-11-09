/**
 * Gerador de botões interativos para o Kakashi Bot.
 * 
 * Estilo premium inspirado em animes, com símbolos místico-tecnológicos
 * e design futurista alinhado ao tema System Zero V4 / Tensura.
 */
import { toStylizedText } from './formatMessage.js';

const BUTTON_SYMBOLS = {
  main: '⚔️',
  action: '➳',
  info: '📄',
  success: '✅',
  warning: '⚠️',
  error: '❌',
  ninja: '🥷',
  magic: '🔮',
  download: '📥',
  settings: '⚙️',
  status: '🟢',
  offline: '🔴',
  premium: '💎',
  group: '🏰',
  user: '👤',
  admin: '👑',
  time: '⏳',
  speed: '🚀',
  memory: '💾',
  cpu: '💻',
  network: '📡',
  storage: '💿',
  commands: '📜',
  version: '⚙️',
  creator: '⚔️',
  menu: '✨',
  prefix: '⚡',
  mode: '🛡️',
  date: '📅',
  channel: '🌐',
  list: '☰'
};

/**
 * Cria um botão interativo com estilo premium.
 * @param {string} label - Texto do botão
 * @param {string} callbackData - Dado de callback para o botão
 * @param {string} symbol - Símbolo do botão (opcional)
 * @returns {Object} Objeto de botão formatado
 */
export function createButton(label, callbackData, symbol = BUTTON_SYMBOLS.action) {
  return {
    displayText: `${symbol} ${toStylizedText(label.toUpperCase())}`,
    type: 1,
    reply: {
      id: callbackData,
      title: label
    }
  };
}

/**
 * Cria uma linha de botões interativos.
 * @param {Array<Object>} buttons - Array de botões
 * @returns {Array<Object>} Linha de botões formatada
 */
export function createButtonRow(buttons) {
  return buttons.map(btn => ({
    button: btn
  }));
}

/**
 * Cria botões principais do menu.
 * @param {string} prefixo - Prefixo dos comandos
 * @param {Array<Object>} categorias - Lista de categorias
 * @returns {Array<Object>} Linhas de botões do menu
 */
export function createMainMenuButtons(prefixo, categorias = []) {
  const mainButtons = [
    createButton('Menu Principal', 'menu_main', BUTTON_SYMBOLS.main),
    createButton('Comandos', 'menu_commands', BUTTON_SYMBOLS.list),
    createButton('Canal Oficial', 'menu_channel', BUTTON_SYMBOLS.channel),
  ];

  return [
    createButtonRow(mainButtons)
  ];
}

/**
 * Cria botões de ação para comandos.
 * @param {string} comando - Nome do comando
 * @param {string} acao - Ação do botão
 * @returns {Object} Botão de ação formatado
 */
export function createActionButton(comando, acao) {
  return createButton(
    comando,
    `cmd_${comando}_${acao}`,
    BUTTON_SYMBOLS.action
  );
}

/**
 * Cria botões de confirmação.
 * @param {string} acao - Ação a ser confirmada
 * @returns {Array<Object>} Botões de confirmação
 */
export function createConfirmationButtons(acao) {
  return [
    createButton('Confirmar', `confirm_${acao}`, BUTTON_SYMBOLS.success),
    createButton('Cancelar', `cancel_${acao}`, BUTTON_SYMBOLS.error),
  ];
}

/**
 * Cria botões de status do sistema.
 * @param {Object} status - Objeto com status do sistema
 * @returns {Array<Object>} Botões de status
 */
export function createStatusButtons(status = {}) {
  const buttons = [];
  
  if (status.uptime) buttons.push(createButton(`Uptime: ${status.uptime}`, 'status_uptime', BUTTON_SYMBOLS.time));
  if (status.ping) buttons.push(createButton(`Ping: ${status.ping}`, 'status_ping', BUTTON_SYMBOLS.network));
  if (status.ram) buttons.push(createButton(`RAM: ${status.ram}`, 'status_ram', BUTTON_SYMBOLS.memory));
  
  return [createButtonRow(buttons)];
}

/**
 * Cria botões de usuário.
 * @param {Object} userInfo - Informações do usuário
 * @returns {Array<Object>} Botões de usuário
 */
export function createUserButtons(userInfo = {}) {
  const buttons = [];
  
  if (userInfo.tipo) buttons.push(createButton(`Tipo: ${userInfo.tipo}`, 'user_type', BUTTON_SYMBOLS.premium));
  if (userInfo.cargo) buttons.push(createButton(`Cargo: ${userInfo.cargo}`, 'user_role', BUTTON_SYMBOLS.admin));
  
  return [createButtonRow(buttons)];
}

/**
 * Cria botões de navegação.
 * @param {string} pagina - Página atual
 * @param {number} totalPaginas - Total de páginas
 * @returns {Array<Object>} Botões de navegação
 */
export function createNavigationButtons(pagina = 1, totalPaginas = 1) {
  const buttons = [];
  
  if (pagina > 1) buttons.push(createButton('Anterior', `nav_prev_${pagina}`, BUTTON_SYMBOLS.warning));
  buttons.push(createButton(`Página ${pagina}/${totalPaginas}`, 'nav_info', BUTTON_SYMBOLS.info));
  if (pagina < totalPaginas) buttons.push(createButton('Próximo', `nav_next_${pagina}`, BUTTON_SYMBOLS.success));
  
  return [createButtonRow(buttons)];
}

/**
 * Cria botões de ajuda.
 * @returns {Array<Object>} Botões de ajuda
 */
export function createHelpButtons() {
  return [
    createButtonRow([
      createButton('Comandos', 'help_commands', BUTTON_SYMBOLS.commands),
      createButton('Suporte', 'help_support', BUTTON_SYMBOLS.main),
    ])
  ];
}

/**
 * Cria botões de download.
 * @param {Object} fileInfo - Informações do arquivo
 * @returns {Array<Object>} Botões de download
 */
export function createDownloadButtons(fileInfo = {}) {
  return [
    createButtonRow([
      createButton('Baixar', 'download_start', BUTTON_SYMBOLS.download),
      createButton('Cancelar', 'download_cancel', BUTTON_SYMBOLS.error),
    ])
  ];
}
