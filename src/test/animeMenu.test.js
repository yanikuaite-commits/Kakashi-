import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ANIME_EPISODE_CREDITS, DATABASE_DIR } from "../config.js";
import { accountBalance, chargeCredits, getAccount } from "../services/credits.js";
import {
  getAnimeSession,
  handleAnimeReply,
  resetAnimeSessions,
  startAnimeFlow,
} from "../utils/animeMenu.js";

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
const CHAT = "120363000000000000@g.us";
const LID = "987654321098765:12@lid";
const PN = "244991234567@s.whatsapp.net";

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

test("outro membro continua a ser negado", async () => {
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

  assert.equal(consumiu, true);
  assert.match(replies[0], /Só quem pediu/i);
});

test("outro membro não cancela o menu do autor", async () => {
  resetAnimeSessions();
  await abrirMenu(LID, [LID, PN]);

  const replies = [];
  await handleAnimeReply({
    socket: makeSocket(),
    chatId: CHAT,
    senderLid: "555555555555555@lid",
    senderLids: ["555555555555555@lid"],
    text: "anm:cancel",
    sendReply: async (text) => replies.push(String(text)),
  });

  assert.match(replies[0], /Só quem pediu pode cancelar/i);
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

test("cards de anime não repetem o rodapé (o card já leva footer)", async () => {
  resetAnimeSessions();

  const respostas = {
    "/filter?keyword=attack%20on%20titan": `
      <div class="item ">
        <div class="inner">
          <div class="ani poster tip" data-tip="1631">
            <a href="https://anikoto.cz/watch/attack-on-titan-bgaoa/ep-1">
              <img src="https://cdn.anipixcdn.co/a.jpg" alt="Attack on Titan" />
            </a>
          </div>
        </div>
      </div>`,
    "/api/seasons/1631": JSON.stringify({
      status: 200,
      result: `
        <a href="https://anikoto.cz/watch/attack-on-titan-bgaoa"><div class="name">Season 1</div></a>
        <a href="https://anikoto.cz/watch/attack-on-titan-season-2-0rtbh"><div class="name">Season 2</div></a>`,
    }),
  };

  globalThis.fetch = async (url) => {
    const chave = Object.keys(respostas).find((k) => String(url).endsWith(k));
    return { ok: true, status: 200, text: async () => respostas[chave] ?? "" };
  };

  try {
    const enviados = [];
    const socket = {
      sendMessage: async (_chat, content) => {
        enviados.push(content);
        return { key: { id: "m" } };
      },
    };

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "attack on titan",
    });

    const cardTemporadas = enviados[0];
    assert.equal(
      cardTemporadas.text.split("© Made by Yanik Uaite").length - 1,
      0,
      "o corpo do card não repete o rodapé que já vai em footer",
    );
    assert.equal(
      cardTemporadas.footer,
      "© Made by Yanik Uaite",
      "o rodapé continua a ir no footer do card",
    );
  } finally {
    delete globalThis.fetch;
  }
});

test("anm:sea carrega os episódios da temporada escolhida", async () => {
  resetAnimeSessions();

  // Rede stubada (o código é o de produção): pesquisa → temporadas → página da
  // temporada → lista de episódios. Cada temporada devolve um número de
  // episódios DIFERENTE, para provar que a escolha não mostra sempre a 1ª.
  const respostas = {
    "/filter?keyword=attack%20on%20titan": `
      <div class="item ">
        <div class="inner">
          <div class="ani poster tip" data-tip="1631">
            <a href="https://anikoto.cz/watch/attack-on-titan-bgaoa/ep-1">
              <img src="https://cdn.anipixcdn.co/a.jpg" alt="Attack on Titan" />
            </a>
          </div>
        </div>
      </div>`,
    "/api/seasons/1631": JSON.stringify({
      status: 200,
      result: `
        <a href="https://anikoto.cz/watch/attack-on-titan-bgaoa"><div class="name">Season 1</div></a>
        <a href="https://anikoto.cz/watch/attack-on-titan-season-2-0rtbh"><div class="name">Season 2</div></a>`,
    }),
    "/watch/attack-on-titan-bgaoa/ep-1": `<div data-anime-id="1631"></div>`,
    "/watch/attack-on-titan-season-2-0rtbh/ep-1": `<div data-anime-id="1385"></div>`,
    "/ajax/episode/list/1631": JSON.stringify({
      status: 200,
      result: `<a href="#" data-id="1" data-num="1" data-ids="S1E1">1</a>
               <a href="#" data-id="2" data-num="2" data-ids="S1E2">2</a>
               <a href="#" data-id="3" data-num="3" data-ids="S1E3">3</a>`,
    }),
    "/ajax/episode/list/1385": JSON.stringify({
      status: 200,
      result: `<a href="#" data-id="9" data-num="1" data-ids="S2E1">1</a>
               <a href="#" data-id="10" data-num="2" data-ids="S2E2">2</a>`,
    }),
  };

  globalThis.fetch = async (url) => {
    const chave = Object.keys(respostas).find((k) => String(url).endsWith(k));
    return { ok: true, status: 200, text: async () => respostas[chave] ?? "" };
  };

  try {
    const enviados = [];
    const socket = {
      sendMessage: async (_chat, content) => {
        enviados.push(content);
        return { key: { id: "m" } };
      },
    };

    // Pesquisa → deve mostrar a lista de TEMPORADAS (2 agrupadas).
    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "attack on titan",
    });

    const linhasTemporadas = enviados[0].interactiveButtons
      .map((b) => JSON.parse(b.buttonParamsJson || "{}"))
      .find((p) => p.sections)?.sections?.[0]?.rows;
    const idsTemporadas = (linhasTemporadas || []).map((r) => r.id);

    assert.ok(idsTemporadas.includes("anm:sea:0"), "oferece a temporada 1");
    assert.ok(idsTemporadas.includes("anm:sea:1"), "oferece a temporada 2");
    assert.equal(
      getAnimeSession(CHAT, LID).stage,
      "temporadas",
      "fica à espera da escolha da temporada",
    );

    // Escolhe a temporada 2 → os episódios têm de ser os DELA (2, não 3).
    const consumiu = await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "anm:sea:1",
      sendReply: async () => {},
    });

    assert.equal(consumiu, true);

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.stage, "episodios");
    assert.equal(sessao.episodes.length, 2, "a temporada 2 tem 2 episódios");
    assert.equal(sessao.episodes[0].id, "attack-on-titan-season-2-0rtbh::9::S2E1");
  } finally {
    delete globalThis.fetch;
  }
});

test("sem temporadas agrupadas, salta direto para os episódios", async () => {
  resetAnimeSessions();

  const respostas = {
    "/filter?keyword=one%20piece": `
      <div class="item ">
        <div class="inner">
          <div class="ani poster tip" data-tip="1642">
            <a href="https://anikoto.cz/watch/one-piece-abc/ep-1">
              <img src="https://cdn.anipixcdn.co/a.jpg" alt="One Piece" />
            </a>
          </div>
        </div>
      </div>`,
    "/api/seasons/1642": JSON.stringify({ status: 200, result: "" }),
    "/ajax/episode/list/1642": JSON.stringify({
      status: 200,
      result: `<a href="#" data-id="1" data-num="1" data-ids="T1">1</a>`,
    }),
  };

  globalThis.fetch = async (url) => {
    const chave = Object.keys(respostas).find((k) => String(url).endsWith(k));
    return { ok: true, status: 200, text: async () => respostas[chave] ?? "" };
  };

  try {
    const enviados = [];
    const socket = {
      sendMessage: async (_chat, content) => {
        enviados.push(content);
        return { key: { id: "m" } };
      },
    };

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "one piece",
    });

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.stage, "episodios", "vai direto para os episódios");
    assert.equal(sessao.episodes.length, 1);

    const ids = enviados[0].interactiveButtons
      .map((b) => JSON.parse(b.buttonParamsJson || "{}"))
      .find((p) => p.sections)?.sections?.[0]?.rows
      ?.map((r) => r.id);
    assert.ok(ids.includes("anm:ep:0"), "mostra os episódios logo");
    assert.ok(
      !ids.some((id) => id.startsWith("anm:sea:")),
      "não mostra passo de temporada",
    );
  } finally {
    delete globalThis.fetch;
  }
});

test("com as duas faixas, o menu pergunta Legendado/Dublado antes dos episódios", async () => {
  resetAnimeSessions();

  // AnimeGG com as duas faixas: a escolha da faixa tem de vir ANTES dos episódios.
  const respostas = {
    "/search/?q=naruto": `
      <div class="media searchre">
        <a href="/series/naruto" class="mse"><div class="media-body"><div class="first"><h2>Naruto</h2></div></div></a>
      </div>`,
    "/series/naruto": `
      <a href="/naruto-episode-1" class="anm_det_pop"><strong>Naruto 1</strong></a><a href="/naruto-episode-1#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a><a href="/naruto-episode-1#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>
      <a href="/naruto-episode-2" class="anm_det_pop"><strong>Naruto 2</strong></a><a href="/naruto-episode-2#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a><a href="/naruto-episode-2#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>`,
  };

  globalThis.fetch = async (url) => {
    const chave = Object.keys(respostas).find((k) => String(url).endsWith(k));
    return { ok: true, status: 200, text: async () => respostas[chave] ?? "" };
  };

  try {
    const enviados = [];
    const socket = {
      sendMessage: async (_chat, content) => {
        enviados.push(content);
        return { key: { id: "m" } };
      },
    };

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "naruto",
    });

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.stage, "faixas", "para na escolha da faixa");
    assert.deepEqual(sessao.audioVersions, ["subbed", "dubbed"]);

    const ids = enviados[0].interactiveButtons
      .map((b) => JSON.parse(b.buttonParamsJson || "{}"))
      .find((p) => p.sections)?.sections?.[0]?.rows
      ?.map((r) => r.id);
    assert.ok(ids.includes("anm:aud:subbed"), "oferece Legendado");
    assert.ok(ids.includes("anm:aud:dubbed"), "oferece Dublado");
    assert.ok(
      !ids.some((id) => id.startsWith("anm:ep:")),
      "ainda NÃO mostra episódios: a faixa vem primeiro",
    );

    // Escolher dublado → guarda a faixa e segue para os episódios.
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

    const idsEp = enviados[1].interactiveButtons
      .map((b) => JSON.parse(b.buttonParamsJson || "{}"))
      .find((p) => p.sections)?.sections?.[0]?.rows
      ?.map((r) => r.id);
    assert.ok(idsEp.includes("anm:ep:0"), "agora sim mostra os episódios");
  } finally {
    delete globalThis.fetch;
  }
});

test("lista MISTA (parte só legendada) ainda pergunta a faixa", async () => {
  resetAnimeSessions();

  // Regressão: a lista real do Naruto tem 218 episódios com as duas faixas e 2
  // só legendados. Com a regra de intersecção o menu concluía "subbed" e nunca
  // perguntava, pelo que o dublado era inalcançável em quase todas as séries.
  const respostas = {
    "/search/?q=naruto": `
      <div class="media searchre">
        <a href="/series/naruto" class="mse"><div class="media-body"><div class="first"><h2>Naruto</h2></div></div></a>
      </div>`,
    "/series/naruto": `
      <a href="/naruto-episode-1" class="anm_det_pop"><strong>Naruto 1</strong></a><a href="/naruto-episode-1#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a><a href="/naruto-episode-1#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>
      <a href="/naruto-episode-2" class="anm_det_pop"><strong>Naruto 2</strong></a><a href="/naruto-episode-2#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a><a href="/naruto-episode-2#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>
      <a href="/naruto-episode-3" class="anm_det_pop"><strong>Naruto 3</strong></a><a href="/naruto-episode-3#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a>`,
  };

  globalThis.fetch = async (url) => {
    const chave = Object.keys(respostas).find((k) => String(url).endsWith(k));
    return { ok: true, status: 200, text: async () => respostas[chave] ?? "" };
  };

  try {
    const enviados = [];
    const socket = {
      sendMessage: async (_chat, content) => {
        enviados.push(content);
        return { key: { id: "m" } };
      },
    };

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "naruto",
    });

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.stage, "faixas", "o ep 3 não ter dublado não pode esconder a escolha");
    assert.deepEqual(sessao.audioVersions, ["subbed", "dubbed"]);

    const ids = enviados[0].interactiveButtons
      .map((b) => JSON.parse(b.buttonParamsJson || "{}"))
      .find((p) => p.sections)?.sections?.[0]?.rows
      ?.map((r) => r.id);
    assert.ok(ids.includes("anm:aud:dubbed"), "Dublado tem de ser alcançável");
  } finally {
    delete globalThis.fetch;
  }
});

test("com uma só faixa, o menu não pergunta e fixa-a sozinho", async () => {
  resetAnimeSessions();

  // AnimeGG com apenas dublado (caso real do One Piece 1156): perguntar seria
  // uma escolha falsa, mas a faixa tem de ficar fixada para o download.
  const respostas = {
    "/search/?q=one%20piece": `
      <div class="media searchre">
        <a href="/series/one-piece" class="mse"><div class="media-body"><div class="first"><h2>One Piece</h2></div></div></a>
      </div>`,
    "/series/one-piece": `
      <a href="/one-piece-episode-1156" class="anm_det_pop"><strong>One Piece 1156</strong></a><a href="/one-piece-episode-1156#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>
      <a href="/one-piece-episode-1157" class="anm_det_pop"><strong>One Piece 1157</strong></a><a href="/one-piece-episode-1157#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>`,
  };

  globalThis.fetch = async (url) => {
    const chave = Object.keys(respostas).find((k) => String(url).endsWith(k));
    return { ok: true, status: 200, text: async () => respostas[chave] ?? "" };
  };

  try {
    const enviados = [];
    const socket = {
      sendMessage: async (_chat, content) => {
        enviados.push(content);
        return { key: { id: "m" } };
      },
    };

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "one piece",
    });

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.stage, "episodios", "não para na escolha de faixa");
    assert.equal(sessao.audioVersion, "dubbed", "mas fixa a única faixa existente");

    const ids = enviados[0].interactiveButtons
      .map((b) => JSON.parse(b.buttonParamsJson || "{}"))
      .find((p) => p.sections)?.sections?.[0]?.rows
      ?.map((r) => r.id);
    assert.ok(ids.includes("anm:ep:0"), "mostra logo os episódios");
    assert.ok(
      !ids.some((id) => id.startsWith("anm:aud:")),
      "não pergunta uma escolha que não existe",
    );
  } finally {
    delete globalThis.fetch;
  }
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
  const socket = {
    sendMessage: async (_chat, content) => {
      enviados.push(content);
      return { key: { id: "m" } };
    },
  };

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

  // A segunda página mostra os episódios 11–20, com ids absolutos, e mantém
  // UM botão "ver mais" (para a página 3), sem retroceder.
  const linhas = enviados[0].interactiveButtons
    .map((b) => JSON.parse(b.buttonParamsJson || "{}"))
    .find((p) => p.sections)?.sections?.[0]?.rows;
  const ids = (linhas || []).map((r) => r.id);

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
  const CHAT = "120363000000000000@g.us";
  const LID = "987654321098765:12@lid";
  const enviados = [];

  const socket = {
    sendMessage: async (_chat, content) => {
      enviados.push(content);
      return { key: { id: "m" } };
    },
  };

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
 * O download custa ANIME_EPISODE_CREDITS (20) e é verificado ANTES de arrancar.
 * Sem yt-dlp instalado, o fluxo para antes de tocar na rede, o que permite
 * provar o portão de saldo e a mensagem de créditos.
 */
test("episódio sem saldo para 20 créditos é bloqueado antes do download", async () => {
  resetAnimeSessions();
  const dbDir = DATABASE_DIR;
  const creditsFile = path.join(dbDir, "credits.json");
  const anterior = await readFile(creditsFile, "utf8").catch(() => null);
  await writeFile(creditsFile, "{}");

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
    session.provider = "anikoto";
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
    if (anterior === null) {
      await rm(creditsFile, { force: true });
    } else {
      await writeFile(creditsFile, anterior);
    }
  }
});

test("com saldo, o episódio passa do portão e cobra 20 créditos", async () => {
  resetAnimeSessions();
  const creditsFile = path.join(DATABASE_DIR, "credits.json");
  const anterior = await readFile(creditsFile, "utf8").catch(() => null);
  await writeFile(creditsFile, "{}");

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
    session.provider = "anikoto";
    session.anime = { title: "KAIJU GIRLS" };
    session.episode = { index: 0, number: 1, title: "", id: "ep-1" };
    session.sources = [{ url: "https://exemplo.invalido/a.m3u8", label: "480p" }];

    // Saldo suficiente (os 30 diários cobrem os 20 do episódio).
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
    if (anterior === null) {
      await rm(creditsFile, { force: true });
    } else {
      await writeFile(creditsFile, anterior);
    }
  }
});
