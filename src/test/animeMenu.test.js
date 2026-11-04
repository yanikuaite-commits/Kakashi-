import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ANIME_EPISODE_CREDITS, DATABASE_DIR } from "../config.js";
import { accountBalance, addCredits, chargeCredits, getAccount } from "../services/credits.js";
import {
  getAnimeSession,
  handleAnimeReply,
  resetAnimeSessions,
  startAnimeFlow,
} from "../utils/animeMenu.js";

process.env.SAIMO_CATALOG_BASE = "https://catalogo.saimo.test";

// Os testes de fluxo abaixo substituem a rede pelo catálogo do saimo, a fonte
// única, para exercitar o menu sem tocar em nenhum site.

const CHAT = "120363000000000000@g.us";
const LID = "987654321098765:12@lid";
const PN = "244991234567@s.whatsapp.net";

/** Limpa a cache do catálogo entre testes (o processo reutiliza o módulo). */
async function limparCache() {
  const { limparCacheAnimes } = await import("../services/saimoAnime.js");
  limparCacheAnimes();
}

test.beforeEach(async () => {
  await limparCache();
});

function makeSocket() {
  return { sendMessage: async () => ({ key: { id: "m" } }) };
}

async function abrirMenu(ownerLid, senderLids) {
  const replies = [];
  await startAnimeFlow({
    socket: makeSocket(),
    chatId: CHAT,
    ownerLid,
    ownerName: "Yanik Uaite",
    sendReply: async (text) => replies.push(String(text)),
    senderLids,
  });
  return replies;
}

/* ─────────── Posse do menu (JID em formas diferentes) ─────────── */

/**
 * Regressão do bug: "Fui eu a mandar o menu mas o bot nega".
 *
 * O autor abria o menu com uma forma de JID e a resposta chegava com outra
 * (`@lid` vs número, com/sem sufixo de aparelho). A comparação por string
 * exata tratava o próprio autor como estranho.
 *
 * O caminho do token `anm:ep:<i>` chega a `sendQualityList`, que sem episódios
 * responde "não está mais disponível" SEM ir à rede — por isso dá para provar
 * que o autor passou pelo portão de posse sem chamar a API.
 */
test("o autor passa o portão de posse mesmo com forma de JID diferente", async () => {
  resetAnimeSessions();
  await abrirMenu(LID, [LID, PN]);

  const replies = [];
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: PN, // forma diferente da abertura
    senderLids: [PN, LID],
    senderName: "Yanik Uaite",
    text: "anm:ep:0",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, true);
  assert.equal(
    replies.some((r) => /Só quem pediu/i.test(r)),
    false,
    "o autor não pode ser tratado como estranho",
  );
  assert.match(replies[0], /não está mais disponível/i);
});

test("o autor cancela o próprio menu mesmo com forma de JID diferente", async () => {
  resetAnimeSessions();
  await abrirMenu(LID, [LID, PN]);

  const replies = [];
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: PN,
    senderLids: [PN, LID],
    text: "anm:cancel",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, true);
  assert.equal(replies.some((r) => /Só quem pediu/i.test(r)), false);
  assert.match(replies[0], /cancelado/i);
});

test("outro membro é ignorado em silêncio e não mexe no menu", async () => {
  resetAnimeSessions();
  await abrirMenu(LID, [LID, PN]);

  const replies = [];
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: "555555555555555@lid",
    senderLids: ["555555555555555@lid"],
    senderName: "Outra Pessoa",
    text: "anm:ep:0",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, false, "a mensagem de terceiros segue o fluxo normal");
  assert.deepEqual(
    replies,
    [],
    "avisar aqui fazia o bot responder a qualquer mensagem do grupo",
  );
});

test("outro membro não cancela o menu do autor", async () => {
  resetAnimeSessions();
  await abrirMenu(LID, [LID, PN]);

  const replies = [];
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: "555555555555555@lid",
    senderLids: ["555555555555555@lid"],
    text: "anm:cancel",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, false);
  assert.deepEqual(replies, [], "o menu do autor tem de continuar de pé, sem resposta");
});

test("texto de outro membro à espera do nome fica em silêncio", async () => {
  resetAnimeSessions();
  await abrirMenu(LID, [LID, PN]);

  const replies = [];
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: "555555555555555@lid",
    senderLids: ["555555555555555@lid"],
    senderName: "Outra Pessoa",
    text: "bom dia pessoal",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, false, "o texto não é nome de anime do dono");
  assert.deepEqual(
    replies,
    [],
    "a conversa do grupo não pode virar \"não foste tu que pediste o menu\"",
  );
  assert.equal(
    getAnimeSession(CHAT, LID).stage,
    "aguardando_nome",
    "a sessão continua à espera do nome, agora dado pelo dono",
  );
});

test("token de anime sem sessão avisa que o menu expirou", async () => {
  resetAnimeSessions();

  const replies = [];
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: LID,
    senderLids: [LID],
    text: "anm:ep:0",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, true);
  assert.match(replies[0], /expirou/i);
});

test("anm:sea com sessão inexistente avisa que o menu expirou", async () => {
  resetAnimeSessions();

  const replies = [];
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: LID,
    senderLids: [LID],
    text: "anm:sea:0",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, true);
  assert.match(replies[0], /expirou/i);
});

/* ─────────── Rede stubada (catálogo do saimo) ─────────── */

// O catálogo de animes do saimo é um ficheiro de texto com blocos `@Título` e
// linhas `temporada  episódio  versão  urls` (separadas por TAB). O stub imita-o
// para exercitar o parsing real sem tocar em nenhum site.

const CATALOGO_NARUTO_UMA = [
  "@Naruto\t2002\t46260",
  "1\t1\tsub\thttps://embed.saimo.test/cdn/naruto-1/master.txt",
  "1\t2\tsub\thttps://embed.saimo.test/cdn/naruto-2/master.txt",
].join("\n");

const CATALOGO_NARUTO_DUAS = [
  "@Naruto\t2002\t46260",
  "1\t1\tsub\thttps://embed.saimo.test/cdn/naruto-1-1/master.txt",
  "1\t2\tsub\thttps://embed.saimo.test/cdn/naruto-1-2/master.txt",
  "2\t1\tsub\thttps://embed.saimo.test/cdn/naruto-2-1/master.txt",
].join("\n");

const CATALOGO_NARUTO_DUB = [
  "@Naruto\t2002\t46260",
  "1\t1\tdub\thttps://embed.saimo.test/cdn/naruto-1/master.txt",
  "1\t2\tdub\thttps://embed.saimo.test/cdn/naruto-2/master.txt",
].join("\n");

const CATALOGO_BOKU = [
  "@Boku no Hero Academia\t2016\t31910",
  "1\t1\tsub\thttps://embed.saimo.test/cdn/boku-1/master.txt",
].join("\n");

// O `master.txt` de cada episódio traz os degraus (360p/720p).
const MASTER = [
  "#EXTM3U",
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,NAME="360p"',
  "360/index.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,NAME="720p"',
  "720/index.m3u8",
].join("\n");

/** Rede fixa: catálogo de animes e o master HLS de cada episódio. */
function stubFetch(respostas = {}) {
  const pedidos = [];

  globalThis.fetch = async (url) => {
    const alvo = String(url);
    pedidos.push(alvo);

    const chave = Object.keys(respostas).find((k) =>
      alvo.toLowerCase().includes(k.toLowerCase()),
    );

    const corpo =
      chave !== undefined
        ? respostas[chave]
        : alvo.includes("master.txt")
          ? MASTER
          : "";

    return {
      ok: true,
      status: 200,
      text: async () => corpo,
      json: async () => JSON.parse(corpo || "null"),
    };
  };

  return pedidos;
}

function makeCapturingSocket(enviados) {
  return {
    sendMessage: async (_chat, content) => {
      enviados.push(content);
      return { key: { id: "m" } };
    },
  };
}

function rowIds(card) {
  return (card?.interactiveButtons || [])
    .map((b) => JSON.parse(b.buttonParamsJson || "{}"))
    .find((p) => p.sections)?.sections?.[0]?.rows
    ?.map((r) => r.id) || [];
}

/* ─────────── Fluxo: faixa → episódios → temporadas ─────────── */

test("cards de anime não repetem o rodapé (o card já leva footer)", async () => {
  resetAnimeSessions();

  const enviados = [];
  // Sem rede: o card da faixa é montado offline, antes de qualquer pesquisa.
  await startAnimeFlow({
    socket: makeCapturingSocket(enviados),
    chatId: CHAT,
    ownerLid: LID,
    ownerName: "Yanik Uaite",
    sendReply: async () => {},
    nome: "attack on titan",
  });

  const cardFaixas = enviados[0];
  assert.equal(
    cardFaixas.text.split("✦ Constelado por Yanik Uaite ✦").length - 1,
    0,
    "o corpo do card não repete o rodapé que já vai em footer",
  );
  assert.equal(
    cardFaixas.footer,
    "✦ Constelado por Yanik Uaite ✦",
    "o rodapé continua a ir no footer do card",
  );
});

test("a faixa é perguntada ANTES de pesquisar (e a pesquisa usa a escolhida)", async () => {
  resetAnimeSessions();
  const pedidos = stubFetch({
    "links-animes.txt": CATALOGO_NARUTO_DUB,
  });

  try {
    const enviados = [];
    const socket = makeCapturingSocket(enviados);

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "naruto",
    });

    assert.equal(getAnimeSession(CHAT, LID).stage, "faixas", "para na escolha da faixa");
    assert.equal(
      pedidos.length,
      0,
      "nenhuma pesquisa antes de o utilizador escolher a faixa",
    );

    const ids = rowIds(enviados[0]);
    assert.ok(ids.includes("anm:aud:subbed"), "oferece Legendado");
    assert.ok(ids.includes("anm:aud:dubbed"), "oferece Dublado");
    assert.ok(
      !ids.some((id) => id.startsWith("anm:ep:")),
      "ainda NÃO mostra episódios: a faixa vem primeiro",
    );

    await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "anm:aud:dubbed",
      sendReply: async () => {},
    });

    assert.equal(getAnimeSession(CHAT, LID).stage, "episodios");
    assert.equal(getAnimeSession(CHAT, LID).audioVersion, "dubbed");
    assert.ok(pedidos.length > 0, "só agora é que a pesquisa corre");
    assert.ok(rowIds(enviados[1]).includes("anm:ep:0"), "agora sim mostra os episódios");
  } finally {
    delete globalThis.fetch;
  }
});

test("anm:sea carrega os episódios da temporada escolhida", async () => {
  resetAnimeSessions();
  stubFetch({
    "links-animes.txt": CATALOGO_NARUTO_DUAS,
  });

  try {
    const enviados = [];
    const socket = makeCapturingSocket(enviados);

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "naruto",
    });

    await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "anm:aud:subbed",
      sendReply: async () => {},
    });

    const idsTemporadas = rowIds(enviados[1]);
    assert.ok(idsTemporadas.includes("anm:sea:0"), "oferece a temporada 1");
    assert.ok(idsTemporadas.includes("anm:sea:1"), "oferece a temporada 2");
    assert.equal(getAnimeSession(CHAT, LID).stage, "temporadas");

    await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "anm:sea:1",
      sendReply: async () => {},
    });

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.stage, "episodios");
    assert.equal(sessao.episodes.length, 1, "a temporada 2 tem 1 episódio");
    const partes = String(sessao.episodes[0].id).split("::");
    assert.equal(partes.length, 3, "o id tem 3 partes (token da temporada::ep::ids)");
    assert.equal(partes[1], "1", "o episódio é o nº 1 da temporada 2");
  } finally {
    delete globalThis.fetch;
  }
});

test("sem temporadas agrupadas, salta direto para os episódios", async () => {
  resetAnimeSessions();
  stubFetch({
    "links-animes.txt": CATALOGO_NARUTO_UMA,
  });

  try {
    const enviados = [];
    const socket = makeCapturingSocket(enviados);

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "naruto",
    });

    await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "anm:aud:subbed",
      sendReply: async () => {},
    });

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.stage, "episodios", "vai direto para os episódios");
    assert.equal(sessao.episodes.length, 2);

    const ids = rowIds(enviados[1]);
    assert.ok(ids.includes("anm:ep:0"), "mostra os episódios logo");
    assert.ok(
      !ids.some((id) => id.startsWith("anm:sea:")),
      "não mostra passo de temporada",
    );
  } finally {
    delete globalThis.fetch;
  }
});

test("modo texto: cards saem em texto numerado e o número escolhe a linha", async () => {
  resetAnimeSessions();
  stubFetch({
    "links-animes.txt": CATALOGO_NARUTO_UMA,
  });

  try {
    const enviados = [];
    const replies = [];
    const socket = makeCapturingSocket(enviados);

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async (text) => replies.push(String(text)),
      nome: "naruto",
      textOnly: true,
    });

    assert.deepEqual(enviados, [], "modo texto não envia cards");
    assert.equal(replies.length, 1);
    assert.match(replies[0], /1\. .*Legendado/i);
    assert.doesNotMatch(replies[0], /Não consegui abrir o menu interativo/);

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.textOnly, true);
    assert.equal(sessao.stage, "faixas");
    assert.ok(sessao.lastRows.length >= 2, "as linhas do card ficam guardadas");

    const consumiu = await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "1",
      sendReply: async (text) => replies.push(String(text)),
    });

    assert.equal(consumiu, true);
    assert.equal(getAnimeSession(CHAT, LID).audioVersion, "subbed");
    assert.deepEqual(enviados, [], "os episódios também saem em texto");
    assert.equal(getAnimeSession(CHAT, LID).stage, "episodios");
    assert.match(replies.at(-1), /1\. Episódio 1/i);
  } finally {
    delete globalThis.fetch;
  }
});

test("modo texto: número fora do intervalo não consome a linha", async () => {
  resetAnimeSessions();
  await startAnimeFlow({
    socket: makeSocket(),
    chatId: CHAT,
    ownerLid: LID,
    ownerName: "Yanik Uaite",
    sendReply: async () => {},
    nome: "naruto",
    textOnly: true,
  });

  const sessao = getAnimeSession(CHAT, LID);
  assert.equal(sessao.stage, "faixas");
  const linhas = sessao.lastRows.length;

  const replies = [];
  // O menu das faixas tem 3 linhas (legendado, dublado, cancelar): "9" não
  // corresponde a nenhuma e a mensagem segue o fluxo normal.
  const consumiu = await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: LID,
    senderLids: [LID],
    text: "9",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.equal(consumiu, false, "número inválido segue o fluxo normal");
  assert.deepEqual(replies, []);
  assert.equal(getAnimeSession(CHAT, LID).stage, "faixas");
  assert.equal(getAnimeSession(CHAT, LID).lastRows.length, linhas);
});

/* ─────────── Faixa de áudio: aviso e queda ─────────── */

test("faixa pedida que a fonte não tem: avisa e cai para a que existe", async () => {
  resetAnimeSessions();
  // A página do episódio marca "Legendado": a entrada só tem essa faixa.
  stubFetch({
    "links-animes.txt": CATALOGO_NARUTO_UMA,
  });

  try {
    const replies = [];
    const socket = makeSocket();

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async (text) => replies.push(String(text)),
      nome: "naruto",
    });

    await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "anm:aud:dubbed",
      sendReply: async (text) => replies.push(String(text)),
    });

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.stage, "episodios", "não deixa o utilizador sem lista");
    assert.equal(sessao.audioVersion, "subbed", "cai para a única faixa que existe");
    assert.ok(
      replies.some((r) => /não tem dublado/i.test(r) && /legendado/i.test(r)),
      "diz explicitamente que caiu para o legendado",
    );
  } finally {
    delete globalThis.fetch;
  }
});

test("faixa dublada pedida e disponível não gera aviso", async () => {
  resetAnimeSessions();
  stubFetch({
    "links-animes.txt": CATALOGO_NARUTO_DUB,
  });

  try {
    const replies = [];
    const socket = makeSocket();

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async (text) => replies.push(String(text)),
      nome: "naruto",
    });

    await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "anm:aud:dubbed",
      sendReply: async (text) => replies.push(String(text)),
    });

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.stage, "episodios");
    assert.equal(sessao.audioVersion, "dubbed", "a faixa pedida foi servida");
    assert.equal(
      replies.filter((r) => /não tem/i.test(r)).length,
      0,
      "a dublagem PT-BR do meusanimes não precisa de aviso",
    );
  } finally {
    delete globalThis.fetch;
  }
});

/* ─────────── Paginação e card do dono ─────────── */

test("anm:pg avança para os episódios seguintes com índice absoluto", async () => {
  resetAnimeSessions();
  await abrirMenu(LID, [LID]);

  // Injeta a lista de episódios sem ir à rede (o passo de pesquisa é o único
  // que a usa) e prova a navegação que o requisito "todos os episódios" exige.
  const sessao = getAnimeSession(CHAT, LID);
  sessao.episodes = Array.from({ length: 25 }, (_, i) => ({
    id: `ep-${i}`,
    number: i + 1,
    title: `Episódio ${i + 1}`,
  }));

  const enviados = [];
  const socket = makeCapturingSocket(enviados);

  const consumiu = await handleAnimeReply({
    socket,
    chatId: CHAT,
    senderLid: LID,
    senderLids: [LID],
    text: "anm:pg:1",
    sendReply: async () => {},
  });

  assert.equal(consumiu, true);
  assert.equal(getAnimeSession(CHAT, LID).page, 1);

  const ids = rowIds(enviados[0]);
  assert.ok(ids.includes("anm:ep:10"), "a segunda página começa no índice 10");
  assert.ok(ids.includes("anm:ep:19"), "e termina no 19");
  assert.ok(ids.includes("anm:pg:2"), "tem o botão para a página seguinte");
  assert.equal(
    ids.filter((id) => id.startsWith("anm:pg:")).length,
    1,
    "só um botão de paginação (nada de retroceder)",
  );
});

test("card de animes leva o botão do dono e mantém Canal", async () => {
  resetAnimeSessions();
  const enviados = [];
  const socket = makeCapturingSocket(enviados);

  // Sem `nome`: o card inicial é montado offline (não vai à rede).
  await startAnimeFlow({
    socket,
    chatId: CHAT,
    ownerLid: LID,
    ownerName: "Y",
    sendReply: async () => {},
  });

  const botoes = enviados.at(-1).interactiveButtons;
  const cta = botoes
    .filter((b) => b.name === "cta_url")
    .map((b) => JSON.parse(b.buttonParamsJson));

  const dono = cta.find((p) => p.display_text === "👑 Dono");
  assert.deepEqual(dono, {
    display_text: "👑 Dono",
    url: "https://wa.me/258834788141",
  });

  const canal = cta.find((p) => p.display_text === "📢 Canal");
  assert.ok(canal, "o Canal continua no card");
  assert.ok(botoes.length <= 3, "no máximo 3 botões por card");
});

/* ─────────── Cobrança de créditos por episódio ─────────── */

/**
 * O download custa ANIME_EPISODE_CREDITS e é verificado ANTES de arrancar.
 * Sem yt-dlp instalado, o fluxo para antes de tocar na rede, o que permite
 * provar o portão de saldo e a mensagem de créditos.
 */
test("episódio sem saldo é bloqueado antes do download", async () => {
  resetAnimeSessions();
  const dbDir = DATABASE_DIR;
  const creditsFile = path.join(dbDir, "credits.json");
  const subscriptionsFile = path.join(dbDir, "subscriptions.json");
  const anterior = await readFile(creditsFile, "utf8").catch(() => null);
  const assinaturasAnteriores = await readFile(subscriptionsFile, "utf8").catch(
    () => null,
  );
  await writeFile(creditsFile, "{}");
  await writeFile(subscriptionsFile, "{}");

  try {
    const chatId = "120363111111111111@g.us";
    const ownerLid = "258840000111@lid";
    const socket = makeSocket();

    await startAnimeFlow({
      socket,
      chatId,
      ownerLid,
      ownerName: "Y",
      sendReply: async () => {},
    });

    const session = getAnimeSession(chatId, ownerLid);
    session.stage = "qualidades";
    session.provider = "meusanimes";
    session.anime = { title: "KAIJU GIRLS" };
    session.episode = { index: 0, number: 1, title: "", id: "ep-1" };
    session.sources = [{ url: "https://exemplo.invalido/a.m3u8", label: "480p" }];

    // Zera o saldo: o episódio não pode começar.
    chargeCredits(ownerLid, accountBalance(getAccount(ownerLid)));

    const replies = [];
    await handleAnimeReply({
      socket,
      chatId,
      senderLid: ownerLid,
      senderLids: [ownerLid],
      senderName: "Y",
      text: "anm:src:0",
      sendReply: async (text) => replies.push(String(text)),
    });

    assert.ok(
      replies.some((r) => /créditos acabaram/i.test(r)),
      `esperava o aviso de créditos: ${replies.join(" | ")}`,
    );
    assert.equal(accountBalance(getAccount(ownerLid)), 0, "nada foi cobrado");
  } finally {
    resetAnimeSessions();
    for (const [ficheiro, guardado] of [
      [creditsFile, anterior],
      [subscriptionsFile, assinaturasAnteriores],
    ]) {
      if (guardado === null) {
        await rm(ficheiro, { force: true });
      } else {
        await writeFile(ficheiro, guardado);
      }
    }
  }
});

test("com saldo, o episódio passa do portão e cobra o preço do episódio", async () => {
  resetAnimeSessions();
  const creditsFile = path.join(DATABASE_DIR, "credits.json");
  const subscriptionsFile = path.join(DATABASE_DIR, "subscriptions.json");
  const anterior = await readFile(creditsFile, "utf8").catch(() => null);
  const assinaturasAnteriores = await readFile(subscriptionsFile, "utf8").catch(
    () => null,
  );
  await writeFile(creditsFile, "{}");
  await writeFile(subscriptionsFile, "{}");

  try {
    const chatId = "120363222222222222@g.us";
    const ownerLid = "258840000222@lid";
    const socket = makeSocket();

    await startAnimeFlow({
      socket,
      chatId,
      ownerLid,
      ownerName: "Y",
      sendReply: async () => {},
    });

    const session = getAnimeSession(chatId, ownerLid);
    session.stage = "qualidades";
    session.provider = "meusanimes";
    session.anime = { title: "KAIJU GIRLS" };
    session.episode = { index: 0, number: 1, title: "", id: "ep-1" };
    session.sources = [{ url: "https://exemplo.invalido/a.m3u8", label: "480p" }];

    // Os 10 créditos diários não cobrem o preço de um episódio: recarrega o
    // suficiente para o portão deixar passar.
    addCredits(ownerLid, ANIME_EPISODE_CREDITS * 2, { note: "teste" });

    const antes = accountBalance(getAccount(ownerLid));
    assert.ok(antes >= ANIME_EPISODE_CREDITS);

    const replies = [];
    await handleAnimeReply({
      socket,
      chatId,
      senderLid: ownerLid,
      senderLids: [ownerLid],
      senderName: "Y",
      text: "anm:src:0",
      sendReply: async (text) => replies.push(String(text)),
    });

    // Sem yt-dlp o download não acontece; o saldo volta ao que era (estorno).
    assert.equal(
      accountBalance(getAccount(ownerLid)),
      antes,
      "um episódio que falhou não fica cobrado",
    );
  } finally {
    resetAnimeSessions();
    for (const [ficheiro, guardado] of [
      [creditsFile, anterior],
      [subscriptionsFile, assinaturasAnteriores],
    ]) {
      if (guardado === null) {
        await rm(ficheiro, { force: true });
      } else {
        await writeFile(ficheiro, guardado);
      }
    }
  }
});

/* ─────────── Desambiguação (candidatos) ─────────── */


/**
 * Desambiguação no fluxo: quando a pesquisa não tem correspondência exata, o
 * bot mostra a lista de candidatos (com capa) em vez de escolher sozinho.
 *
 * Prova o defeito que isto corrige: "Meu Hero Academia" no meusanimes devolvia
 * "Eiyuu Kyoushitsu" (outro anime) sem o utilizador perceber. Aqui a resposta
 * tem de trazer a lista e NENHUM episódio.
 */
test("sem correspondência exata, o card mostra a lista e não os episódios", async () => {
  resetAnimeSessions();
  stubFetch({
    "translate.googleapis.com": JSON.stringify([
      [["My Hero Academia", "Meu Hero Academia", null, null]],
      null,
      "pt",
    ]),
    "links-animes.txt": CATALOGO_BOKU,
  });

  try {
    const enviados = [];
    const socket = makeCapturingSocket(enviados);

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "Meu Hero Academia",
    });

    await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "anm:aud:subbed",
      sendReply: async () => {},
    });

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.stage, "candidatos", "para na escolha do candidato");
    assert.equal(sessao.candidates.length, 1);
    assert.equal(
      sessao.episodes.length,
      0,
      "NÃO pode ter carregado episódios do anime errado",
    );

    const card = enviados[enviados.length - 1];
    const corpo = card.caption || card.text || "";
    assert.match(corpo, /Boku no Hero Academia/, "mostra o título encontrado");
    assert.match(corpo, /Traduzi/, "explica que traduziu o termo");

    const ids = rowIds(card);
    assert.ok(ids.includes("anm:an:0"), "a lista tem o candidato");
    assert.ok(
      !ids.some((id) => id.startsWith("anm:ep:")),
      "a lista de candidatos não mostra episódios",
    );
  } finally {
    delete globalThis.fetch;
  }
});

test("com correspondência exata, segue direto sem lista de candidatos", async () => {
  resetAnimeSessions();
  stubFetch({
    "links-animes.txt": CATALOGO_NARUTO_UMA,
  });

  try {
    const enviados = [];
    const socket = makeCapturingSocket(enviados);

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "naruto",
    });

    await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "anm:aud:subbed",
      sendReply: async () => {},
    });

    const sessao = getAnimeSession(CHAT, LID);
    assert.notEqual(sessao.stage, "candidatos", "não há passo de candidato");
    assert.deepEqual(sessao.candidates, []);
    assert.ok(sessao.episodes.length > 0, "os episódios foram carregados");

    const card = enviados[enviados.length - 1];
    const corpo = card.caption || card.text || "";
    assert.match(corpo, /Naruto/, "o card mostra o título encontrado");
  } finally {
    delete globalThis.fetch;
  }
});

test("escolher um candidato carrega os episódios do candidato escolhido", async () => {
  resetAnimeSessions();
  stubFetch({
    "translate.googleapis.com": JSON.stringify([
      [["My Hero Academia", "Meu Hero Academia", null, null]],
      null,
      "pt",
    ]),
    "links-animes.txt": CATALOGO_BOKU,
  });

  try {
    const socket = makeSocket();

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "Meu Hero Academia",
    });

    await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "anm:aud:subbed",
      sendReply: async () => {},
    });

    const antes = getAnimeSession(CHAT, LID);
    assert.equal(antes.stage, "candidatos");
    // "Boku no Hero Academia" é o candidato 1 (o termo traduzido vem primeiro).
    const alvo = antes.candidates.findIndex(
      (c) => c.title === "Boku no Hero Academia",
    );
    assert.ok(alvo >= 0, "o candidato traduzido está na lista");

    await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: `anm:an:${alvo}`,
      sendReply: async () => {},
    });

    const depois = getAnimeSession(CHAT, LID);
    assert.equal(depois.anime.title, "Boku no Hero Academia");
    assert.equal(depois.provider, "saimo");
    assert.deepEqual(depois.candidates, [], "a lista é limpa depois da escolha");
  } finally {
    delete globalThis.fetch;
  }
});
