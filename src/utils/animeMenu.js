/**
 * Fluxo de animes (fonte única: meusanimes) — Parte 3 do sistema de downloads.
 *
 * Passos:
 *   1. o utilizador escolhe "Animes" no menu (ou usa `.anime <nome>`) → o bot
 *      pede o nome e guarda o estado `aguardando_nome`;
 *   2. com o nome, o bot pergunta a faixa ANTES de pesquisar
 *      (`rowId` `anm:aud:<faixa>`). A pergunta vem primeiro porque um título só
 *      legendado nunca satisfaz um pedido de dublado: descobri-lo no fim obrigava
 *      a repetir o pedido. Escolhida a faixa, a pesquisa arranca já com ela. Se
 *      o título tiver temporadas agrupadas, lista-as (`rowId` `anm:sea:<índice>`);
 *      senão salta direto para os episódios — muitas temporadas no site são, na
 *      verdade, animes separados, por isso a escolha evita misturar episódios de
 *      temporadas diferentes. Quando a fonte não tem a faixa pedida, o bot avisa
 *      e cai para a que existe, em vez de servir o áudio errado em silêncio;
 *   3. escolhida a temporada, lista 10 episódios (`rowId` `anm:ep:<índice>`),
 *      com um botão `anm:pg:<página>` no fundo para os restantes — a lista
 *      fica curta e todos os episódios continuam alcançáveis;
 *   4. ao escolher o episódio, busca as `sources` (na faixa escolhida) e lista
 *      as qualidades (rowId `anm:src:<índice>`);
 *   5. ao escolher a qualidade, baixa com o yt-dlp e aplica a regra de tamanho
 *      (a mesma do YouTube, com teto maior):
 *        > 500 MB   → cancela e pede qualidade menor;
 *        100–500 MB → envia como DOCUMENTO;
 *        ≤ 100 MB   → envia como VÍDEO.
 *
 * A resolução do download depende do tipo de fonte. Um m3u8 traz vários degraus
 * no mesmo URL, por isso o yt-dlp é limitado a `ANIME_MAX_HEIGHT` (480p) — sem
 * limite escolhia 1080p e estourava o teto. Uma fonte MP4 direta já É o degrau
 * escolhido no menu (o meusanimes publica 360p e 720p como URLs distintos),
 * por isso não leva filtro de altura: o teto de MB é que decide.
 *
 * As linhas guardam apenas índices (`anm:src:0`) porque o `rowId` do WhatsApp
 * tem limite de tamanho e os links de stream são longos/assinados; o array real
 * fica na sessão (`sessoesAnime`). Ver `src/utils/animeFormat.js`.
 *
 * @author Dev Yanik
 */
import fs from "node:fs";
import { ANIME_DOCUMENT_LIMIT_MB, ANIME_EPISODE_CREDITS, ANIME_MAX_DOWNLOAD_BYTES, ANIME_MAX_HEIGHT, ANIME_PT_DUB_PROVIDERS, MAIN_MENU_CHANNEL_URL, OWNER_LID } from "../config.js";
import { getAnimeInfo, getAnimeSeasons, getEpisodeSources, getSeasonEpisodes, searchAnimeCandidates } from "../services/anime.js";
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
import { prepareImageForWhatsApp, withPreparedVideo } from "../services/mediaPrepare.js";
import { RODAPE, mediaCaption } from "./formatMessage.js";
import {
  ANIME_TOKEN_PREFIXES,
  AUDIO_VERSIONS,
  EPISODES_PER_PAGE,
  animeProviderLabel,
  animeSessionKey,
  animeTokenIndex,
  audioTrackLabel,
  audioVersionLabel,
  buildAudioRows,
  buildCandidateRows,
  buildEpisodeRows,
  buildNextPageRow,
  buildQualityRows,
  buildSeasonRows,
  availableAudioVersions,
  capaEmTamanhoGrande,
  episodePageCount,
  identitiesOverlap,
  avisoIdiomaDublagem,
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
  safeMediaFileName,
} from "./mediaSend.js";

export const ANIME_TTL_MS = INTERACTIVE_MENU_TTL_MS;

const CANCEL_TOKEN = "anm:cancel";

/**
 * Cabeçalhos que o CDN do Google Video (Blogger) exige: o `Referer` do Blogger e
 * um User-Agent de browser. Sem o User-Agent responde 403 mesmo com o Referer
 * certo. É o formato servido pelo meusanimes.
 */
const ARGS_BLOGGER = [
  "--referer",
  "https://www.blogger.com/",
  "--user-agent",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

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
  textOnly = false,
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
      candidates: [],
      seasons: [],
      seasonTitle: "",
      seasonSlug: "",
      episodes: [],
      page: 0,
      episode: null,
      sources: [],
      audioVersions: [],
      audioVersion: "",
      pendingName: "",
      // Linhas do último card: um número respondido vale a linha nessa posição
      // (modo texto e fallback, sem botões).
      lastRows: [],
      // Modo texto (prefixo `!`): os cards saem como texto numerado.
      textOnly: Boolean(textOnly),
      cleanupTimer: null,
    };
    sessoesAnime.set(key, session);
  } else {
    if (sendReply) session.sendReply = sendReply;
    if (ownerName) session.ownerName = sanitizeName(ownerName);
    // Abrir com `!anime` mantém o modo texto; abrir com `.anime` volta aos
    // botões (a intenção mais recente ganha).
    session.textOnly = Boolean(textOnly);
    // Alarga as identidades conhecidas do autor (nunca as reduz).
    for (const identidade of identidades) {
      session.identidades.add(identidade);
    }
  }

  touch(session);
  return session;
}

function canalButton() {
  return urlButton("📢 Canal", MAIN_MENU_CHANNEL_URL);
}

function cancelRow() {
  return {
    id: CANCEL_TOKEN,
    title: "❌ Cancelar",
    description: "Sair do menu de animes",
  };
}

async function sendCard({
  socket,
  session,
  text,
  title,
  rows,
  fallbackPrompt,
  image = null,
}) {
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

  const sent = await (async () => {
    // A capa é preparada aqui: alguns CDNs servem só WebP, que o WhatsApp não
    // renderiza (e o jimp do Baileys não descodifica) — ver `mediaPrepare.js`.
    // O ficheiro convertido é temporário e apagado no fim.
    const capa = await prepareImageForWhatsApp(image);

    try {
      return await sendInteractiveWithFallback({
        socket,
        chatId: session.chatId,
        content: {
          // Com capa, o corpo tem de ir em `caption`: o baileys só anexa a imagem ao
          // cabeçalho do card interativo quando o texto vem por `caption` (com
          // `text` o corpo é construído como mensagem de texto e a imagem é
          // descartada). O corpo final é `text || caption`, por isso o conteúdo é o
          // mesmo — verificado contra `generateWAMessageContent`.
          ...(capa.image ? { caption: text, image: { url: capa.image } } : { text }),
          footer: RODAPE,
          interactiveButtons: buttons,
          viewOnce: true,
        },
        fallbackText: numberedFallback(options, fallbackPrompt || "Responde com o número 👇"),
        sendReply: session.sendReply,
        // Modo texto (`!`): entrega o texto numerado em vez do card.
        textOnly: Boolean(session.textOnly),
        onSendError: (error) =>
          errorLog(`[anime] falha ao enviar card: ${error.message}`),
      });
    } finally {
      if (capa.temporary) {
        await fs.promises.rm(capa.image, { force: true }).catch(() => {});
      }
    }
  })();

  // Guarda as linhas do último card para o modo texto: um número respondido
  // vale a linha nessa posição. Sem isto o anime só aceitava tokens (o fallback
  // numerado era enviado, mas nunca registado) — os números não funcionavam.
  if (sent) session.lastRows = rows;

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
  textOnly = false,
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
    textOnly,
  });

  if (nome) {
    session.pendingName = nome;
    return askAudioBeforeSearch({ socket, session });
  }

  session.stage = "aguardando_nome";
  session.anime = null;
  session.candidates = [];
  session.seasons = [];
  session.seasonTitle = "";
  session.seasonSlug = "";
  session.episodes = [];
  session.episode = null;
  session.sources = [];
  session.audioVersions = [];
  session.audioVersion = "";
  session.pendingName = "";

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
      rodape: null,
    }),
    title: "Animes",
    rows: [cancelRow()],
  });
}

/* ═══════════ PASSO 2 · PERGUNTAR A FAIXA E PESQUISAR ═══════════ */

async function searchAndSendEpisodes({ socket, session, nome }) {
  session.stage = "buscando";
  // O nome já foi consumido: a partir daqui a pergunta da faixa está fora do
  // ecrã, pelo que uma nova escolha de faixa recarrega a lista em vez de
  // repetir a pesquisa.
  session.pendingName = "";
  touch(session);

  try {
    // A faixa escolhida vai já para a pesquisa: o `meusanimes` publica o
    // dublado como entrada própria, pelo que a escolha muda o que é procurado.
    //
    // `searchAnimeCandidates` (e não `searchAnime`) porque um título em
    // português pode não ter correspondência exata no catálogo do site:
    // "Meu Hero Academia" devolvia "Eiyuu Kyoushitsu" (outro anime) sem aviso.
    // Aqui, ou há correspondência exata, ou o utilizador escolhe da lista —
    // nunca um palpite silencioso.
    const busca = await searchAnimeCandidates(nome, session.audioVersion || "");

    if (busca.anime) {
      if (busca.traduzidoDe) {
        infoLog(
          `[anime] "${busca.traduzidoDe}" → "${busca.termoTraduzido}" → "${busca.anime.title}"`,
        );
      }
      return followWithAnime({ socket, session, anime: busca.anime });
    }

    session.candidates = busca.candidatos;
    session.provider = busca.provider || session.provider;
    session.stage = "candidatos";
    touch(session);

    return sendCandidateList({ socket, session, busca });
  } catch (error) {
    dropSession(session);
    errorLog(`[anime] falha ao buscar "${nome}": ${error.message}`);
    await session.sendReply(`❌ ${error.message}`).catch(() => {});
    return false;
  }
}

/**
 * Continua o fluxo a partir de um anime já identificado: temporadas, ou os
 * episódios diretamente quando a fonte não agrupa temporadas.
 *
 * @returns {Promise<boolean>}
 */
async function followWithAnime({ socket, session, anime }) {
  const seasons = await getAnimeSeasons(
    anime.id,
    anime.provider,
    session.audioVersion || "",
  );

  session.anime = { ...anime };
  session.candidates = [];
  session.provider = anime.provider;
  session.seasons = seasons;
  session.seasonTitle = "";
  session.seasonSlug = "";
  session.episodes = [];
  session.episode = null;
  session.sources = [];
  session.audioVersions = [];

  // `session.audioVersion` NÃO é limpa aqui: a faixa escolhida antes da
  // pesquisa é a que seleciona os ids dos episódios e tem de sobreviver.

  // Só há passo de temporada quando a fonte agrupa 2+ títulos: um grupo de
  // um é o próprio anime e a escolha seria ruído.
  if (seasons.length > 1) {
    session.stage = "temporadas";
    infoLog(
      `[anime] "${anime.title}" (id ${anime.id}) tem ${seasons.length} temporadas`,
    );
    return sendSeasonList({ socket, session });
  }

  return loadEpisodesAndSend({ socket, session, id: anime.id });
}

/**
 * Envia a lista de candidatos quando a pesquisa não deu correspondência exata.
 *
 * A lista leva a CAPA de cada título (`capaEmTamanhoGrande`), porque é a única
 * forma de o utilizador distinguir remakes e temporadas homónimas — foi um
 * título parecido que fez o fluxo antigo servir o anime errado.
 *
 * A capa vai no cabeçalho do card (`image` + `interactiveButtons`), o formato
 * que o patch da Baileys renderiza: o carrossel (`cards`) NÃO pode ser usado
 * aqui porque ele substitui o `interactiveButtons` (ver `scripts/patch-baileys.mjs`),
 * e sem a lista o utilizador não conseguia escolher.
 *
 * @returns {Promise<boolean>}
 */
async function sendCandidateList({ socket, session, busca }) {
  const candidatos = session.candidates || [];
  const rows = [...buildCandidateRows(candidatos), cancelRow()];

  const traduzido = busca?.termoTraduzido
    ? `\n🔤 Traduzi *${busca.traduzidoDe}* → *${busca.termoTraduzido}* para procurar.`
    : "";

  const extra =
    candidatos.length === 1
      ? `Não encontrei um título exatamente igual. Será este?${traduzido}`
      : `Encontrei ${candidatos.length} títulos parecidos. Qual é o teu?${traduzido}`;

  const capa = capaEmTamanhoGrande(candidatos[0]?.image);

  return sendCard({
    socket,
    session,
    text: mediaCaption({
      titulo: candidatos[0]?.title || "Anime",
      canal: animeProviderLabel(session.provider),
      duracao: candidatos.length > 1 ? `${candidatos.length} opções` : "1 opção",
      qualidade: "—",
      extra,
      rodape: null,
    }),
    title: "Qual destes?",
    rows,
    image: capa || null,
    fallbackPrompt: "Responde com o número do anime 👇",
  });
}

/**
 * O utilizador escolheu um candidato da lista: continua o fluxo a partir dele.
 *
 * Guarda contra índice fora da lista (o menu pode ter expirado e o token chegar
 * depois): nesse caso a sessão é largada com um aviso, em vez de rebentar.
 *
 * @returns {Promise<boolean>}
 */
async function chooseCandidate({ socket, session, index }) {
  const escolhido = session.candidates?.[index];

  if (!escolhido) {
    dropSession(session);
    await session
      .sendReply("❌ Essa lista não está mais disponível. Envia .menu para recomeçar.")
      .catch(() => {});
    return true;
  }

  infoLog(`[anime] candidato escolhido: "${escolhido.title}"`);

  return followWithAnime({
    socket,
    session,
    anime: {
      id: escolhido.id,
      provider: session.provider,
      title: escolhido.title,
      image: escolhido.image || null,
      releaseDate: escolhido.year || null,
    },
  });
}

/**
 * Envia a lista de temporadas do título pesquisado.
 *
 * @returns {Promise<boolean>}
 */
async function sendSeasonList({ socket, session }) {
  session.stage = "temporadas";
  touch(session);

  const rows = [...buildSeasonRows(session.seasons), cancelRow()];

  return sendCard({
    socket,
    session,
    text: mediaCaption({
      titulo: session.anime?.title || "Anime",
      canal: animeProviderLabel(session.provider),
      duracao: `${session.seasons.length} temporadas`,
      qualidade: "—",
      extra: "📺 Escolhe a temporada que queres ver.",
      rodape: null,
    }),
    title: "Temporadas",
    rows,
    // A capa é a do título escolhido: é o que confirma visualmente que o fluxo
    // abriu o anime certo antes de listar as temporadas.
    image: capaEmTamanhoGrande(session.anime?.image) || null,
  });
}

/**
 * Carrega os episódios de uma entrada (o próprio anime ou uma temporada) e
 * envia a primeira página.
 *
 * @returns {Promise<boolean>}
 */
async function loadEpisodesAndSend({ socket, session, id }) {
  session.stage = "buscando";
  touch(session);

  try {
    const carregar = async (faixa) => {
      const info = await getAnimeInfo(id, session.provider, faixa);
      if (info.title) session.anime = { ...session.anime, title: info.title };
      return info.episodes;
    };

    const { lista, faixaAviso } = await carregarEpisodiosComFaixa({
      session,
      carregar,
      contexto: `id ${id}`,
    });

    session.episodes = lista;
    session.episode = null;
    session.sources = [];
    session.seasonTitle = "";
    session.seasonSlug = "";

    infoLog(
      `[anime] "${session.anime?.title}" (id ${id}) com ${lista.length} episódios`,
    );

    if (faixaAviso) {
      await session.sendReply(faixaAviso).catch(() => {});
    }

    return routeAfterEpisodes({ socket, session });
  } catch (error) {
    dropSession(session);
    errorLog(`[anime] falha ao buscar episódios (id ${id}): ${error.message}`);
    await session.sendReply(`❌ ${error.message}`).catch(() => {});
    return false;
  }
}

/**
 * Carrega os episódios na faixa pedida, com queda para a outra quando não há.
 *
 * O utilizador escolhe a faixa ANTES de a fonte ser conhecida, por isso pode
 * pedir dublado num título que só existe legendado. Servir a outra faixa em
 * silêncio é o defeito que este fluxo existe para corrigir. Aqui a escolha é
 * explícita: cai para a faixa que existe e DIZ que caiu, para o utilizador saber
 * o que vai receber.
 *
 * A verificação é feita sobre as FAIXAS PUBLICADAS na lista devolvida, e não
 * sobre o sucesso da chamada: "veio lista" não prova que a faixa pedida existe.
 * Sem esta verificação, pedir dublado num título só legendado devolvia o
 * legendado em silêncio — exatamente o defeito a corrigir.
 *
 * Três desfechos, por ordem:
 *
 * 1. a fonte serve a faixa pedida → nada a dizer;
 * 2. a fonte publica faixas mas não a pedida → avisa e fixa a que existe;
 * 3. a fonte não publica faixa nenhuma (`[]`) → fica em silêncio: não há nada
 *    para comparar, e um aviso com rótulo vazio seria pior do que não dizer
 *    nada. A escolha segue para a fonte, que a ignora.
 *
 * À parte da faixa, a DUBLAGEM tem uma questão de idioma que a faixa não
 * resolve: "dubbed" é um booleano no site, mas o idioma depende do SITE (o
 * meusanimes dubla em PT-BR). Quando a faixa servida é a dublada e a fonte não é
 * PT-BR, o aviso diz que o áudio é inglês — para o utilizador não receber
 * português na etiqueta e inglês no som.
 *
 * @returns {Promise<{lista: Array<object>, faixaAviso: string}>}
 */
async function carregarEpisodiosComFaixa({ session, carregar, contexto }) {
  const pedida = session.audioVersion || "";

  if (!pedida) return { lista: await carregar(""), faixaAviso: "" };

  let lista = null;
  try {
    lista = await carregar(pedida);

    // A fonte serviu mesmo a faixa pedida (ou não distingue faixas): feito.
    const versoes = availableAudioVersions(lista);
    if (!versoes.length || versoes.includes(pedida)) {
      return {
        lista,
        faixaAviso: avisoIdiomaDublagem(pedida, session.provider, ANIME_PT_DUB_PROVIDERS),
      };
    }
  } catch (error) {
    errorLog(`[anime] faixa "${pedida}" indisponível (${contexto}): ${error.message}`);
  }

  // A faixa pedida não existe: mostra a que existe e diz qual é.
  const alternativaLista = await carregar("");
  const versoes = availableAudioVersions(alternativaLista);

  if (!versoes.length || versoes.includes(pedida)) {
    return { lista: alternativaLista, faixaAviso: "" };
  }

  const alternativa = versoes[0];
  session.audioVersion = alternativa;

  return {
    lista: alternativaLista,
    faixaAviso:
      `⚠️ Esta fonte não tem ${audioVersionLabel(pedida).toLowerCase()} deste ` +
      `título. Vou mostrar ${audioVersionLabel(alternativa).toLowerCase()}.` +
      avisoIdiomaDublagem(alternativa, session.provider, ANIME_PT_DUB_PROVIDERS),
  };
}

/**
 * Decide o passo seguinte depois de os episódios estarem carregados.
 *
 * Pergunta a faixa (Legendado/Dublado) só quando a lista inteira publica as
 * duas — perguntar por um episódio que só tem uma delas seria uma escolha falsa.
 * Quando há uma só faixa, fica logo fixada sem incomodar o utilizador; quando a
 * fonte não distingue faixas (`[]`), o fluxo segue como sempre.
 *
 * @returns {Promise<boolean>}
 */
async function routeAfterEpisodes({ socket, session }) {
  const versoes = availableAudioVersions(session.episodes);

  session.audioVersions = versoes;

  // A faixa é escolhida ANTES da pesquisa, por isso não se pergunta aqui outra
  // vez: sobrepor-se-ia à escolha do utilizador. Só se fixa sozinha quando não
  // houve escolha (caminho antigo ou recarga) — e uma só faixa publicada é a
  // única resposta possível.
  if (!session.audioVersion) {
    session.audioVersion = versoes.length === 1 ? versoes[0] : "";
  }

  session.episode = null;
  session.sources = [];
  session.stage = "episodios";

  return sendEpisodePage({ socket, session, page: 0 });
}

/**
 * Pergunta a faixa (Legendado / Dublado) ANTES de pesquisar.
 *
 * A pergunta vem primeiro porque é isso que o utilizador pediu e porque é a
 * única ordem honesta: só depois de saber a faixa é que faz sentido procurar —
 * um título que só existe legendado nunca poderia satisfazer um pedido de
 * dublado, e descobri-lo no fim obrigava o utilizador a repetir o pedido todo.
 *
 * Oferece sempre as duas faixas: a fonte é que decide se as tem. Quando não tem
 * a faixa pedida, o passo seguinte avisa e cai para a que existe (ver
 * `carregarEpisodiosComFaixa`) em vez de servir o áudio errado em silêncio.
 *
 * @returns {Promise<boolean>}
 */
async function askAudioBeforeSearch({ socket, session }) {
  session.stage = "faixas";
  touch(session);

  const rows = [...buildAudioRows(AUDIO_VERSIONS), cancelRow()];

  return sendCard({
    socket,
    session,
    text: mediaCaption({
      titulo: session.pendingName || "Anime",
      canal: "Menu de animes",
      duracao: "—",
      qualidade: "—",
      extra: "🔊 Como queres ver? Escolhe a faixa de áudio.",
      rodape: null,
    }),
    title: "Áudio",
    rows,
  });
}

/**
 * Aplica a faixa escolhida e segue para a pesquisa (ou recarrega a lista).
 *
 * Dois caminhos, conforme a altura do fluxo:
 *
 * - ANTES de pesquisar (`pendingName` preenchido): a faixa é fixada e a pesquisa
 *   arranca já com ela. É o caminho normal.
 * - DEPOIS de a lista existir: recarrega os episódios na faixa nova. O
 *   `meusanimes` publica ids por faixa, pelo que a lista muda com a escolha.
 *
 * A validação muda com o caminho. Antes da pesquisa oferecem-se sempre as duas
 * faixas, pelo que qualquer uma é aceitável — é a fonte que dirá se a tem. Com a
 * lista carregada, a faixa é validada contra as que ela publica: um token antigo
 * (o site mudou) ou forjado não pode fixar uma faixa inexistente, senão o
 * download falharia mais tarde com um erro difícil de entender.
 *
 * @returns {Promise<boolean>}
 */
async function chooseAudioVersion({ socket, session, version }) {
  const antesDaPesquisa = Boolean(session.pendingName);

  if (!AUDIO_VERSIONS.includes(version)) {
    dropSession(session);
    await session.sendReply(
      "❌ Essa faixa não existe. Envia .menu para recomeçar.",
    ).catch(() => {});
    return true;
  }

  if (!antesDaPesquisa && !(session.audioVersions || []).includes(version)) {
    dropSession(session);
    await session.sendReply(
      "❌ Essa faixa já não está disponível. Envia .menu para recomeçar.",
    ).catch(() => {});
    return true;
  }

  session.audioVersion = version;
  infoLog(`[anime] faixa escolhida: ${version}`);

  if (antesDaPesquisa) {
    return searchAndSendEpisodes({ socket, session, nome: session.pendingName });
  }

  return reloadEpisodesForAudio({ socket, session });
}

/**
 * Recarrega os episódios com a faixa já fixada.
 *
 * O `meusanimes` publica ids por faixa, pelo que a lista muda com a escolha.
 *
 * @returns {Promise<boolean>}
 */
async function reloadEpisodesForAudio({ socket, session }) {
  const carregar = async (faixa) => {
    if (session.seasonSlug) {
      return getSeasonEpisodes(session.seasonSlug, session.provider, faixa);
    }
    const info = await getAnimeInfo(session.anime?.id, session.provider, faixa);
    return info.episodes;
  };

  try {
    const { lista } = await carregarEpisodiosComFaixa({
      session,
      carregar,
      contexto: session.seasonSlug || session.anime?.id,
    });

    if (lista?.length) session.episodes = lista;
  } catch (error) {
    // A lista antiga continua válida se a recarga falhar; a faixa fica como
    // estava em vez de deixar o utilizador sem lista.
    errorLog(`[anime] recarga da faixa "${session.audioVersion}" falhou: ${error.message}`);
  }

  session.episode = null;
  session.sources = [];

  return sendEpisodePage({ socket, session, page: 0 });
}

/**
 * Troca a lista de episódios pela da temporada escolhida.
 *
 * @returns {Promise<boolean>}
 */
async function chooseSeasonAndSendEpisodes({ socket, session, seasonIndex }) {
  const temporada = session.seasons?.[seasonIndex];
  if (!temporada?.slug) {
    dropSession(session);
    await session.sendReply(
      "❌ Essa temporada não está mais disponível. Envia .menu para recomeçar.",
    ).catch(() => {});
    return true;
  }

  session.stage = "buscando";
  touch(session);

  try {
    const carregar = (faixa) =>
      getSeasonEpisodes(temporada.slug, session.provider, faixa);

    const { lista, faixaAviso } = await carregarEpisodiosComFaixa({
      session,
      carregar,
      contexto: temporada.slug,
    });

    session.episodes = lista;
    session.episode = null;
    session.sources = [];
    session.seasonTitle = temporada.title;
    session.seasonSlug = temporada.slug;

    infoLog(
      `[anime] temporada "${temporada.title}" com ${lista.length} episódios`,
    );

    if (faixaAviso) {
      await session.sendReply(faixaAviso).catch(() => {});
    }

    return routeAfterEpisodes({ socket, session });
  } catch (error) {
    dropSession(session);
    errorLog(`[anime] falha na temporada "${temporada.slug}": ${error.message}`);
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
      titulo: session.seasonTitle
        ? `${session.anime?.title || "Anime"} — ${session.seasonTitle}`
        : session.anime?.title || "Anime",
      canal: animeProviderLabel(session.provider),
      duracao: `${total} episódios`,
      qualidade: `Episódios ${inicio}–${fim}`,
      extra: faltam
        ? `🎬 Faltam ${faltam}. Usa *Ver mais episódios* em baixo.`
        : "🎬 Estes são os últimos episódios.",
      rodape: null,
    }),
    title: "Episódios",
    rows,
    // Mesma capa do passo anterior: a lista de episódios continua a confirmar
    // qual é o título aberto.
    image: capaEmTamanhoGrande(session.anime?.image) || null,
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
    // Fonte única: o id do episódio é o da própria fonte, pelo que não há
    // fallback para reencontrar o episódio noutro site.
    const sources = await getEpisodeSources(
      episode.id,
      session.provider,
      session.audioVersion || "",
    );

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
        qualidade: session.audioVersion
          ? `${audioTrackLabel(session.audioVersion, session.provider, ANIME_PT_DUB_PROVIDERS)} · Escolhe a qualidade`
          : "Escolha a qualidade",
        extra:
          `⬇️ Escolhe a qualidade: as mais altas pesam mais. ` +
          `Acima de ${ANIME_DOCUMENT_LIMIT_MB} MB o envio é cancelado.`,
        rodape: null,
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
 * Argumentos extra do yt-dlp.
 *
 * O meusanimes serve o episódio pelo CDN do Google Video (Blogger), que exige o
 * `Referer` do Blogger E um User-Agent de browser: sem o User-Agent responde 403
 * mesmo com o Referer certo. Os MP4 são degraus diretos (360p/720p), pelo que
 * não há `impersonate` nem `Referer` de player a acrescentar.
 *
 * @returns {string[]}
 */
function animeDownloadArgs() {
  return ARGS_BLOGGER;
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
  const alturaMaxima = ANIME_MAX_HEIGHT;

  // Cada episódio baixado custa ANIME_EPISODE_CREDITS. A verificação é feita
  // ANTES de arrancar o download: o dono do bot não gasta e um episódio não
  // começa sem saldo para o pagar.
  const contaId = session.ownerId;
  const cobrar = contaId && contaId !== OWNER_LID;

  if (cobrar) {
    const saldo = hasSufficientCredits(contaId, ANIME_EPISODE_CREDITS);

    if (!saldo.ok) {
      dropSession(session);
      await session.sendReply(
        creditsExhaustedMessage({
          commandName: "anime",
          cost: ANIME_EPISODE_CREDITS,
          account: saldo.account,
        }),
      ).catch(() => {});
      return true;
    }
  }

  dropSession(session);
  await session.sendReply("⬇️ Baixando o episódio...").catch(() => {});

  if (!(await isYtDlpAvailable())) {
    await session.sendReply(
      "❌ O yt-dlp não está disponível neste servidor, então não consigo baixar o episódio.",
    ).catch(() => {});
    return true;
  }

  let result;
  let pago = 0;

  try {
    if (cobrar) {
      const charge = chargeCredits(contaId, ANIME_EPISODE_CREDITS, {
        reason: "anime:episodio",
        countUsage: true,
      });

      if (!charge.ok) {
        await session.sendReply(
          creditsExhaustedMessage({
            commandName: "anime",
            cost: ANIME_EPISODE_CREDITS,
            account: charge.account,
          }),
        ).catch(() => {});
        return true;
      }

      pago = charge.charged;
    }

    result = await withCreditsContext(session.ownerId, () =>
      withDownloadSlot(
        () =>
          downloadWithYtDlp(source.url, {
            // A fonte HLS traz vários degraus no mesmo URL, por isso o limite de
            // altura escolhe o degrau. Uma fonte MP4 direta (meusanimes) já É o
            // degrau escolhido no menu: filtrar por altura
            // não teria efeito e podia descartar o formato único disponível.
            height: source.isM3U8 ? alturaMaxima : "best",
            maxBytes: ANIME_MAX_DOWNLOAD_BYTES,
            extraArgs: animeDownloadArgs(),
          }),
        { priority: session.ownerId === OWNER_LID },
      ),
    );

    const tamanhoMB = result.fileSize / (1024 * 1024);
    const acao = decideAnimeSend(result.fileSize);

    const caption = mediaCaption({
      titulo: `${animeTitulo} — Ep. ${episode?.number ?? "?"}`,
      canal: animeProviderLabel(session.provider),
      duracao: result.durationString || "Não disponível",
      qualidade: session.audioVersion
        ? `${audioTrackLabel(session.audioVersion, session.provider, ANIME_PT_DUB_PROVIDERS)} · ${source.label}`
        : source.label,
    });
    const nomeArquivo = safeMediaFileName(
      `${animeTitulo} — Ep. ${episode?.number ?? "?"}`,
    );

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
        fileName: nomeArquivo,
        caption,
      });
    } else {
      // Sem o `moov` no início o WhatsApp responde "vídeo não está disponível":
      // o `withPreparedVideo` remuxa/transcode e apaga o temporário no fim.
      await withPreparedVideo(result.filePath, async (filePath) => {
        infoLog(`[anime] enviando como vídeo (${tamanhoMB.toFixed(1)} MB)`);
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
    errorLog(`[anime] falha no download: ${error.message}`);

    // Não se cobra um episódio que não foi entregue.
    if (pago > 0) {
      refundCredits(contaId, pago);
      pago = 0;
    }

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
  let value = String(text || "").trim();
  if (!value) return false;

  const isAnimeToken = () =>
    ANIME_TOKEN_PREFIXES.some((token) => value.startsWith(token));
  let isCancel = value === CANCEL_TOKEN;

  const senderJids = [senderLid, ...senderLids].filter(Boolean);
  const ownerId = getOwnerId(chatId, senderLid);
  const own = ownerId
    ? sessoesAnime.get(animeSessionKey(chatId, ownerId)) || null
    : null;
  // Se a chave exata falhar (formas de JID diferentes), procura no chat uma
  // sessão cujo autor tenha a MESMA identidade — e não apenas "a primeira".
  const doChat =
    own || findSessionInChat(chatId, senderJids) || findSessionInChat(chatId);

  // Escolha por NÚMERO: vale a linha nessa posição do último card enviado. É o
  // que torna o menu de animes utilizável no modo texto (`!`) e no fallback,
  // onde não há botões para tocar — a linha guardada traz o token que o resto
  // do handler já sabe tratar, pelo que não há lógica duplicada por passo.
  // Resolve-se ANTES do cancelamento: "3" pode ser a linha do Cancelar. Só o
  // autor da sessão converte (o número de outro membro não mexe neste menu).
  if (
    !isAnimeToken() &&
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

  // Um token de anime sem sessão (menu expirado) merece aviso claro.
  if (isAnimeToken() && !doChat) {
    await sendReply(
      "⏳ Este menu de animes expirou. Envia .menu para recomeçar.",
    ).catch(() => {});
    return true;
  }

  if (isCancel) {
    if (!doChat) return false;
    // Só o dono da sessão a pode cancelar; outros não a destroem.
    // Quem não é o dono fica em silêncio: o aviso "não foste tu que pediste"
    // transformava qualquer mensagem no grupo numa resposta do bot. A mensagem
    // segue o fluxo normal (um comando continua a funcionar), mas sem resposta
    // o menu fica à espera do dono.
    if (!isSessionOwner(doChat, ...senderJids)) return false;
    dropSession(doChat);
    await sendReply("❌ Menu de animes cancelado.").catch(() => {});
    return true;
  }

  // Sessão encontrada por identidade (não pela chave exata): adota-a para o
  // resto do fluxo, alargando as formas de JID conhecidas do autor.
  const sessao = own || (doChat && isSessionOwner(doChat, ...senderJids) ? doChat : null);

  // Sem sessão nossa, não há nada para tratar aqui: a mensagem segue o fluxo
  // normal em silêncio (antes respondia-se "este menu é de @X", o que fazia o
  // bot responder a qualquer mensagem do grupo).
  if (!sessao) return false;

  if (own && senderJids.length) {
    for (const jid of senderJids) {
      for (const identidade of jidIdentities(jid)) {
        own.identidades.add(identidade);
      }
    }
  }

  if (isAnimeToken()) {
    if (sendReply) sessao.sendReply = sendReply;

    const candIndex = animeTokenIndex(value, "anm:an:");
    if (candIndex >= 0) {
      return chooseCandidate({ socket, session: sessao, index: candIndex });
    }

    const seaIndex = animeTokenIndex(value, "anm:sea:");
    if (seaIndex >= 0) {
      return chooseSeasonAndSendEpisodes({
        socket,
        session: sessao,
        seasonIndex: seaIndex,
      });
    }

    const epIndex = animeTokenIndex(value, "anm:ep:");
    if (epIndex >= 0) {
      return sendQualityList({ socket, session: sessao, episodeIndex: epIndex });
    }

    if (value.startsWith("anm:aud:")) {
      return chooseAudioVersion({
        socket,
        session: sessao,
        version: value.slice("anm:aud:".length).trim().toLowerCase(),
      });
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
    // Outro membro escreveu enquanto o dono ainda não disse o nome: fica em
    // silêncio e a sessão continua à espera do dono. Avisar aqui respondia a
    // cada mensagem do grupo.
    if (!isSessionOwner(sessao, ...senderJids)) return false;

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
    sessao.pendingName = value;
    return askAudioBeforeSearch({ socket, session: sessao });
  }

  return false;
}
