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
  ping: '📡',
  ram: '💾',
  disk: '💿',
  speed: '🚀',
  commands: '📜',
  version: '⚙️',
  status: '🟢',
  creator: '⚔️',
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
    displayText: `${symbol} ${label}`,
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
    createButton('Informações', 'menu_info', BUTTON_SYMBOLS.info),
    createButton('Configurações', 'menu_settings', BUTTON_SYMBOLS.settings),
  ];

  const categoryButtons = categorias.map(cat => {
    const symbol = cat.icone || BUTTON_SYMBOLS.main;
    return createButton(
      toStylizedText(cat.categoria).toUpperCase(),
      `menu_${cat.categoria.toLowerCase().replace(/\s+/g, '_')}`,
      symbol
    );
  });

  return [
    createButtonRow(mainButtons),
    createButtonRow(categoryButtons),
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
    `${BUTTON_SYMBOLS.action} ${comando}`,
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
  
  if (status.uptime) {
    buttons.push(createButton(`Uptime: ${status.uptime}`, 'status_uptime', BUTTON_SYMBOLS.time));
  }
  
  if (status.ping) {
    buttons.push(createButton(`Latência: ${status.ping}`, 'status_ping', BUTTON_SYMBOLS.network));
  }
  
  if (status.ram) {
    buttons.push(createButton(`RAM: ${status.ram}`, 'status_ram', BUTTON_SYMBOLS.memory));
  }
  
  if (status.cpu) {
    buttons.push(createButton(`CPU: ${status.cpu}`, 'status_cpu', BUTTON_SYMBOLS.cpu));
  }
  
  if (status.velocidade) {
    buttons.push(createButton(`Velocidade: ${status.velocidade}`, 'status_speed', BUTTON_SYMBOLS.speed));
  }
  
  if (status.comandos) {
    buttons.push(createButton(`Comandos: ${status.comandos}`, 'status_commands', BUTTON_SYMBOLS.commands));
  }
  
  if (status.versao) {
    buttons.push(createButton(`Versão: ${status.versao}`, 'status_version', BUTTON_SYMBOLS.version));
  }
  
  if (status.status) {
    const symbol = status.status === 'ONLINE' ? BUTTON_SYMBOLS.status : BUTTON_SYMBOLS.offline;
    buttons.push(createButton(`Status: ${status.status}`, 'status_system', symbol));
  }
  
  return [createButtonRow(buttons)];
}

/**
 * Cria botões de usuário.
 * @param {Object} userInfo - Informações do usuário
 * @returns {Array<Object>} Botões de usuário
 */
export function createUserButtons(userInfo = {}) {
  const buttons = [];
  
  if (userInfo.tipo) {
    buttons.push(createButton(`Tipo: ${userInfo.tipo}`, 'user_type', BUTTON_SYMBOLS.premium));
  }
  
  if (userInfo.cargo) {
    buttons.push(createButton(`Cargo: ${userInfo.cargo}`, 'user_role', BUTTON_SYMBOLS.admin));
  }
  
  if (userInfo.grupo) {
    buttons.push(createButton(`Grupo: ${userInfo.grupo}`, 'user_group', BUTTON_SYMBOLS.group));
  }
  
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
  
  if (pagina > 1) {
    buttons.push(createButton('Anterior', `nav_prev_${pagina}`, BUTTON_SYMBOLS.warning));
  }
  
  buttons.push(createButton(`Página ${pagina}/${totalPaginas}`, 'nav_info', BUTTON_SYMBOLS.info));
  
  if (pagina < totalPaginas) {
    buttons.push(createButton('Próximo', `nav_next_${pagina}`, BUTTON_SYMBOLS.success));
  }
  
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
      createButton('Exemplos', 'help_examples', BUTTON_SYMBOLS.info),
      createButton('Suporte', 'help_support', BUTTON_SYMBOLS.main),
    ]),
    createButtonRow([
      createButton('Atualizações', 'help_updates', BUTTON_SYMBOLS.status),
      createButton('Sobre', 'help_about', BUTTON_SYMBOLS.creator),
    ])
  ];
}

/**
 * Cria botões de download.
 * @param {Object} fileInfo - Informações do arquivo
 * @returns {Array<Object>} Botões de download
 */
export function createDownloadButtons(fileInfo = {}) {
  const buttons = [];
  
  if (fileInfo.qualidade) {
    buttons.push(createButton(`Qualidade: ${fileInfo.qualidade}`, 'download_quality', BUTTON_SYMBOLS.settings));
  }
  
  if (fileInfo.formato) {
    buttons.push(createButton(`Formato: ${fileInfo.formato}`, 'download_format', BUTTON_SYMBOLS.settings));
  }
  
  buttons.push(
    createButtonRow([
      createButton('Baixar Agora', 'download_start', BUTTON_SYMBOLS.download),
      createButton('Cancelar', 'download_cancel', BUTTON_SYMBOLS.error),
    ])
  );
  
  return buttons;
}
