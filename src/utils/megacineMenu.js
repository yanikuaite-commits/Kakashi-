/**
 * Fluxo do Megacine (séries, doramas e animes episódicos) — comando `.megacine`.
 *
 * Passos:
 *   1. o utilizador escreve `.megacine <nome>` → o bot pesquisa e lista os
 *      resultados (`rowId` `mgc:an:<índice>`), 20 por página, com uma capa
 *      (pôster TMDB da ficha do site) e uma linha `mgc:pg2:<página>` "ver mais"
 *      quando há mais resultados;
 *   2. escolhido o título, pergunta a FAIXA (dublado/legendado) quando a fonte
 *      publica as duas (`rowId` `mgc:aud:<faixa>`); com uma só faixa, salta o
 *      passo;
 *   3. lista as temporadas (`rowId` `mgc:sea:<índice>`) — só quando há mais de
 *      uma, senão salta direto para os episódios, porque uma escolha de um item
 *      só seria ruído;
 *   4. escolhida a temporada, lista os episódios (`rowId` `mgc:ep:<índice>`),
 *      paginados, com um botão `mgc:pg:<página>` no fundo;
 *   5. escolhido o episódio, baixa e envia — na faixa escolhida, caindo para a
 *      que existe quando o episódio não tem a pedida (avisa em vez de trocar em
 *      silêncio).
 *
 * FILMES também entram (a pesquisa devolve-os com `tipo: "filme"`). Um filme não
 * tem temporadas nem episódios, por isso segue um caminho curto:
 * faixa (`mgc:fil:<faixa>`) → qualidade de compressão (`mgc:q:<altura>`) →
 * baixar → comprimir → enviar. A compressão é obrigatória: o original tem 1,2 a
 * 5,5 GB (medido) e nunca caberia no teto de envio. O dono pode voltar a
 * excluí-los com `MEGACINE_TIPOS_EXCLUIDOS=filmes`.
 *
 * NÃO há passo de qualidade nas SÉRIES, ao contrário dos animes: o Saimo publica
 * UMA só qualidade por episódio (um MP4 direto, sem degraus), por isso pedir uma
 * escolha que não existe seria um passo a fingir. O teto de tamanho continua a
 * aplicar-se no download.
 *
 * As linhas guardam apenas índices (`mgc:ep:0`) porque o `rowId` do WhatsApp
 * tem limite de tamanho; os slugs e URLs reais ficam na sessão.
 *
 * @author Dev Yanik
 */
import fs from "node:fs";
import {
  FILME_COMPRESS_HEIGHTS,
  FILME_MAX_DOWNLOAD_BYTES,
  FILME_MAX_SEND_BYTES,
  MEGACINE_DOWNLOAD_CREDITS,
  MEGACINE_MAX_DOWNLOAD_BYTES,
  OWNER_LID,
} from "../config.js";
import {
  getEpisodeStream,
  getFilmeInfo,
  getFilmeStream,
  getSeasons,
  megacineDownloadArgs,
  primeiroAlcancavel,
  search,
} from "../services/saimo.js";
import { downloadWithYtDlp, isYtDlpAvailable } from "../services/ytdlp.js";
import { withDownloadSlot } from "../services/downloadQueue.js";
import {
  chargeCredits,
  creditsExhaustedMessage,
  hasSufficientCredits,
  refundCredits,
  withCreditsContext,
} from "../services/credits.js";
import { mediaUploadFromFile, safeMediaFileName } from "./mediaSend.js";
import { prepareImageForWhatsApp, comprimirVideo, withPreparedVideo } from "../services/mediaPrepare.js";
import { RODAPE, mediaCaption } from "./formatMessage.js";
import {
  AUDIO_DUBBED,
  AUDIO_SUBBED,
  AUDIO_VERSIONS,
  EPISODES_PER_PAGE,
  animeSessionKey,
  audioVersionLabel,
  availableAudioVersions,
  buildAudioRows,
  buildNextPageRow,
  jidIdentities,
  identitiesOverlap,
} from "./animeFormat.js";
import {
  INTERACTIVE_MENU_TTL_MS,
  numberedFallback,
  ownerButton,
  sendInteractiveWithFallback,
  singleSelectButton,
} from "./interactive.js";
import { errorLog, infoLog } from "./logger.js";
import { animeTooLargeMessage, decideAnimeSend } from "./mediaSend.js";

export const MEGACINE_TTL_MS = INTERACTIVE_MENU_TTL_MS;

const CANCEL_TOKEN = "mgc:cancel";

/** Quantos resultados de pesquisa aparecem por página. */
const RESULTS_PER_PAGE = 20;

/** Teto de resultados recolhidos por pesquisa (alimenta a paginação). */
const MAX_RESULTS = 60;

/** Prefixos de token tratados por este fluxo (usado no despacho do middleware). */
export const MEGACINE_TOKEN_PREFIXES = [
  "mgc:an:",
  "mgc:sea:",
  "mgc:aud:",
  "mgc:fil:",
  "mgc:q:",
  "mgc:ep:",
  "mgc:pg:",
  "mgc:pg2:",
  CANCEL_TOKEN,
];

/** Sessões por `${chatId}:${ownerId}`. */
const sessoesMegacine = new Map();

function sanitizeName(value) {
  return String(value || "")
    .replace(/[\r\n*_`@]/g, "")
    .slice(0, 32);
}

function getOwnerId(chatId, ownerLid) {
  if (ownerLid) return ownerLid;
  return chatId.endsWith("@g.us") ? "" : chatId;
}

/** Compara identidades por dígitos — a mesma pessoa chega com formas de JID diferentes. */
function isSessionOwner(session, ...senderJids) {
  const autor = session?.identidades;
  if (!autor?.size) return true;

  const quem = jidIdentities(...senderJids);
  if (!quem.size) return true;

  return identitiesOverlap(autor, quem);
}

function dropSession(session) {
  if (!session) return;
  if (sessoesMegacine.get(session.key) === session) sessoesMegacine.delete(session.key);
  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
  }
}

function touch(session) {
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  session.cleanupTimer = setTimeout(() => {
    if (sessoesMegacine.get(session.key) !== session) return;
    dropSession(session);
    session
      .sendReply?.("⏳ O tempo do menu do Saimo TV terminou. Envia .menu para recomeçar.")
      .catch(() => {});
  }, MEGACINE_TTL_MS);
  session.cleanupTimer.unref?.();
}

function findSessionInChat(chatId, senderJids = []) {
  let primeiro = null;

  for (const session of sessoesMegacine.values()) {
    if (session.chatId !== chatId) continue;
    if (!primeiro) primeiro = session;
    if (senderJids.length && isSessionOwner(session, ...senderJids)) return session;
  }

  return primeiro;
}

/** Introspeção usada nos testes. */
export function getMegacineSession(chatId, ownerId) {
  return sessoesMegacine.get(animeSessionKey(chatId, ownerId)) || null;
}

/** Limpa todas as sessões (usado nos testes). */
export function resetMegacineSessions() {
  for (const session of sessoesMegacine.values()) {
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  }
  sessoesMegacine.clear();
}

function ensureSession({
  chatId,
  ownerId,
  ownerName,
  sendReply,
  sendVideoFromFile,
  senderLids = [],
  textOnly = false,
}) {
  const key = animeSessionKey(chatId, ownerId);
  let session = sessoesMegacine.get(key);

  const identidades = jidIdentities(ownerId, ...senderLids);

  if (!session) {
    session = {
      key,
      chatId,
      ownerId,
      identidades,
      ownerName: sanitizeName(ownerName) || "dono do pedido",
      sendReply,
      sendVideoFromFile,
      stage: "idle",
      title: null,
      seasons: [],
      seasonNumber: 0,
      episodes: [],
      page: 0,
      episode: null,
      filme: false,
      audioVersion: "",
      audioVersions: [],
      allCandidates: [],
      resultPage: 0,
      lastRows: [],
      textOnly: Boolean(textOnly),
      cleanupTimer: null,
    };
    sessoesMegacine.set(key, session);
  } else {
    if (sendReply) session.sendReply = sendReply;
    if (typeof sendVideoFromFile === "function") session.sendVideoFromFile = sendVideoFromFile;
    if (ownerName) session.ownerName = sanitizeName(ownerName);
    session.textOnly = Boolean(textOnly);
    for (const identidade of identidades) session.identidades.add(identidade);
  }

  touch(session);
  return session;
}

function cancelRow() {
  return {
    id: CANCEL_TOKEN,
    title: "❌ Cancelar",
    description: "Sair do menu do Saimo TV",
  };
}

function buildCandidateRows(candidatos = [], page = 0) {
  const inicio = page * RESULTS_PER_PAGE;

  return candidatos.slice(inicio, inicio + RESULTS_PER_PAGE).map((item, offset) => ({
    id: `mgc:an:${inicio + offset}`,
    title: String(item.title || item.slug).slice(0, 60),
    // Filme e série partilham a lista: o rótulo diz qual é qual, senão um filme
    // pareceria uma série sem episódios. O ano desempata títulos iguais.
    description: [item.tipo === "filme" ? "🎬 Filme" : "📺 Série", item.year]
      .filter(Boolean)
      .join(" · "),
  }));
}

/** Linha "ver mais resultados" quando há uma página seguinte na pesquisa. */
function buildMoreResultsRow(pagina, totalPaginas) {
  if (pagina + 1 >= totalPaginas) return [];
  return [
    {
      id: `mgc:pg2:${pagina + 1}`,
      title: "🔎 Ver mais resultados",
      description: `Página ${pagina + 2} de ${totalPaginas}`,
    },
  ];
}

function buildSeasonRows(seasons = []) {
  return seasons.map((temporada, index) => ({
    id: `mgc:sea:${index}`,
    title: `Temporada ${temporada.number}`.slice(0, 60),
    description: `${temporada.episodes.length} episódio${
      temporada.episodes.length === 1 ? "" : "s"
    }`,
  }));
}

function buildEpisodeRows(episodes = [], page = 0) {
  const inicio = page * EPISODES_PER_PAGE;

  return episodes.slice(inicio, inicio + EPISODES_PER_PAGE).map((episode, offset) => {
    const index = inicio + offset;
    return {
      id: `mgc:ep:${index}`,
      title: `Episódio ${episode.number}`.slice(0, 60),
      description: "Ver e baixar",
    };
  });
}

/** Linhas de faixa de um filme (`mgc:fil:<faixa>`). */
function buildFilmeAudioRows(faixas = []) {
  return faixas.map((faixa) => ({
    id: `mgc:fil:${faixa}`,
    title: audioVersionLabel(faixa),
    description: "Escolher esta faixa",
  }));
}

/**
 * Linhas de qualidade da compressão (`mgc:q:<altura>`).
 *
 * A altura-alvo é uma escolha de COMPRESSÃO, não da fonte (a fonte só publica
 * um ficheiro grande): o utilizador aceita perder qualidade para caber no
 * envio. Por isso o rótulo diz "comprimir para", e não "qualidade".
 */
function buildQualityRows(alturas = FILME_COMPRESS_HEIGHTS) {
  return alturas.map((altura) => ({
    id: `mgc:q:${altura}`,
    title: `${altura}p`,
    description: altura <= 480 ? "Mais leve" : "Melhor imagem",
  }));
}

async function sendCard({ socket, session, text, title, rows, fallbackPrompt, image = null }) {
  const sections = [{ title: title || "Saimo TV", rows }];
  const options = rows.map((row, index) => ({
    number: String(index + 1),
    title: row.title,
    id: row.id,
  }));

  const buttons = [];
  const lista = singleSelectButton("📂 Opções", sections, { title: title || "Saimo TV" });
  if (lista) buttons.push(lista);
  const dono = ownerButton();
  if (dono) buttons.push(dono);

  const sent = await (async () => {
    // A capa do Megacine vem em WebP, que o WhatsApp não renderiza (e o jimp do
    // Baileys não descodifica): é convertida antes de sair — ver
    // `mediaPrepare.js`. O ficheiro convertido é temporário.
    const capa = await prepareImageForWhatsApp(image);

    try {
      return await sendInteractiveWithFallback({
        socket,
        chatId: session.chatId,
        content: {
          // Com capa o corpo tem de ir em `caption`: com `text` o baileys
          // constrói uma mensagem de texto e descarta a imagem do cabeçalho.
          ...(capa.image ? { caption: text, image: { url: capa.image } } : { text }),
          footer: RODAPE,
          interactiveButtons: buttons,
          viewOnce: true,
        },
        fallbackText: numberedFallback(
          options,
          fallbackPrompt || "Responde com o número 👇",
        ),
        sendReply: session.sendReply,
        textOnly: Boolean(session.textOnly),
        onSendError: (error) =>
          errorLog(`[megacine] falha ao enviar card: ${error.message}`),
      });
    } finally {
      if (capa.temporary) {
        await fs.promises.rm(capa.image, { force: true }).catch(() => {});
      }
    }
  })();

  // Guarda as linhas do último card: no modo texto um número respondido vale a
  // linha nessa posição, sem lógica duplicada por passo.
  if (sent) session.lastRows = rows;
  if (!sent) dropSession(session);

  return Boolean(sent);
}

/* ═══════════ PASSO 1 · PESQUISAR ═══════════ */

/**
 * Abre o fluxo: pesquisa o termo e lista os resultados.
 *
 * @returns {Promise<boolean>}
 */
export async function startMegacineFlow({
  socket,
  chatId,
  ownerLid,
  ownerName,
  sendReply,
  sendVideoFromFile,
  senderLids = [],
  nome = "",
  textOnly = false,
}) {
  const ownerId = getOwnerId(chatId, ownerLid);
  const session = ensureSession({
    chatId,
    ownerId,
    ownerName,
    sendReply,
    sendVideoFromFile,
    senderLids,
    textOnly,
  });

  const termo = String(nome || "").trim();

  if (termo.length < 2) {
    session.stage = "aguardando_nome";
    touch(session);

    return sendCard({
      socket,
      session,
      text:
        `📺 *SAIMO TV*\n\n` +
        `Escreve o nome da série ou do filme que queres ver.\n\n` +
        `_Ex.: .megacine the boys_`,
      title: "Saimo TV",
      rows: [cancelRow()],
      fallbackPrompt: "Escreve o nome no chat 👇",
    });
  }

  return searchAndSendResults({ socket, session, termo });
}

async function searchAndSendResults({ socket, session, termo }) {
  session.stage = "buscando";
  touch(session);
  await session.sendReply(`🔎 Procurando "${sanitizeName(termo)}"...`).catch(() => {});

  let resultados;

  try {
    resultados = await search(termo, MAX_RESULTS);
  } catch (error) {
    dropSession(session);
    errorLog(`[megacine] falha na pesquisa: ${error.message}`);
    await session
      .sendReply("❌ Não consegui pesquisar agora. Tenta novamente em instantes.")
      .catch(() => {});
    return true;
  }

  if (!resultados.length) {
    dropSession(session);
    await session
      .sendReply(
        `❌ Não encontrei nada para "${sanitizeName(termo)}".\n` +
          `Tenta o título em português ou em inglês.`,
      )
      .catch(() => {});
    return true;
  }

  // Guarda a lista COMPLETA: `buildCandidateRows` fatia por página, e os `rowId`
  // usam o índice ABSOLUTO da lista, para "ver mais" continuar a apontar certo.
  session.allCandidates = resultados;
  session.resultPage = 0;
  session.termo = sanitizeName(termo);
  session.stage = "candidatos";

  infoLog(`[megacine] "${termo}": ${resultados.length} resultados`);

  return sendResultsPage({ socket, session, page: 0 });
}

/** Envia uma página da lista de resultados (20 por página, com "ver mais"). */
async function sendResultsPage({ socket, session, page }) {
  const total = session.allCandidates?.length || 0;
  const totalPaginas = Math.max(1, Math.ceil(total / RESULTS_PER_PAGE));
  const pagina = Math.min(Math.max(0, page), totalPaginas - 1);

  session.resultPage = pagina;
  session.stage = "candidatos";
  // Fatia da página atual, só para introspeção: a escolha (`mgc:an:<índice>`) e
  // as linhas usam a lista COMPLETA, cujo índice é absoluto.
  session.candidates = session.allCandidates.slice(
    pagina * RESULTS_PER_PAGE,
    pagina * RESULTS_PER_PAGE + RESULTS_PER_PAGE,
  );
  touch(session);

  const rows = buildCandidateRows(session.allCandidates, pagina);
  rows.push(...buildMoreResultsRow(pagina, totalPaginas));
  rows.push(cancelRow());

  return sendCard({
    socket,
    session,
    text:
      `🎬 *SAIMO TV*\n\n` +
      `🔎 *Procura:* ${session.termo || "—"}\n` +
      `📚 *Resultados:* ${total}` +
      (totalPaginas > 1 ? `  ·  página ${pagina + 1}/${totalPaginas}` : "") +
      `\n\nEscolhe o título que queres ver.`,
    title: "Resultados",
    rows,
    // Capa do primeiro resultado da página: mostra de que título se trata antes
    // de o utilizador escolher da lista.
    image: session.allCandidates[pagina * RESULTS_PER_PAGE]?.image || null,
  });
}

/* ═══════════ PASSO 2 · TÍTULO (faixa de áudio) ═══════════ */

async function chooseCandidate({ socket, session, index }) {
  const candidato = session.allCandidates?.[index];

  if (!candidato?.slug) {
    dropSession(session);
    await session
      .sendReply("❌ Essa opção não está mais disponível. Envia .menu para recomeçar.")
      .catch(() => {});
    return true;
  }

  session.stage = "temporadas";
  touch(session);
  await session.sendReply(`📺 Abrindo "${candidato.title}"...`).catch(() => {});

  // FILME: não tem temporadas nem episódios, por isso o fluxo é outro
  // (faixa → qualidade → comprimir → enviar). Detetado pelo tipo da pesquisa.
  if (candidato.tipo === "filme") {
    return abrirFilme({ socket, session, candidato });
  }

  let seasons;

  try {
    const resultado = await getSeasons(candidato.slug);
    seasons = resultado.seasons;
  } catch (error) {
    dropSession(session);
    errorLog(`[megacine] falha nas temporadas: ${error.message}`);
    await session
      .sendReply("❌ Não consegui abrir este título agora. Tenta novamente.")
      .catch(() => {});
    return true;
  }

  if (!seasons.length) {
    dropSession(session);
    await session
      .sendReply("❌ Este título não tem episódios disponíveis na fonte.")
      .catch(() => {});
    return true;
  }

  session.title = candidato;
  session.seasons = seasons;
  session.audioVersion = "";
  session.audioVersions = availableAudioVersions(
    seasons.flatMap((t) => t.episodes || []),
  );

  // A fonte publica as DUAS faixas: pergunta antes de listar as temporadas, para
  // o download já sair com a faixa certa. Uma só faixa (ou nenhuma) fica fixada
  // sozinha, sem incomodar o utilizador com uma escolha que não existe.
  if (session.audioVersions.length > 1) {
    return askAudioVersion({ socket, session });
  }

  session.audioVersion = session.audioVersions[0] || "";
  return openSeasons({ socket, session });
}

/**
 * Pergunta a faixa (Dublado / Legendado) quando o título publica as duas.
 *
 * @returns {Promise<boolean>}
 */
async function askAudioVersion({ socket, session }) {
  session.stage = "faixas";
  touch(session);

  const rows = [...buildAudioRows(session.audioVersions), cancelRow()];

  return sendCard({
    socket,
    session,
    text:
      `🎬 *${session.title?.title || "Saimo TV"}*\n\n` +
      `🔊 Este título tem *dublado* e *legendado*.\n` +
      `Escolhe a faixa que queres baixar.`,
    title: "Áudio",
    rows,
    image: session.title?.image || null,
  });
}

/**
 * Aplica a faixa escolhida e segue para as temporadas.
 *
 * Valida contra as faixas PUBLICADAS: um token forjado (ou de uma versão antiga
 * do site) não pode fixar uma faixa inexistente.
 *
 * @returns {Promise<boolean>}
 */
async function chooseAudioVersion({ socket, session, version }) {
  const disponiveis = session.audioVersions || [];

  if (!AUDIO_VERSIONS.includes(version) || !disponiveis.includes(version)) {
    dropSession(session);
    await session
      .sendReply("❌ Essa faixa já não está disponível. Envia .menu para recomeçar.")
      .catch(() => {});
    return true;
  }

  session.audioVersion = version;
  infoLog(`[megacine] faixa escolhida: ${version}`);

  return openSeasons({ socket, session });
}

/** Lista as temporadas (ou salta para os episódios quando há uma só). */
async function openSeasons({ socket, session }) {
  // Uma temporada única não tem escolha a fazer: seguir direto evita um passo
  // com uma opção só (ex.: `duna-a-profecia-dublado`, 1 temporada com 6 eps).
  if (session.seasons.length === 1) {
    return chooseSeason({ socket, session, index: 0 });
  }

  const rows = buildSeasonRows(session.seasons);
  rows.push(cancelRow());

  infoLog(
    `[megacine] "${session.title?.title}": ${session.seasons.length} temporadas`,
  );

  return sendCard({
    socket,
    session,
    text:
      `🎬 *${session.title?.title || "Saimo TV"}*\n\n` +
      `📺 Escolhe a temporada que queres ver.`,
    title: "Temporadas",
    rows,
    // Capa do título escolhido: confirma visualmente que abriu o título certo
    // antes de listar as temporadas.
    image: session.title?.image || null,
  });
}

/* ═══════════ FILME (download único + compressão) ═══════════ */

/**
 * Abre um filme: pergunta a faixa (se houver escolha) e depois a qualidade.
 *
 * Um filme não tem temporadas nem episódios, por isso salta os passos 2 e 3 do
 * fluxo das séries. O que sobra é o que importa para um ficheiro grande: QUE
 * faixa (dublado/legendado) e QUE altura de compressão (o original tem 1,2 a
 * 5,5 GB e não cabe no envio).
 *
 * @returns {Promise<boolean>}
 */
async function abrirFilme({ socket, session, candidato }) {
  let info;

  try {
    info = await getFilmeInfo(candidato.slug);
  } catch (error) {
    dropSession(session);
    errorLog(`[megacine] falha ao abrir o filme: ${error.message}`);
    await session.sendReply("❌ Não consegui abrir este filme agora. Tenta novamente.").catch(() => {});
    return true;
  }

  session.title = candidato;
  session.filme = true;
  session.audioVersion = "";
  session.audioVersions = info.faixas || [];

  // Com as duas faixas, pergunta; com uma só, fixa-a sem incomodar.
  if (session.audioVersions.length > 1) {
    session.stage = "faixas";
    touch(session);

    const rows = [...buildFilmeAudioRows(session.audioVersions), cancelRow()];

    return sendCard({
      socket,
      session,
      text:
        `🎬 *${candidato.title}*\n\n` +
        `🔊 Este filme tem *dublado* e *legendado*.\n` +
        `Escolhe a faixa que queres.`,
      title: "Áudio",
      rows,
      image: candidato.image || null,
    });
  }

  session.audioVersion = session.audioVersions[0] || "";
  return askQuality({ socket, session });
}

/**
 * Pergunta a qualidade da compressão.
 *
 * O original NÃO é oferecido: ele não cabe no envio (medido, 1,2 a 5,5 GB), por
 * isso seria uma opção que falha no fim de um download de vários minutos.
 *
 * @returns {Promise<boolean>}
 */
async function askQuality({ socket, session }) {
  session.stage = "qualidade";
  touch(session);

  const rows = [...buildQualityRows(), cancelRow()];

  return sendCard({
    socket,
    session,
    text:
      `🎬 *${session.title?.title || "Saimo TV"}*\n\n` +
      `🗜️ O ficheiro original é grande (mais de 1 GB).\n` +
      `Escolhe a qualidade para comprimir antes de enviar.\n\n` +
      `_720p mantém boa imagem; 480p gera o ficheiro mais leve._`,
    title: "Qualidade",
    rows,
    image: session.title?.image || null,
  });
}

/**
 * Aplica a faixa escolhida num filme e segue para a qualidade.
 *
 * @returns {Promise<boolean>}
 */
async function chooseFilmeAudio({ socket, session, version }) {
  const disponiveis = session.audioVersions || [];

  if (!AUDIO_VERSIONS.includes(version) || !disponiveis.includes(version)) {
    dropSession(session);
    await session
      .sendReply("❌ Essa faixa já não está disponível. Envia .menu para recomeçar.")
      .catch(() => {});
    return true;
  }

  session.audioVersion = version;
  return askQuality({ socket, session });
}

/**
 * Baixa o filme, comprime para a altura pedida e envia.
 *
 * A compressão acontece DEPOIS do download e ANTES do envio, porque o original
 * nunca cabe. Se a compressão falhar (sem ffmpeg, timeout), o original é
 * enviado quando couber no teto de envio; se não couber, o utilizador é avisado
 * e os créditos devolvidos.
 *
 * @returns {Promise<boolean>}
 */
async function baixarFilme({ socket, session, altura, sendVideoFromFile }) {
  const titulo = session.title?.title || "Saimo TV";
  const nomeArquivo = safeMediaFileName(titulo);
  session.stage = "baixando";
  touch(session);

  let stream;

  try {
    stream = await getFilmeStream(session.title.slug, session.audioVersion || "");
  } catch (error) {
    dropSession(session);
    errorLog(`[megacine] falha ao resolver o filme: ${error.message}`);
    await session.sendReply(`❌ ${error.message}`).catch(() => {});
    return true;
  }

  const faixaPedida = session.audioVersion || "";
  const faixaServida = stream.faixa || "";
  if (faixaPedida && faixaServida && faixaServida !== faixaPedida) {
    await session
      .sendReply(
        `⚠️ Este filme não tem ${audioVersionLabel(faixaPedida).toLowerCase()}. ` +
          `Vou enviar ${audioVersionLabel(faixaServida).toLowerCase()}.`,
      )
      .catch(() => {});
  }
  session.audioVersion = faixaServida || faixaPedida;

  const candidatos = stream.candidatos?.length ? stream.candidatos : [stream.url];
  const alcancavel = await primeiroAlcancavel(candidatos, stream.referer);
  if (!alcancavel) {
    dropSession(session);
    await session
      .sendReply("❌ A fonte não respondeu a este filme agora. Tenta novamente em instantes.")
      .catch(() => {});
    return true;
  }
  if (alcancavel !== stream.url) {
    infoLog("[megacine] primeiro candidato falhou; a usar um alternativo");
    stream.url = alcancavel;
  }

  const contaId = session.ownerId;
  const cobrar = contaId && contaId !== OWNER_LID;

  if (cobrar) {
    const saldo = hasSufficientCredits(contaId, MEGACINE_DOWNLOAD_CREDITS);
    if (!saldo.ok) {
      dropSession(session);
      await session
        .sendReply(
          creditsExhaustedMessage({
            commandName: "megacine",
            cost: MEGACINE_DOWNLOAD_CREDITS,
            account: saldo.account,
          }),
        )
        .catch(() => {});
      return true;
    }
  }

  dropSession(session);
  await session
    .sendReply(`⬇️ Baixando "${titulo}"... (o ficheiro é grande, isto demora)`)
    .catch(() => {});

  if (!(await isYtDlpAvailable())) {
    await session
      .sendReply("❌ O yt-dlp não está disponível neste servidor, então não consigo baixar.")
      .catch(() => {});
    return true;
  }

  let result;
  let comprimido = null;
  let pago = 0;

  try {
    if (cobrar) {
      const charge = chargeCredits(contaId, MEGACINE_DOWNLOAD_CREDITS, {
        reason: "megacine:filme",
        countUsage: true,
      });

      if (!charge.ok) {
        await session
          .sendReply(
            creditsExhaustedMessage({
              commandName: "megacine",
              cost: MEGACINE_DOWNLOAD_CREDITS,
              account: charge.account,
            }),
          )
          .catch(() => {});
        return true;
      }

      pago = charge.charged;
    }

    result = await withCreditsContext(session.ownerId, () =>
      withDownloadSlot(
        () =>
          downloadWithYtDlp(stream.url, {
            height: "best",
            maxBytes: FILME_MAX_DOWNLOAD_BYTES,
            extraArgs: megacineDownloadArgs(stream.referer),
          }),
        { priority: session.ownerId === OWNER_LID },
      ),
    );

    const tamanhoMB = result.fileSize / (1024 * 1024);
    infoLog(`[megacine] filme baixado: ${tamanhoMB.toFixed(0)} MB`);

    // Comprimir é a razão de existir deste fluxo: sem isto o ficheiro não cabe.
    await session
      .sendReply(`🗜️ Comprimindo para ${altura}p... isto pode levar alguns minutos.`)
      .catch(() => {});

    comprimido = await comprimirVideo(result.filePath, { height: altura });

    const ficheiroEnvio = comprimido?.filePath || result.filePath;
    const { size: tamanhoEnvio } = await fs.promises.stat(ficheiroEnvio);
    const envioMB = tamanhoEnvio / (1024 * 1024);
    const acao = decideAnimeSend(tamanhoEnvio, {
      documentLimitMb: FILME_MAX_SEND_BYTES / (1024 * 1024),
    });

    const caption = megacineCaption({
      titulo,
      duracao: result.durationString,
      faixa: session.audioVersion || "",
      altura: comprimido?.height || 0,
    });

    if (acao === "cancel") {
      infoLog(`[megacine] filme cancelado: ${envioMB.toFixed(0)} MB acima do limite`);
      await session
        .sendReply(
          `❌ Mesmo comprimido para ${altura}p o ficheiro ficou com ` +
            `${envioMB.toFixed(0)} MB, acima do limite de envio. ` +
            `Tenta uma qualidade mais baixa.`,
        )
        .catch(() => {});
      return true;
    }

    if (acao === "document") {
      infoLog(`[megacine] filme como documento (${envioMB.toFixed(0)} MB)`);
      await socket.sendMessage(session.chatId, {
        document: mediaUploadFromFile(ficheiroEnvio),
        mimetype: "video/mp4",
        fileName: nomeArquivo,
        caption,
      });
    } else {
      await withPreparedVideo(ficheiroEnvio, async (filePath) => {
        infoLog(`[megacine] filme como vídeo (${envioMB.toFixed(0)} MB)`);
        if (typeof sendVideoFromFile === "function") {
          await sendVideoFromFile(filePath, caption);
        } else {
          await socket.sendMessage(session.chatId, {
            video: mediaUploadFromFile(filePath),
            mimetype: "video/mp4",
            caption,
          });
        }
      });
    }
  } catch (error) {
    errorLog(`[megacine] falha no filme: ${error.message}`);

    if (pago > 0) {
      refundCredits(contaId, pago);
      pago = 0;
    }

    await session.sendReply(`❌ Não consegui baixar: ${error.message}`).catch(() => {});
  } finally {
    if (comprimido?.filePath) {
      await fs.promises.rm(comprimido.filePath, { force: true }).catch(() => {});
    }
    if (result?.filePath) {
      await fs.promises.rm(result.filePath, { force: true }).catch(() => {});
    }
  }

  return true;
}

/* ═══════════ PASSO 3 · EPISÓDIOS ═══════════ */

async function chooseSeason({ socket, session, index }) {
  const temporada = session.seasons[index];

  if (!temporada) {
    dropSession(session);
    await session
      .sendReply("❌ Essa temporada não está mais disponível. Envia .menu para recomeçar.")
      .catch(() => {});
    return true;
  }

  session.seasonNumber = temporada.number;
  session.episodes = temporada.episodes;
  session.page = 0;
  session.stage = "episodios";

  // Um título de um só episódio não tem escolha a fazer: seguir direto evita um
  // passo com uma opção só (ex.: uma série de episódio único).
  if (temporada.episodes.length === 1 && session.seasons.length === 1) {
    return downloadAndSend({
      socket,
      session,
      episodeIndex: 0,
      sendVideoFromFile: session.sendVideoFromFile,
    });
  }

  return sendEpisodePage({ socket, session, page: 0 });
}

async function sendEpisodePage({ socket, session, page }) {
  const totalPaginas = Math.max(
    1,
    Math.ceil(session.episodes.length / EPISODES_PER_PAGE),
  );
  const pagina = Math.min(Math.max(0, page), totalPaginas - 1);

  session.page = pagina;
  session.stage = "episodios";
  touch(session);

  const rows = buildEpisodeRows(session.episodes, pagina);
  rows.push(...buildNextPageRow(pagina, totalPaginas));
  rows.push(cancelRow());

  return sendCard({
    socket,
    session,
    text:
      `🎬 *${session.title?.title || "Saimo TV"}*\n\n` +
      `📺 *Temporada ${session.seasonNumber}*\n` +
      `🎞️ *Episódios:* ${session.episodes.length}\n\n` +
      `Escolhe o episódio para baixar.`,
    title: "Episódios",
    rows,
    // Mesma capa do passo anterior: a lista continua a confirmar o título aberto.
    image: session.title?.image || null,
  });
}

/* ═══════════ PASSO 4 · BAIXAR E ENVIAR ═══════════ */

/**
 * Legenda do vídeo enviado.
 *
 * O Megacine publica UMA só qualidade (playlist de segmentos, sem degraus), por
 * isso não há altura a anunciar: `mediaCaption` escreve "Melhor disponível" em
 * vez de um número inventado. É exportada para o teste cobrir o texto que o
 * utilizador recebe.
 *
 * @param {{titulo?: string, duracao?: string}} [props]
 * @returns {string}
 */
export function megacineCaption({ titulo, duracao, faixa, altura } = {}) {
  const extra = [
    faixa ? `🔊 ${audioVersionLabel(faixa)}` : "",
    altura ? `🗜️ ${altura}p` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return mediaCaption({
    titulo,
    canal: "Saimo TV",
    duracao: duracao || "Não disponível",
    extra,
  });
}

async function downloadAndSend({ socket, session, episodeIndex, sendVideoFromFile }) {
  const episode = session.episodes[episodeIndex];

  if (!episode) {
    dropSession(session);
    await session
      .sendReply("❌ Esse episódio não está mais disponível. Envia .menu para recomeçar.")
      .catch(() => {});
    return true;
  }

  const titulo = session.title?.title || "Saimo TV";
  const rotulo =
    session.seasons.length === 1 && session.episodes.length === 1
      ? titulo
      : `${titulo} — T${session.seasonNumber} Ep. ${episode.number}`;
  const nomeArquivo = safeMediaFileName(rotulo);

  session.stage = "baixando";

  let stream;

  try {
    stream = await getEpisodeStream(
      session.title.slug,
      session.seasonNumber,
      episode.number,
      session.audioVersion || "",
    );
  } catch (error) {
    dropSession(session);
    errorLog(`[megacine] falha ao resolver o stream: ${error.message}`);
    await session.sendReply(`❌ ${error.message}`).catch(() => {});
    return true;
  }

  // A fonte nem sempre tem a faixa pedida (a lista é uma união): quando cai para
  // a outra, dizê-lo evita servir legendado em silêncio a quem pediu dublado.
  const faixaPedida = session.audioVersion || "";
  const faixaServida = stream.faixa || "";
  if (faixaPedida && faixaServida && faixaServida !== faixaPedida) {
    await session
      .sendReply(
        `⚠️ Este episódio não tem ${audioVersionLabel(faixaPedida).toLowerCase()}. ` +
          `Vou enviar ${audioVersionLabel(faixaServida).toLowerCase()}.`,
      )
      .catch(() => {});
  }
  session.audioVersion = faixaServida || faixaPedida;

  // Confirmar que o CDN responde ANTES de cobrar: um bloqueio só aparecia
  // depois de gastar créditos e de arrancar o yt-dlp.
  const candidatos = stream.candidatos?.length ? stream.candidatos : [stream.url];
  const alcancavel = await primeiroAlcancavel(candidatos, stream.referer);
  if (!alcancavel) {
    dropSession(session);
    await session
      .sendReply(
        "❌ A fonte não respondeu a este título agora. Tenta novamente em instantes.",
      )
      .catch(() => {});
    return true;
  }
  if (alcancavel !== stream.url) {
    infoLog("[megacine] primeiro candidato falhou; a usar um alternativo");
    stream.url = alcancavel;
  }

  const contaId = session.ownerId;
  const cobrar = contaId && contaId !== OWNER_LID;

  if (cobrar) {
    const saldo = hasSufficientCredits(contaId, MEGACINE_DOWNLOAD_CREDITS);

    if (!saldo.ok) {
      dropSession(session);
      await session
        .sendReply(
          creditsExhaustedMessage({
            commandName: "megacine",
            cost: MEGACINE_DOWNLOAD_CREDITS,
            account: saldo.account,
          }),
        )
        .catch(() => {});
      return true;
    }
  }

  dropSession(session);
  await session.sendReply("⬇️ Baixando...").catch(() => {});

  if (!(await isYtDlpAvailable())) {
    await session
      .sendReply(
        "❌ O yt-dlp não está disponível neste servidor, então não consigo baixar.",
      )
      .catch(() => {});
    return true;
  }

  let result;
  let pago = 0;

  try {
    if (cobrar) {
      const charge = chargeCredits(contaId, MEGACINE_DOWNLOAD_CREDITS, {
        reason: "megacine:download",
        countUsage: true,
      });

      if (!charge.ok) {
        await session
          .sendReply(
            creditsExhaustedMessage({
              commandName: "megacine",
              cost: MEGACINE_DOWNLOAD_CREDITS,
              account: charge.account,
            }),
          )
          .catch(() => {});
        return true;
      }

      pago = charge.charged;
    }

    result = await withCreditsContext(session.ownerId, () =>
      withDownloadSlot(
        () =>
          downloadWithYtDlp(stream.url, {
            // O Megacine publica UMA só qualidade (playlist de segmentos, sem
            // degraus), por isso não há altura a escolher: "best" é o único
            // formato que existe. O teto de MB é que decide o envio.
            height: "best",
            maxBytes: MEGACINE_MAX_DOWNLOAD_BYTES,
            extraArgs: megacineDownloadArgs(stream.referer),
          }),
        { priority: session.ownerId === OWNER_LID },
      ),
    );

    const tamanhoMB = result.fileSize / (1024 * 1024);
    const acao = decideAnimeSend(result.fileSize);

    const caption = megacineCaption({
      titulo: rotulo,
      duracao: result.durationString,
      faixa: session.audioVersion || "",
    });

    if (acao === "cancel") {
      infoLog(`[megacine] cancelado: ${tamanhoMB.toFixed(1)} MB acima do limite`);
      await session.sendReply(animeTooLargeMessage()).catch(() => {});
      return true;
    }

    if (acao === "document") {
      infoLog(`[megacine] enviando como documento (${tamanhoMB.toFixed(1)} MB)`);
      await socket.sendMessage(session.chatId, {
        document: mediaUploadFromFile(result.filePath),
        mimetype: "video/mp4",
        fileName: nomeArquivo,
        caption,
      });
    } else {
      // Sem o `moov` no início o WhatsApp responde "vídeo não está disponível":
      // o `withPreparedVideo` remuxa/transcode e apaga o temporário no fim.
      await withPreparedVideo(result.filePath, async (filePath) => {
        infoLog(`[megacine] enviando como vídeo (${tamanhoMB.toFixed(1)} MB)`);
        if (typeof sendVideoFromFile === "function") {
          await sendVideoFromFile(filePath, caption);
        } else {
          await socket.sendMessage(session.chatId, {
            video: mediaUploadFromFile(filePath),
            mimetype: "video/mp4",
            caption,
          });
        }
      });
    }
  } catch (error) {
    errorLog(`[megacine] falha no download: ${error.message}`);

    // Não se cobra um vídeo que não foi entregue.
    if (pago > 0) {
      refundCredits(contaId, pago);
      pago = 0;
    }

    await session
      .sendReply(`❌ Não consegui baixar: ${error.message}`)
      .catch(() => {});
  } finally {
    if (result?.filePath) {
      await fs.promises.rm(result.filePath, { force: true }).catch(() => {});
    }
  }

  return true;
}

/* ═══════════ HANDLER CENTRAL ═══════════ */

/**
 * Intercepta as respostas do menu do Megacine.
 *
 * Deve ser chamado ANTES do fluxo guiado: com uma sessão aberta, o próximo
 * texto pode ser o NOME do título, não uma função pendente.
 *
 * @returns {Promise<boolean>} true se a mensagem foi tratada aqui.
 */
export async function handleMegacineReply({
  socket,
  chatId,
  senderLid,
  senderLids = [],
  senderName,
  text,
  sendReply,
  sendVideoFromFile,
  prefix = "",
}) {
  let value = String(text || "").trim();
  if (!value) return false;

  const isToken = () => MEGACINE_TOKEN_PREFIXES.some((t) => value.startsWith(t));
  let isCancel = value === CANCEL_TOKEN;

  const senderJids = [senderLid, ...senderLids].filter(Boolean);
  const ownerId = getOwnerId(chatId, senderLid);
  const own = ownerId
    ? sessoesMegacine.get(animeSessionKey(chatId, ownerId)) || null
    : null;
  const doChat =
    own || findSessionInChat(chatId, senderJids) || findSessionInChat(chatId);

  // Escolha por NÚMERO: vale a linha nessa posição do último card. É o que
  // torna o menu utilizável no modo texto (`!`) e no fallback sem botões.
  if (
    !isToken() &&
    /^\d{1,3}$/.test(value) &&
    doChat?.lastRows?.length &&
    isSessionOwner(doChat, ...senderJids)
  ) {
    const linha = doChat.lastRows[Number(value) - 1];
    if (linha?.id) {
      value = String(linha.id);
      isCancel = value === CANCEL_TOKEN;
    }
  }

  if (isToken() && !doChat) {
    await sendReply(
      "⏳ Este menu do Saimo TV expirou. Envia .menu para recomeçar.",
    ).catch(() => {});
    return true;
  }

  if (isCancel) {
    if (!doChat) return false;
    if (!isSessionOwner(doChat, ...senderJids)) return false;
    dropSession(doChat);
    await sendReply("❌ Menu do Saimo TV cancelado.").catch(() => {});
    return true;
  }

  const sessao =
    own || (doChat && isSessionOwner(doChat, ...senderJids) ? doChat : null);

  if (!sessao) return false;

  if (own && senderJids.length) {
    for (const jid of senderJids) {
      for (const identidade of jidIdentities(jid)) own.identidades.add(identidade);
    }
  }

  if (isToken()) {
    if (sendReply) sessao.sendReply = sendReply;
    if (typeof sendVideoFromFile === "function") {
      sessao.sendVideoFromFile = sendVideoFromFile;
    }

    const candidatoIndex = tokenIndex(value, "mgc:an:");
    if (candidatoIndex >= 0) {
      return chooseCandidate({ socket, session: sessao, index: candidatoIndex });
    }

    const temporadaIndex = tokenIndex(value, "mgc:sea:");
    if (temporadaIndex >= 0) {
      return chooseSeason({ socket, session: sessao, index: temporadaIndex });
    }

    if (value.startsWith("mgc:aud:")) {
      return chooseAudioVersion({
        socket,
        session: sessao,
        version: value.slice("mgc:aud:".length).trim().toLowerCase(),
      });
    }

    if (value.startsWith("mgc:fil:")) {
      return chooseFilmeAudio({
        socket,
        session: sessao,
        version: value.slice("mgc:fil:".length).trim().toLowerCase(),
      });
    }

    const qualidade = tokenIndex(value, "mgc:q:");
    if (qualidade >= 0) {
      if (!sessao.filme) return false;
      return baixarFilme({
        socket,
        session: sessao,
        altura: qualidade,
        sendVideoFromFile,
      });
    }

    const episodioIndex = tokenIndex(value, "mgc:ep:");
    if (episodioIndex >= 0) {
      return downloadAndSend({
        socket,
        session: sessao,
        episodeIndex: episodioIndex,
        sendVideoFromFile,
      });
    }

    const resultadosIndex = tokenIndex(value, "mgc:pg2:");
    if (resultadosIndex >= 0) {
      if (!sessao.allCandidates?.length) {
        dropSession(sessao);
        await sendReply(
          "❌ Essa lista não está mais disponível. Envia .menu para recomeçar.",
        ).catch(() => {});
        return true;
      }
      return sendResultsPage({ socket, session: sessao, page: resultadosIndex });
    }

    const paginaIndex = tokenIndex(value, "mgc:pg:");
    if (paginaIndex >= 0) {
      if (!sessao.episodes?.length) {
        dropSession(sessao);
        await sendReply(
          "❌ Essa lista não está mais disponível. Envia .menu para recomeçar.",
        ).catch(() => {});
        return true;
      }
      return sendEpisodePage({ socket, session: sessao, page: paginaIndex });
    }

    return false;
  }

  // Estado `aguardando_nome`: o texto é o nome do título.
  if (sessao.stage === "aguardando_nome") {
    if (!isSessionOwner(sessao, ...senderJids)) return false;

    if (prefix && (value.startsWith(prefix) || value.startsWith("!"))) {
      dropSession(sessao);
      return false;
    }

    if (value.length < 2) {
      await sendReply("✏️ Escreve um nome com pelo menos 2 letras.").catch(() => {});
      return true;
    }

    if (sendReply) sessao.sendReply = sendReply;
    return searchAndSendResults({ socket, session: sessao, termo: value });
  }

  return false;
}

/** Índice de um token `prefixo<i>`, ou -1. */
function tokenIndex(token, prefixo) {
  if (!String(token).startsWith(prefixo)) return -1;
  const numero = Number(String(token).slice(prefixo.length));
  return Number.isInteger(numero) && numero >= 0 ? numero : -1;
}
