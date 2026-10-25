/**
 * Fluxo do Megacine (séries, doramas e animes episódicos) — comando `.megacine`.
 *
 * Passos:
 *   1. o utilizador escreve `.megacine <nome>` → o bot pesquisa e lista os
 *      resultados (`rowId` `mgc:an:<índice>`);
 *   2. escolhido o título, o bot lista as temporadas (`rowId` `mgc:sea:<índice>`)
 *      — só quando há mais de uma, senão salta direto para os episódios, porque
 *      uma escolha de um item só seria ruído;
 *   3. escolhida a temporada, lista os episódios (`rowId` `mgc:ep:<índice>`),
 *      paginados, com um botão `mgc:pg:<página>` no fundo;
 *   4. escolhido o episódio, baixa e envia.
 *
 * FILMES NÃO ENTRAM. A pesquisa descarta-os pelo `card-meta` e, como rede de
 * segurança, um título que escape é recusado ao abrir (a página diz "Assistir
 * Filme"). Ver `src/services/megacine.js` para o porquê.
 *
 * NÃO há passo de qualidade, ao contrário dos animes: o Megacine publica UMA só
 * qualidade por episódio (uma playlist de segmentos, sem `EXT-X-STREAM-INF`),
 * por isso pedir uma escolha que não existe seria um passo a fingir. O teto de
 * tamanho continua a aplicar-se no download.
 *
 * As linhas guardam apenas índices (`mgc:ep:0`) porque o `rowId` do WhatsApp
 * tem limite de tamanho; os slugs e URLs reais ficam na sessão.
 *
 * @author Dev Gui
 */
import fs from "node:fs";
import {
  MEGACINE_DOWNLOAD_CREDITS,
  MEGACINE_MAX_DOWNLOAD_BYTES,
  OWNER_LID,
} from "../config.js";
import {
  getEpisodeStream,
  getSeasons,
  isPlaylistReachable,
  megacineDownloadArgs,
  search,
} from "../services/megacine.js";
import { downloadWithYtDlp, isYtDlpAvailable } from "../services/ytdlp.js";
import { withDownloadSlot } from "../services/downloadQueue.js";
import {
  chargeCredits,
  creditsExhaustedMessage,
  hasSufficientCredits,
  refundCredits,
  withCreditsContext,
} from "../services/credits.js";
import { mediaUploadFromFile } from "./mediaSend.js";
import { RODAPE, mediaCaption } from "./formatMessage.js";
import {
  EPISODES_PER_PAGE,
  animeSessionKey,
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

/** Prefixos de token tratados por este fluxo (usado no despacho do middleware). */
export const MEGACINE_TOKEN_PREFIXES = [
  "mgc:an:",
  "mgc:sea:",
  "mgc:ep:",
  "mgc:pg:",
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
      .sendReply?.("⏳ O tempo do menu do Megacine terminou. Envia .menu para recomeçar.")
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
    description: "Sair do menu do Megacine",
  };
}

function buildCandidateRows(candidatos = []) {
  return candidatos.map((item, index) => ({
    id: `mgc:an:${index}`,
    title: String(item.title || item.slug).slice(0, 60),
    // A pesquisa já só devolve conteúdo episódico (séries, doramas e animes),
    // por isso o tipo não precisa de aparecer; o ano desempata títulos iguais.
    description: item.year ? String(item.year) : "Abrir",
  }));
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

async function sendCard({ socket, session, text, title, rows, fallbackPrompt }) {
  const sections = [{ title: title || "Megacine", rows }];
  const options = rows.map((row, index) => ({
    number: String(index + 1),
    title: row.title,
    id: row.id,
  }));

  const buttons = [];
  const lista = singleSelectButton("📂 Opções", sections, { title: title || "Megacine" });
  if (lista) buttons.push(lista);
  const dono = ownerButton();
  if (dono) buttons.push(dono);

  const sent = await sendInteractiveWithFallback({
    socket,
    chatId: session.chatId,
    content: {
      text,
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
        `📺 *MEGACINE*\n\n` +
        `Escreve o nome da série que queres ver.\n\n` +
        `_Ex.: .megacine the boys_`,
      title: "Megacine",
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
    resultados = await search(termo);
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

  session.candidates = resultados.slice(0, 10);
  session.stage = "candidatos";

  const rows = buildCandidateRows(session.candidates);
  rows.push(cancelRow());

  infoLog(`[megacine] "${termo}": ${resultados.length} resultados`);

  return sendCard({
    socket,
    session,
    text:
      `🎬 *MEGACINE*\n\n` +
      `🔎 *Procura:* ${sanitizeName(termo)}\n` +
      `📚 *Resultados:* ${resultados.length}\n\n` +
      `Escolhe o título que queres ver.`,
    title: "Resultados",
    rows,
  });
}

/* ═══════════ PASSO 2 · TEMPORADAS ═══════════ */

async function chooseCandidate({ socket, session, index }) {
  const candidato = session.candidates[index];

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

  let seasons;

  try {
    const resultado = await getSeasons(candidato.slug);

    // Rede de segurança: a pesquisa já filtra filmes pelo `card-meta`, mas se o
    // meta faltar (ou mudar de formato) é aqui que o filme é travado. A página
    // é a fonte de verdade — "Assistir Filme" vs "Assistir Agora".
    if (resultado.isFilme) {
      dropSession(session);
      await session
        .sendReply(
          "🎬 Este título é um *filme*, e o comando serve só séries, doramas e " +
            "animes. Tenta outro título.",
        )
        .catch(() => {});
      return true;
    }

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

  // Uma temporada única não tem escolha a fazer: seguir direto evita um passo
  // com uma opção só (ex.: `duna-a-profecia-dublado`, 1 temporada com 6 eps).
  if (seasons.length === 1) {
    return chooseSeason({ socket, session, index: 0 });
  }

  const rows = buildSeasonRows(seasons);
  rows.push(cancelRow());

  infoLog(`[megacine] "${candidato.title}": ${seasons.length} temporadas`);

  return sendCard({
    socket,
    session,
    text:
      `🎬 *${candidato.title}*\n\n` +
      `📺 Escolhe a temporada que queres ver.`,
    title: "Temporadas",
    rows,
  });
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
      `🎬 *${session.title?.title || "Megacine"}*\n\n` +
      `📺 *Temporada ${session.seasonNumber}*\n` +
      `🎞️ *Episódios:* ${session.episodes.length}\n\n` +
      `Escolhe o episódio para baixar.`,
    title: "Episódios",
    rows,
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
export function megacineCaption({ titulo, duracao } = {}) {
  return mediaCaption({
    titulo,
    canal: "Megacine",
    duracao: duracao || "Não disponível",
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

  const titulo = session.title?.title || "Megacine";
  const rotulo =
    session.seasons.length === 1 && session.episodes.length === 1
      ? titulo
      : `${titulo} — T${session.seasonNumber} Ep. ${episode.number}`;

  session.stage = "baixando";

  let stream;

  try {
    stream = await getEpisodeStream(
      session.title.slug,
      session.seasonNumber,
      episode.number,
    );
  } catch (error) {
    dropSession(session);
    errorLog(`[megacine] falha ao resolver o stream: ${error.message}`);
    await session.sendReply(`❌ ${error.message}`).catch(() => {});
    return true;
  }

  // Confirmar que o CDN responde ANTES de cobrar: um bloqueio só aparecia
  // depois de gastar créditos e de arrancar o yt-dlp.
  if (!(await isPlaylistReachable(stream.url, stream.referer))) {
    dropSession(session);
    await session
      .sendReply(
        "❌ A fonte não respondeu a este título agora. Tenta novamente em instantes.",
      )
      .catch(() => {});
    return true;
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
        fileName: "megacine.mp4",
        caption,
      });
    } else {
      infoLog(`[megacine] enviando como vídeo (${tamanhoMB.toFixed(1)} MB)`);
      if (typeof sendVideoFromFile === "function") {
        await sendVideoFromFile(result.filePath, caption);
      } else {
        await socket.sendMessage(session.chatId, {
          video: mediaUploadFromFile(result.filePath),
          mimetype: "video/mp4",
          caption,
        });
      }
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
      "⏳ Este menu do Megacine expirou. Envia .menu para recomeçar.",
    ).catch(() => {});
    return true;
  }

  if (isCancel) {
    if (!doChat) return false;
    if (!isSessionOwner(doChat, ...senderJids)) return false;
    dropSession(doChat);
    await sendReply("❌ Menu do Megacine cancelado.").catch(() => {});
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

    const episodioIndex = tokenIndex(value, "mgc:ep:");
    if (episodioIndex >= 0) {
      return downloadAndSend({
        socket,
        session: sessao,
        episodeIndex: episodioIndex,
        sendVideoFromFile,
      });
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
