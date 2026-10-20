/**
 * Fluxo de animes (providers vivos via @consumet/extensions) — Parte 3 do sistema de downloads.
 *
 * Passos:
 *   1. o utilizador escolhe "Animes" no menu (ou usa `.anime <nome>`) → o bot
 *      pede o nome e guarda o estado `aguardando_nome`;
 *   2. com o nome, pesquisa no provider e lista 10 episódios (`rowId`
 *      `anm:ep:<índice>`), com um botão `anm:pg:<página>` no fundo para os
 *      restantes — a lista fica curta e todos os episódios continuam
 *      alcançáveis;
 *   3. ao escolher o episódio, busca as `sources` e lista as qualidades
 *      (rowId `anm:src:<índice>`);
 *   4. ao escolher a qualidade, baixa com o yt-dlp limitado a `ANIME_MAX_HEIGHT`
 *      (480p) e aplica a regra de tamanho (a mesma do YouTube, com teto maior):
 *        > 200 MB   → cancela e pede qualidade menor;
 *        100–200 MB → envia como DOCUMENTO;
 *        ≤ 100 MB   → envia como VÍDEO.
 *
 * A resolução é fixa em 480p: o m3u8 do provider traz 240p–1080p e sem limite o
 * yt-dlp escolhia 1080p, estourando o teto de 200 MB. A lista de qualidades
 * escolhe a *fonte* (URL), não a resolução final.
 *
 * As linhas guardam apenas índices (`anm:src:0`) porque o `rowId` do WhatsApp
 * tem limite de tamanho e os links de stream são longos/assinados; o array real
 * fica na sessão (`sessoesAnime`). Ver `src/utils/animeFormat.js`.
 *
 * @author Dev Gui
 */
import fs from "node:fs";
import { ANIME_MAX_DOWNLOAD_BYTES, ANIME_MAX_HEIGHT } from "../config.js";
import { getAnimeInfo, getEpisodeSources, searchAnime } from "../services/anime.js";
import { downloadWithYtDlp, isYtDlpAvailable } from "../services/ytdlp.js";
import { withCreditsContext } from "../services/credits.js";
import { mediaUploadFromFile } from "./mediaSend.js";
import { RODAPE, mediaCaption } from "./formatMessage.js";
import {
  ANIME_TOKEN_PREFIXES,
  EPISODES_PER_PAGE,
  animeProviderLabel,
  animeSessionKey,
  animeTokenIndex,
  buildEpisodeRows,
  buildNextPageRow,
  buildQualityRows,
  episodePageCount,
  identitiesOverlap,
  jidIdentities,
} from "./animeFormat.js";
import {
  INTERACTIVE_MENU_TTL_MS,
  numberedFallback,
  ownerButton,
  sendInteractiveWithFallback,
  singleSelectButton,
  urlButton,
} from "./interactive.js";
import { errorLog, infoLog } from "./logger.js";
import {
  animeTooLargeMessage,
  decideAnimeSend,
} from "./mediaSend.js";

export const ANIME_TTL_MS = INTERACTIVE_MENU_TTL_MS;

const CHANNEL_URL = "https://www.youtube.com/@devgui_?sub_confirmation=1";
const CANCEL_TOKEN = "anm:cancel";

/** Sessões por `${chatId}:${ownerId}`. */
const sessoesAnime = new Map();

function sanitizeName(value) {
  return String(value || "")
    .replace(/[\r\n*_`@]/g, "")
    .slice(0, 32);
}

function getOwnerId(chatId, ownerLid) {
  if (ownerLid) return ownerLid;
  return chatId.endsWith("@g.us") ? "" : chatId;
}

/**
 * true se quem respondeu é o autor do pedido.
 *
 * Compara pelos DÍGITOS (participant + participantAlt), não pela string exata:
 * a mesma pessoa chega com formas diferentes entre mensagens (`@lid` vs
 * número, com/sem sufixo de aparelho), e comparar strings negava o próprio
 * autor. Sem identidade conhecida do autor OU do remetente, aceita
 * (fail-open): um menu que recusa o dono é pior do que um menu aberto — e em
 * conversa privada não existe `key.participant` para comparar.
 */
function isSessionOwner(session, ...senderJids) {
  const autor = session?.identidades;
  if (!autor?.size) return true;

  const quem = jidIdentities(...senderJids);
  if (!quem.size) return true;

  return identitiesOverlap(autor, quem);
}

function dropSession(session) {
  if (!session) return;
  if (sessoesAnime.get(session.key) === session) sessoesAnime.delete(session.key);
  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
  }
}

function touch(session) {
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  session.cleanupTimer = setTimeout(() => {
    if (sessoesAnime.get(session.key) !== session) return;
    dropSession(session);
    session.sendReply?.(
      "⏳ O tempo do menu de animes terminou. Envia .menu para recomeçar.",
    ).catch(() => {});
  }, ANIME_TTL_MS);
  session.cleanupTimer.unref?.();
}

/**
 * Procura uma sessão no chat. Com `senderJids`, devolve primeiro a sessão cujo
 * autor tem a MESMA identidade (dígitos); sem correspondência, cai no primeiro
 * do chat (para o aviso "é de @fulano").
 *
 * @param {string} chatId
 * @param {Array<string>} [senderJids]
 * @returns {object|null}
 */
function findSessionInChat(chatId, senderJids = []) {
  let primeiro = null;

  for (const session of sessoesAnime.values()) {
    if (session.chatId !== chatId) continue;

    if (!primeiro) primeiro = session;

    if (senderJids.length && isSessionOwner(session, ...senderJids)) {
      return session;
    }
  }

  return primeiro;
}

/** Introspeção usada nos testes. */
export function getAnimeSession(chatId, ownerId) {
  return sessoesAnime.get(animeSessionKey(chatId, ownerId)) || null;
}

/** Limpa todas as sessões (usado nos testes). */
export function resetAnimeSessions() {
  for (const session of sessoesAnime.values()) {
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  }
  sessoesAnime.clear();
}

function ensureSession({
  chatId,
  ownerId,
  ownerName,
  sendReply,
  senderLids = [],
}) {
  const key = animeSessionKey(chatId, ownerId);
  let session = sessoesAnime.get(key);

  const identidades = jidIdentities(ownerId, ...senderLids);

  if (!session) {
    session = {
      key,
      chatId,
      ownerId,
      identidades,
      ownerName: sanitizeName(ownerName) || "dono do pedido",
      sendReply,
      stage: "idle",
      provider: "",
      anime: null,
      episodes: [],
      page: 0,
      episode: null,
      sources: [],
      cleanupTimer: null,
    };
    sessoesAnime.set(key, session);
  } else {
    if (sendReply) session.sendReply = sendReply;
    if (ownerName) session.ownerName = sanitizeName(ownerName);
    // Alarga as identidades conhecidas do autor (nunca as reduz).
    for (const identidade of identidades) {
      session.identidades.add(identidade);
    }
  }

  touch(session);
  return session;
}

function canalButton() {
  return urlButton("📢 Canal", CHANNEL_URL);
}

function cancelRow() {
  return {
    id: CANCEL_TOKEN,
    title: "❌ Cancelar",
    description: "Sair do menu de animes",
  };
}

async function sendCard({ socket, session, text, title, rows, fallbackPrompt }) {
  const sections = [{ title: title || "Animes", rows }];
  const options = rows.map((row, index) => ({
    number: String(index + 1),
    title: row.title,
    id: row.id,
  }));

  const buttons = [];
  const lista = singleSelectButton("📂 Opções", sections, { title: title || "Animes" });
  if (lista) buttons.push(lista);
  const dono = ownerButton();
  if (dono) buttons.push(dono);
  const canal = canalButton();
  if (canal) buttons.push(canal);

  const sent = await sendInteractiveWithFallback({
    socket,
    chatId: session.chatId,
    content: {
      text,
      footer: RODAPE,
      interactiveButtons: buttons,
      viewOnce: true,
    },
    fallbackText: numberedFallback(options, fallbackPrompt || "Responde com o número 👇"),
    sendReply: session.sendReply,
    onSendError: (error) =>
      errorLog(`[anime] falha ao enviar card: ${error.message}`),
  });

  if (!sent) {
    dropSession(session);
  }

  return Boolean(sent);
}

/* ═══════════ PASSO 1 · PEDIR O NOME ═══════════ */

/**
 * Abre o menu de animes. Sem `nome`, pede o nome (estado `aguardando_nome`);
 * com `nome`, segue direto para a pesquisa.
 *
 * @returns {Promise<boolean>}
 */
export async function startAnimeFlow({
  socket,
  chatId,
  ownerLid,
  ownerName,
  sendReply,
  senderLids = [],
  nome = "",
}) {
  const ownerId = getOwnerId(chatId, ownerLid);
  if (!ownerId) {
    await sendReply(
      "🚫 Não consegui confirmar quem fez o pedido. Envia o comando novamente.",
    ).catch(() => {});
    return false;
  }

  const session = ensureSession({
    chatId,
    ownerId,
    ownerName,
    sendReply,
    senderLids,
  });

  if (nome) {
    return searchAndSendEpisodes({ socket, session, nome });
  }

  session.stage = "aguardando_nome";
  session.anime = null;
  session.episodes = [];
  session.episode = null;
  session.sources = [];

  infoLog(`[anime] a pedir o nome do anime para "${chatId}" (owner ${ownerId})`);

  return sendCard({
    socket,
    session,
    text: mediaCaption({
      titulo: "Animes",
      canal: "Menu de animes",
      duracao: "—",
      qualidade: "—",
      extra: "✏️ Envie o *nome do anime* que quer ver (ex: Naruto).",
    }),
    title: "Animes",
    rows: [cancelRow()],
  });
}

/* ═══════════ PASSO 2 · LISTAR OS EPISÓDIOS ═══════════ */

async function searchAndSendEpisodes({ socket, session, nome }) {
  session.stage = "buscando";
  touch(session);

  try {
    const anime = await searchAnime(nome);
    const info = await getAnimeInfo(anime.id, anime.provider);

    session.anime = { ...anime, title: info.title || anime.title };
    session.provider = anime.provider;
    session.episodes = info.episodes;
    session.stage = "episodios";

    infoLog(
      `[anime] "${session.anime.title}" (id ${anime.id}) com ${info.episodes.length} episódios`,
    );

    return sendEpisodePage({ socket, session, page: 0 });
  } catch (error) {
    dropSession(session);
    errorLog(`[anime] falha ao buscar "${nome}": ${error.message}`);
    await session.sendReply(`❌ ${error.message}`).catch(() => {});
    return false;
  }
}

/**
 * Envia uma página da lista de episódios: 10 por vez, com um botão "Ver mais"
 * no fundo para os restantes (todos ficam alcançáveis sem a lista crescer).
 *
 * @returns {Promise<boolean>}
 */
async function sendEpisodePage({ socket, session, page }) {
  const total = session.episodes.length;
  const totalPages = episodePageCount(session.episodes);
  const atual = Math.min(Math.max(0, page), totalPages - 1);

  session.page = atual;
  session.stage = "episodios";
  touch(session);

  const rows = [
    ...buildEpisodeRows(session.episodes, atual),
    ...buildNextPageRow(atual, totalPages),
    cancelRow(),
  ];

  const inicio = atual * EPISODES_PER_PAGE + 1;
  const fim = Math.min(total, inicio + EPISODES_PER_PAGE - 1);
  const faltam = total - fim;

  return sendCard({
    socket,
    session,
    text: mediaCaption({
      titulo: session.anime?.title || "Anime",
      canal: animeProviderLabel(session.provider),
      duracao: `${total} episódios`,
      qualidade: `Episódios ${inicio}–${fim}`,
      extra: faltam
        ? `🎬 Faltam ${faltam}. Usa *Ver mais episódios* em baixo.`
        : "🎬 Estes são os últimos episódios.",
    }),
    title: "Episódios",
    rows,
  });
}

/* ═══════════ PASSO 3 · LISTAR AS QUALIDADES ═══════════ */

async function sendQualityList({ socket, session, episodeIndex }) {
  const episode = session.episodes[episodeIndex];
  if (!episode?.id) {
    dropSession(session);
    await session.sendReply(
      "❌ Esse episódio não está mais disponível. Envia .menu para recomeçar.",
    ).catch(() => {});
    return true;
  }

  session.stage = "buscando";
  touch(session);

  try {
    const sources = await getEpisodeSources(episode.id, session.provider);

    session.episode = {
      index: episodeIndex,
      number: episode.number ?? episodeIndex + 1,
      title: episode.title || "",
      id: episode.id,
    };
    session.sources = sources;
    session.stage = "qualidades";

    const rows = buildQualityRows(sources);
    rows.push(cancelRow());

    infoLog(
      `[anime] episódio ${session.episode.number}: ${sources.length} qualidades`,
    );

    return sendCard({
      socket,
      session,
      text: mediaCaption({
        titulo: `${session.anime?.title || "Anime"} — Ep. ${session.episode.number}`,
        canal: animeProviderLabel(session.provider),
        duracao: session.episode.title || "—",
        qualidade: "Escolha a qualidade",
        extra: "⬇️ Escolha a qualidade para baixar.",
      }),
      title: "Qualidade",
      rows,
    });
  } catch (error) {
    dropSession(session);
    errorLog(`[anime] falha ao buscar fontes: ${error.message}`);
    await session.sendReply(`❌ ${error.message}`).catch(() => {});
    return true;
  }
}

/* ═══════════ PASSO 4 · BAIXAR E ENVIAR ═══════════ */

/**
 * Argumentos extra do yt-dlp consoante o provider.
 *
 * O CDN do anikoto (`fetch.nexabloom.top`) entrega o m3u8 apenas a pedidos que
 * pareçam um browser: o yt-dlp tem de imitar o TLS/HTTP de um Chrome
 * (`generic:impersonate`) e enviar o `Referer` do player, senão responde 403
 * (desafio Cloudflare). Nos outros providers não se acrescenta nada, para não
 * mexer num caminho que já funciona.
 *
 * @param {string} provider
 * @returns {string[]}
 */
function animeDownloadArgs(provider) {
  if (String(provider || "").toLowerCase() !== "anikoto") return [];
  return [
    "--extractor-args",
    "generic:impersonate",
    "--referer",
    "https://megaplay.buzz/",
  ];
}

/**
 * O CDN dos animes (anikoto) limita pedidos concorrentes: com fragmentos HLS em
 * paralelo ele responde 429 e o yt-dlp perde fragmentos, falhando com
 * "No such file ...-FragN". Baixar em sequência é mais lento e mais confiável.
 */
function animeConcurrentFragments(provider) {
  return String(provider || "").toLowerCase() === "anikoto" ? 1 : undefined;
}

async function downloadAndSend({ socket, session, sourceIndex, sendVideoFromFile }) {
  const source = session.sources[sourceIndex];
  if (!source?.url) {
    dropSession(session);
    await session.sendReply(
      "❌ Essa qualidade não está mais disponível. Envia .menu para recomeçar.",
    ).catch(() => {});
    return true;
  }

  const episode = session.episode;
  const animeTitulo = session.anime?.title || "Anime";

  dropSession(session);
  await session.sendReply("⬇️ Baixando o episódio...").catch(() => {});

  if (!(await isYtDlpAvailable())) {
    await session.sendReply(
      "❌ O yt-dlp não está disponível neste servidor, então não consigo baixar o episódio.",
    ).catch(() => {});
    return true;
  }

  let result;
  try {
    result = await withCreditsContext(session.ownerId, () =>
      downloadWithYtDlp(source.url, {
        height: ANIME_MAX_HEIGHT,
        maxBytes: ANIME_MAX_DOWNLOAD_BYTES,
        extraArgs: animeDownloadArgs(session.provider),
        concurrentFragments: animeConcurrentFragments(session.provider),
      }),
    );

    const tamanhoMB = result.fileSize / (1024 * 1024);
    const acao = decideAnimeSend(result.fileSize);

    const caption = mediaCaption({
      titulo: `${animeTitulo} — Ep. ${episode?.number ?? "?"}`,
      canal: animeProviderLabel(session.provider),
      duracao: result.durationString || "Não disponível",
      qualidade: source.label,
    });

    if (acao === "cancel") {
      infoLog(`[anime] cancelado: ${tamanhoMB.toFixed(1)} MB acima do limite`);
      await session.sendReply(animeTooLargeMessage()).catch(() => {});
      return true;
    }

    if (acao === "document") {
      infoLog(`[anime] enviando como documento (${tamanhoMB.toFixed(1)} MB)`);
      await socket.sendMessage(session.chatId, {
        document: mediaUploadFromFile(result.filePath),
        mimetype: "video/mp4",
        fileName: "anime.mp4",
        caption,
      });
    } else {
      infoLog(`[anime] enviando como vídeo (${tamanhoMB.toFixed(1)} MB)`);
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
    errorLog(`[anime] falha no download: ${error.message}`);
    await session.sendReply(`❌ Não consegui baixar o episódio: ${error.message}`).catch(
      () => {},
    );
  } finally {
    if (result?.filePath) {
      await fs.promises.rm(result.filePath, { force: true }).catch(() => {});
    }
  }

  return true;
}

/* ═══════════ HANDLER CENTRAL ═══════════ */

/**
 * Intercepta as respostas do menu de animes: o nome (estado
 * `aguardando_nome`), os tokens `anm:ep:<i>`, `anm:src:<i>` e `anm:cancel`.
 *
 * Deve ser chamado ANTES do fluxo guiado: com uma sessão de anime aberta, o
 * próximo texto é o nome do anime, não uma função pendente do fluxo.
 *
 * @returns {Promise<boolean>} true se a mensagem foi tratada aqui.
 */
export async function handleAnimeReply({
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
  const value = String(text || "").trim();
  if (!value) return false;

  const isAnimeToken = ANIME_TOKEN_PREFIXES.some((token) =>
    value.startsWith(token),
  );
  const isCancel = value === CANCEL_TOKEN;

  const senderJids = [senderLid, ...senderLids].filter(Boolean);
  const ownerId = getOwnerId(chatId, senderLid);
  const own = ownerId
    ? sessoesAnime.get(animeSessionKey(chatId, ownerId)) || null
    : null;
  // Se a chave exata falhar (formas de JID diferentes), procura no chat uma
  // sessão cujo autor tenha a MESMA identidade — e não apenas "a primeira".
  const doChat =
    own || findSessionInChat(chatId, senderJids) || findSessionInChat(chatId);

  // Um token de anime sem sessão (menu expirado) merece aviso claro.
  if (isAnimeToken && !doChat) {
    await sendReply(
      "⏳ Este menu de animes expirou. Envia .menu para recomeçar.",
    ).catch(() => {});
    return true;
  }

  if (isCancel) {
    if (!doChat) return false;
    // Só o dono da sessão a pode cancelar; outros não a destroem.
    if (!isSessionOwner(doChat, ...senderJids)) {
      await sendReply(
        `🚫 Este menu de animes é de @${doChat.ownerName}. Só quem pediu pode cancelar.`,
      ).catch(() => {});
      return true;
    }
    dropSession(doChat);
    await sendReply("❌ Menu de animes cancelado.").catch(() => {});
    return true;
  }

  // Sessão encontrada por identidade (não pela chave exata): adota-a para o
  // resto do fluxo, alargando as formas de JID conhecidas do autor.
  const sessao = own || (doChat && isSessionOwner(doChat, ...senderJids) ? doChat : null);

  if (!sessao) {
    if (doChat) {
      await sendReply(
        `🚫 Este menu de animes é de @${doChat.ownerName}. Só quem pediu pode escolher.`,
      ).catch(() => {});
      return true;
    }
    return false;
  }

  if (own && senderJids.length) {
    for (const jid of senderJids) {
      for (const identidade of jidIdentities(jid)) {
        own.identidades.add(identidade);
      }
    }
  }

  if (isAnimeToken) {
    if (sendReply) sessao.sendReply = sendReply;

    const epIndex = animeTokenIndex(value, "anm:ep:");
    if (epIndex >= 0) {
      return sendQualityList({ socket, session: sessao, episodeIndex: epIndex });
    }

    const pgIndex = animeTokenIndex(value, "anm:pg:");
    if (pgIndex >= 0) {
      if (!sessao.episodes?.length) {
        dropSession(sessao);
        await sendReply(
          "❌ Essa lista não está mais disponível. Envia .menu para recomeçar.",
        ).catch(() => {});
        return true;
      }
      return sendEpisodePage({ socket, session: sessao, page: pgIndex });
    }

    const srcIndex = animeTokenIndex(value, "anm:src:");
    if (srcIndex >= 0) {
      return downloadAndSend({
        socket,
        session: sessao,
        sourceIndex: srcIndex,
        sendVideoFromFile,
      });
    }

    return false;
  }

  // Estado `aguardando_nome`: o texto é o nome do anime.
  if (sessao.stage === "aguardando_nome") {
    if (!isSessionOwner(sessao, ...senderJids)) {
      await sendReply(
        `🚫 O menu de animes é de @${sessao.ownerName}. Só quem pediu pode escolher.`,
      ).catch(() => {});
      return true;
    }

    // Comandos com prefixo não são nomes de anime: larga a sessão e segue.
    if (prefix && (value.startsWith(prefix) || value.startsWith("!"))) {
      dropSession(sessao);
      return false;
    }

    if (value.length < 2) {
      await sendReply("✏️ Envie um nome de anime com pelo menos 2 letras.").catch(
        () => {},
      );
      return true;
    }

    if (sendReply) sessao.sendReply = sendReply;
    return searchAndSendEpisodes({ socket, session: sessao, nome: value });
  }

  return false;
}
