/**
 * Menu principal visual (card do `.menu`).
 *
 * Visual: imagem de cabeçalho + corpo com o molde do Kakashi + rodapé
 * "© Kakashi Bot • Escolha abaixo" e 3 botões nativeFlow:
 *   [👑 Dono]          cta_url → https://wa.me/<MAIN_MENU_OWNER_NUMBER>
 *   [🔰 Ver Menus 🔰]  single_select com as categorias (id `cat:<categoria>`)
 *   [📢 Canal]         cta_url → MAIN_MENU_CHANNEL_URL
 *
 * O menu antigo não foi removido: `src/commands/member/menu.js` usa este card e,
 * se ele não puder ser enviado, cai no card de texto/imagem anterior.
 *
 * Fallbacks em ordem (regra 7):
 *   1. card interativo nativeFlow com imagem
 *   2. card interativo nativeFlow sem imagem (imagem falhou)
 *   3. lista clássica (listMessage) com as categorias
 *   4. texto simples com o mesmo visual + categorias numeradas
 * Cada formato enviado é registado no console com `[menu]`.
 *
 * Suportabilidade no Baileys deste repo (ver scripts/patch-baileys.mjs e
 * lib/Utils/messages.js):
 *   - `interactiveButtons` vira `interactiveMessage.nativeFlowMessage` com
 *     `messageVersion`/`messageParamsJson`, e o `biz/native_flow` é injetado
 *     no relay (additionalNodes) automaticamente;
 *   - `cta_url` é aceite (o patch adiciona `merchant_url`);
 *   - `single_select` também é aceite, e o patch procura esse botão em toda a
 *     lista para injetar o nó `mixed` + `quality_control` mesmo com cta_url
 *     antes dele;
 *   - `image` + `caption` + `interactiveButtons` viram cabeçalho de mídia do
 *     interactiveMessage (`buildInteractiveHeader`).
 * A linha de "cupom" da captura de referência NÃO existe no nativeFlow (é de
 * mensagens de template/business), por isso foi ignorada de propósito.
 *
 * @author Dev Gui
 */
import fs from "node:fs";
import {
  BOT_NAME,
  MAIN_MENU_CHANNEL_URL,
  MAIN_MENU_CREATOR,
  MAIN_MENU_FOOTER,
  MAIN_MENU_IMAGE,
  MAIN_MENU_OWNER_NUMBER,
} from "../config.js";
import { ownerButton, ownerWhatsAppUrl, singleSelectButton } from "./interactive.js";
import { errorLog, infoLog } from "./logger.js";
import { listCategories } from "../interactive/menuRegistry.js";
import {
  openGuidedSession,
  registerGuidedOptions,
} from "../interactive/flow.js";

const MAPUTO_TZ = "Africa/Maputo";

/** Limite de linhas por seção nas listas do WhatsApp. */
const MAIN_MENU_ROWS_PER_SECTION = 10;

/** Nomes dos dias em português (pt-PT devolve "segunda-feira" etc.). */
const DIAS_SEMANA = {
  domingo: "Domingo",
  segunda: "Segunda",
  "segunda-feira": "Segunda",
  terça: "Terça",
  "terça-feira": "Terça",
  terca: "Terça",
  "terca-feira": "Terça",
  quarta: "Quarta",
  "quarta-feira": "Quarta",
  quinta: "Quinta",
  "quinta-feira": "Quinta",
  sexta: "Sexta",
  "sexta-feira": "Sexta",
  sábado: "Sábado",
  sabado: "Sábado",
};

const dateFormatter = new Intl.DateTimeFormat("pt-PT", {
  timeZone: MAPUTO_TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "long",
  hour12: false,
});

/**
 * Data/hora/dia da semana no fuso Africa/Maputo.
 *
 * @param {Date} [date]
 * @returns {{ data: string, hora: string, diaSemana: string }}
 */
export function mainMenuClock(date = new Date()) {
  const partes = Object.fromEntries(
    dateFormatter
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  const hora = String(partes.hour === "24" ? "00" : partes.hour);

  return {
    data: `${partes.day}/${partes.month}/${partes.year}`,
    hora: `${hora}:${partes.minute}:${partes.second}`,
    diaSemana:
      DIAS_SEMANA[String(partes.weekday).toLowerCase()] ||
      String(partes.weekday || "").replace(/^\w/, (letra) => letra.toUpperCase()),
  };
}

/**
 * Tempo de resposta em segundos, com 4 casas decimais.
 *
 * @param {number|string} timestampSeconds `webMessage.messageTimestamp`
 * @param {number} [now] agora em ms
 * @returns {string} ex.: "0.1234s"
 */
export function mainMenuVelocity(timestampSeconds, now = Date.now()) {
  const timestamp = Number(timestampSeconds);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "0.0000s";

  const segundos = Math.max(0, now / 1000 - timestamp);
  return `${segundos.toFixed(4)}s`;
}

/**
 * Corpo do card (molde visual pedido, com as variáveis preenchidas).
 */
export function buildMainMenuBody({
  usuario = "usuario",
  data = "--/--/----",
  hora = "--:--:--",
  diaSemana = "—",
  velocidade = "0.0000s",
  criador = MAIN_MENU_CREATOR,
  botName = BOT_NAME,
  rodape = MAIN_MENU_FOOTER,
} = {}) {
  return [
    "┏━━━༺ 🌐 ༻━━━┓",
    `          ${String(botName).toUpperCase()}`,
    "      ┗━━━༺ ⚡ ༻━━━┛",
    "",
    "╭┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈",
    "",
    "   ╭─『 🌙 INFORMAÇÕES 』─╮",
    "",
    `   👤 You Name: @${usuario}`,
    `   📅 Data: ${data}`,
    `   🕒 Horário: ${hora}`,
    `   📆 Hoje é: ${diaSemana}`,
    `   ⚡ Velocidade: ${velocidade}`,
    `   👑 Criador: ${criador}`,
    "",
    "   ╰┈┈┈┈┈┈┈┈┈┈┈┈┈╯",
    "",
    "༺━━━━━━━━━━━━━━━━━━༻",
    "",
    `  ${rodape}`,
    `  『 ⚡ Desenvolvido por ${criador} 』`,
  ].join("\n");
}

/** Normaliza o número do dono para o link do WhatsApp. */
export function mainMenuOwnerUrl(numero = MAIN_MENU_OWNER_NUMBER) {
  return ownerWhatsAppUrl(numero);
}

/**
 * Categorias em seções de até 10 linhas (limite das listas do WhatsApp).
 *
 * @param {Array<{id: string, titulo: string, icone: string, descricao: string}>} categories
 * @returns {Array<{title: string, rows: Array<{id: string, title: string, description: string}>}>}
 */
export function buildMainMenuSections(categories = []) {
  const rows = categories.map((categoria) => ({
    id: `cat:${categoria.id}`,
    title: `${categoria.icone} ${categoria.titulo}`,
    description: categoria.descricao,
  }));

  const secoes = [];
  for (
    let inicio = 0;
    inicio < rows.length;
    inicio += MAIN_MENU_ROWS_PER_SECTION
  ) {
    secoes.push({
      title: secoes.length ? "Mais categorias" : "Categorias",
      rows: rows.slice(inicio, inicio + MAIN_MENU_ROWS_PER_SECTION),
    });
  }

  return secoes;
}

/**
 * Botões do card: Dono (cta_url), Ver Menus (lista single_select) e Canal
 * (cta_url). Sem categorias fica só o Canal: quick_reply NUNCA é usado
 * (o WhatsApp descarta-o em silêncio).
 */
export function buildMainMenuButtons({
  ownerNumber = MAIN_MENU_OWNER_NUMBER,
  channelUrl = MAIN_MENU_CHANNEL_URL,
  categories = [],
} = {}) {
  const botoes = [];
  const dono = ownerButton({ numero: ownerNumber });

  if (dono) botoes.push(dono);

  const verMenus = singleSelectButton(
    "🔰 Ver Menus 🔰",
    buildMainMenuSections(categories),
    { title: "Ver Menus" },
  );

  if (verMenus) {
    botoes.push(verMenus);
  }

  if (channelUrl) {
    botoes.push({
      name: "cta_url",
      buttonParamsJson: JSON.stringify({
        display_text: "📢 Canal",
        url: channelUrl,
      }),
    });
  }

  return botoes;
}

/**
 * Cabeçalho: URL https passa direto; caminho local é lido para Buffer.
 * Qualquer falha devolve null (card segue sem imagem).
 */
export function loadMainMenuImage(source = MAIN_MENU_IMAGE) {
  const valor = String(source || "").trim();
  if (!valor) return null;

  if (/^https?:\/\//i.test(valor)) {
    return { url: valor };
  }

  try {
    return fs.readFileSync(valor);
  } catch (error) {
    errorLog(`[menu] imagem não encontrada em "${valor}": ${error.message}`);
    return null;
  }
}

function buildTextFallback({ body, categorias, ownerNumber, channelUrl }) {
  const linhas = ["📚 *Categorias*"];

  categorias.forEach((categoria, index) => {
    linhas.push(`${index + 1}. ${categoria.icone} ${categoria.titulo}`);
  });

  const dono = mainMenuOwnerUrl(ownerNumber);
  if (dono) linhas.push("", `👑 *Dono:* ${dono}`);
  if (channelUrl) linhas.push(`📢 *Canal:* ${channelUrl}`);

  linhas.push("", "Responde com o número 👇");

  return `${body}\n\n${linhas.join("\n")}`;
}

/**
 * Envia o menu principal e regista a sessão (TTL de 2 min + ownership).
 *
 * @param {object} socket socket do Baileys
 * @param {string} chatId JID do chat
 * @param {object} ctx { ownerId, ownerName, sendReply, webMessage, permissions, timestamp, now }
 * @returns {Promise<boolean>} true se algum formato foi enviado
 */
export async function sendMainMenu(socket, chatId, ctx = {}) {
  const {
    ownerId,
    ownerName,
    sendReply,
    webMessage,
    permissions,
    timestamp = webMessage?.messageTimestamp,
    now = Date.now(),
  } = ctx;

  const session = await openGuidedSession({
    socket,
    chatId,
    ownerId,
    ownerName,
    sendReply,
    permissions,
    webMessage,
  });

  if (!session) {
    await sendReply?.(
      "🚫 Não consegui confirmar quem fez o pedido. Envia o comando novamente.",
    ).catch(() => {});
    return false;
  }

  const relogio = mainMenuClock(new Date(now));
  const body = buildMainMenuBody({
    usuario: session.ownerName,
    data: relogio.data,
    hora: relogio.hora,
    diaSemana: relogio.diaSemana,
    velocidade: mainMenuVelocity(timestamp, now),
  });

  const categorias = listCategories(session.permissions);
  const options = categorias.map((categoria, index) => ({
    number: String(index + 1),
    title: `${categoria.icone} ${categoria.titulo}`,
    id: `cat:${categoria.id}`,
  }));

  const interactiveButtons = buildMainMenuButtons({ categories: categorias });
  const mentions = session.ownerId !== chatId ? [session.ownerId] : undefined;

  const cards = [];
  const imagem = loadMainMenuImage();

  if (imagem) {
    cards.push({
      formato: "card interativo (imagem)",
      content: {
        image: imagem,
        caption: body,
        footer: MAIN_MENU_FOOTER,
        interactiveButtons,
        mentions,
      },
    });
  }

  cards.push({
    formato: "card interativo (sem imagem)",
    content: {
      text: body,
      footer: MAIN_MENU_FOOTER,
      interactiveButtons,
      mentions,
    },
  });

  for (const card of cards) {
    try {
      await socket.sendMessage(chatId, card.content);
      session.cardFallback = false;
      registerGuidedOptions(session, options);
      infoLog(`[menu] ${card.formato} enviado`);
      return true;
    } catch (error) {
      errorLog(
        `[menu] falha ao enviar ${card.formato}: ${error.message || error}`,
      );
    }
  }

  // Lista clássica (listMessage): útil quando o cliente não renderiza nativeFlow.
  try {
    await socket.sendMessage(chatId, {
      text: body,
      title: "Menu",
      footer: MAIN_MENU_FOOTER,
      buttonText: "Abrir categoria",
      sections: buildMainMenuSections(categorias).map((secao) => ({
        title: secao.title,
        rows: secao.rows.map(({ id, title, description }) => ({
          title,
          description,
          rowId: id,
        })),
      })),
      mentions,
    });
    session.cardFallback = true;
    registerGuidedOptions(session, options);
    infoLog("[menu] lista clássica enviada");
    return true;
  } catch (error) {
    errorLog(
      `[menu] falha ao enviar lista clássica: ${error.message || error}`,
    );
  }

  // Último recurso: mesmo visual em texto + categorias numeradas.
  try {
    await sendReply(
      buildTextFallback({
        body,
        categorias,
        ownerNumber: MAIN_MENU_OWNER_NUMBER,
        channelUrl: MAIN_MENU_CHANNEL_URL,
      }),
      mentions,
    );
    session.cardFallback = true;
    registerGuidedOptions(session, options);
    infoLog("[menu] fallback em texto enviado");
    return true;
  } catch (error) {
    errorLog(`[menu] falha no fallback em texto: ${error.message || error}`);
  }

  return false;
}
