import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ANIME_EPISODE_CREDITS, ANIME_PROVIDERS, DATABASE_DIR } from "../config.js";
import { accountBalance, chargeCredits, getAccount } from "../services/credits.js";
import {
  getAnimeSession,
  handleAnimeReply,
  resetAnimeSessions,
  startAnimeFlow,
} from "../utils/animeMenu.js";

// Os testes de fluxo abaixo substituem a rede por HTML de providers concretos
// (anikoto, animegg) para exercitar o menu. Como `ANIME_PROVIDERS` vem do
// `config.js`, a lista é fixada aqui: sem isto o teste passaria a depender da
// predefinição de produção e quebrava sempre que ela mudasse, mesmo sem o menu
// mudar — foi o que aconteceu ao deixar só o `meusanimes` ativo.
//
// Cada ficheiro de teste corre no seu próprio processo, pelo que a alteração não
// sai daqui.
ANIME_PROVIDERS.length = 0;
ANIME_PROVIDERS.push("anikoto", "animegg");

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

    // Nome → o bot pergunta a FAIXA antes de pesquisar.
    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async () => {},
      nome: "attack on titan",
    });

    assert.equal(
      getAnimeSession(CHAT, LID).stage,
      "faixas",
      "a faixa é perguntada antes da pesquisa",
    );

    // Escolhida a faixa → pesquisa → lista de TEMPORADAS (2 agrupadas).
    await handleAnimeReply({
      socket,
      chatId: CHAT,
      senderLid: LID,
      senderLids: [LID],
      text: "anm:aud:subbed",
      sendReply: async () => {},
    });

    const linhasTemporadas = enviados[1].interactiveButtons
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

test("modo texto: cards saem em texto numerado e o número escolhe a linha", async () => {
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
    "/api/seasons/1631": JSON.stringify({ status: 200, result: "" }),
    "/ajax/episode/list/1631": JSON.stringify({
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
    const replies = [];
    const socket = {
      sendMessage: async (_chat, content) => {
        enviados.push(content);
        return { key: { id: "m" } };
      },
    };

    // `!anime <nome>`: modo texto desde o início.
    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async (text) => replies.push(String(text)),
      nome: "attack on titan",
      textOnly: true,
    });

    // A lista de faixas saiu como TEXTO (nada foi para o socket).
    assert.deepEqual(enviados, [], "modo texto não envia cards");
    assert.equal(replies.length, 1);
    assert.match(replies[0], /1\. .*Legendado/i);
    assert.doesNotMatch(replies[0], /Não consegui abrir o menu interativo/);

    const sessao = getAnimeSession(CHAT, LID);
    assert.equal(sessao.textOnly, true);
    assert.equal(sessao.stage, "faixas");
    assert.ok(sessao.lastRows.length >= 2, "as linhas do card ficam guardadas");

    // "1" = primeira linha = legendado: pesquisa e mostra os episódios em texto.
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
    assert.doesNotMatch(replies.at(-1), /Não consegui abrir o menu interativo/);
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
    nome: "attack on titan",
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

    // A faixa vem primeiro; só depois de escolhida é que a pesquisa corre.
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
    assert.equal(sessao.episodes.length, 1);

    const ids = enviados[1].interactiveButtons
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

test("a faixa é perguntada ANTES de pesquisar (e a pesquisa usa a escolhida)", async () => {
  resetAnimeSessions();

  // O bot tem de perguntar a faixa sem sequer tocar na rede: um título só
  // legendado nunca satisfaria um pedido de dublado, e descobri-lo no fim
  // obrigava o utilizador a repetir o pedido todo.
  const respostas = {
    "/search/?q=naruto": `
      <div class="media searchre">
        <a href="/series/naruto" class="mse"><div class="media-body"><div class="first"><h2>Naruto</h2></div></div></a>
      </div>`,
    "/series/naruto": `
      <a href="/naruto-episode-1" class="anm_det_pop"><strong>Naruto 1</strong></a><a href="/naruto-episode-1#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a><a href="/naruto-episode-1#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>
      <a href="/naruto-episode-2" class="anm_det_pop"><strong>Naruto 2</strong></a><a href="/naruto-episode-2#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a><a href="/naruto-episode-2#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>`,
  };

  const pedidos = [];
  globalThis.fetch = async (url) => {
    pedidos.push(String(url));
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
    assert.equal(
      pedidos.length,
      0,
      "nenhuma pesquisa antes de o utilizador escolher a faixa",
    );

    // As duas faixas são oferecidas, mesmo antes de saber o que a fonte tem.
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

    // Escolher dublado → guarda a faixa, pesquisa e segue para os episódios.
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

    const idsEp = enviados[1].interactiveButtons
      .map((b) => JSON.parse(b.buttonParamsJson || "{}"))
      .find((p) => p.sections)?.sections?.[0]?.rows
      ?.map((r) => r.id);
    assert.ok(idsEp.includes("anm:ep:0"), "agora sim mostra os episódios");
  } finally {
    delete globalThis.fetch;
  }
});

test("lista MISTA (parte só legendada) não esconde a escolha da faixa", async () => {
  resetAnimeSessions();

  // Regressão: a lista real do Naruto tem 218 episódios com as duas faixas e 2
  // só legendados. Com a regra de intersecção o menu concluía "subbed" e nunca
  // perguntava, pelo que o dublado era inalcançável em quase todas as séries.
  // A escolha é feita ANTES da pesquisa, por isso o ep 3 não a pode esconder.
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

    assert.equal(
      getAnimeSession(CHAT, LID).stage,
      "faixas",
      "o ep 3 não ter dublado não pode esconder a escolha",
    );

    const ids = enviados[0].interactiveButtons
      .map((b) => JSON.parse(b.buttonParamsJson || "{}"))
      .find((p) => p.sections)?.sections?.[0]?.rows
      ?.map((r) => r.id);
    assert.ok(ids.includes("anm:aud:dubbed"), "Dublado tem de ser alcançável");
  } finally {
    delete globalThis.fetch;
  }
});

test("faixa pedida que a fonte não tem: avisa e cai para a que existe", async () => {
  resetAnimeSessions();

  // O utilizador escolhe a faixa ANTES de a fonte ser conhecida, por isso pode
  // pedir dublado num título só legendado. O bot não pode servir a outra faixa
  // em silêncio (é o defeito que este fluxo corrige) nem deixar o utilizador
  // sem nada: avisa e mostra a que existe.
  const respostas = {
    "/search/?q=naruto": `
      <div class="media searchre">
        <a href="/series/naruto" class="mse"><div class="media-body"><div class="first"><h2>Naruto</h2></div></div></a>
      </div>`,
    "/series/naruto": `
      <a href="/naruto-episode-1" class="anm_det_pop"><strong>Naruto 1</strong></a><a href="/naruto-episode-1#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a>
      <a href="/naruto-episode-2" class="anm_det_pop"><strong>Naruto 2</strong></a><a href="/naruto-episode-2#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a>`,
  };

  globalThis.fetch = async (url) => {
    const chave = Object.keys(respostas).find((k) => String(url).endsWith(k));
    return { ok: true, status: 200, text: async () => respostas[chave] ?? "" };
  };

  try {
    const enviados = [];
    const replies = [];
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
    assert.equal(
      sessao.audioVersion,
      "subbed",
      "cai para a única faixa que existe",
    );
    assert.ok(
      replies.some((r) => /não tem dublado/i.test(r) && /legendado/i.test(r)),
      "diz explicitamente que caiu para o legendado",
    );
  } finally {
    delete globalThis.fetch;
  }
});

test("fonte que não distingue faixas não gera aviso falso", async () => {
  resetAnimeSessions();

  // O anikoto não publica faixas (`versions: []`): não há nada para comparar,
  // por isso pedir dublado não pode produzir um aviso com rótulo vazio.
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
    const replies = [];
    const socket = {
      sendMessage: async () => ({ key: { id: "m" } }),
    };

    await startAnimeFlow({
      socket,
      chatId: CHAT,
      ownerLid: LID,
      ownerName: "Yanik Uaite",
      sendReply: async (text) => replies.push(String(text)),
      nome: "one piece",
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
    assert.equal(sessao.stage, "episodios", "segue para os episódios");
    assert.equal(
      replies.filter((r) => /não tem/i.test(r)).length,
      0,
      "sem faixas publicadas não há aviso de faixa",
    );
  } finally {
    delete globalThis.fetch;
  }
});

test("dublado numa fonte não-PT-BR avisa que o áudio é inglês", async () => {
  resetAnimeSessions();

  // O animegg é um site inglês: a faixa "dubbed" dele é dublagem inglesa. Quem
  // pede "Dublado" não pode receber áudio inglês sem saber — o card dizia
  // "Dublado" e o utilizador só descobria pelo som.
  const respostas = {
    "/search/?q=naruto": `
      <div class="media searchre">
        <a href="/series/naruto" class="mse"><div class="media-body"><div class="first"><h2>Naruto</h2></div></div></a>
      </div>`,
    "/series/naruto": `
      <a href="/naruto-episode-1" class="anm_det_pop"><strong>Naruto 1</strong></a><a href="/naruto-episode-1#subbed"><span class="btn-xs btn-subbed">SUBBED</span></a><a href="/naruto-episode-1#dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a>`,
  };

  globalThis.fetch = async (url) => {
    const chave = Object.keys(respostas).find((k) => String(url).endsWith(k));
    return { ok: true, status: 200, text: async () => respostas[chave] ?? "" };
  };

  try {
    const replies = [];
    const socket = { sendMessage: async () => ({ key: { id: "m" } }) };

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

    assert.ok(
      replies.some((r) => /dublagem desta fonte é em inglês/i.test(r)),
      "tem de avisar que a dublagem desta fonte não é português",
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

/**
 * Fixa o provider destes testes em `meusanimes` (HTML de busca no formato do
 * WordPress) e restaura a lista no fim. O ficheiro usa anikoto/animegg por
 * predefinição, e a ordem dos providers é significativa.
 */
function soMeusanimes() {
  const guardados = [...ANIME_PROVIDERS];
  ANIME_PROVIDERS.length = 0;
  ANIME_PROVIDERS.push("meusanimes");
  return () => {
    ANIME_PROVIDERS.length = 0;
    ANIME_PROVIDERS.push(...guardados);
  };
}

const BUSCA_EIYUU = `
  <div class="result-item"><article><div class="image"><div class="thumbnail animation-2"> <a href="https://meusanimes.blog/a/eiyuu-kyoushitsu/"> <img src="https://meusanimes.blog/wp-content/uploads/2025/04/yLZS-150x150.jpg" alt="Eiyuu Kyoushitsu" /> </a></div></div><div class="details"><div class="title"> <a href="https://meusanimes.blog/a/eiyuu-kyoushitsu/">Eiyuu Kyoushitsu</a></div><div class="meta"> <span class="year">2023</span></div></div></article></div>
`;

const BUSCA_DOIS = `
  <div class="result-item"><article><div class="image"><div class="thumbnail animation-2"> <a href="https://meusanimes.blog/a/boku-no-hero-academia/"> <img src="https://meusanimes.blog/wp-content/uploads/2025/04/bnha-150x150.jpg" alt="Boku no Hero Academia" /> </a></div></div><div class="details"><div class="title"> <a href="https://meusanimes.blog/a/boku-no-hero-academia/">Boku no Hero Academia</a></div><div class="meta"> <span class="year">2016</span></div></div></article></div>
`;


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
  const restaurar = soMeusanimes();

  const respostas = {
    "translate.googleapis.com": JSON.stringify([
      [["My Hero Academia", "Meu Hero Academia", null, null]],
      null,
      "pt",
    ]),
    "/?s=meu%20hero%20academia": BUSCA_EIYUU,
    "/?s=my%20hero%20academia": BUSCA_EIYUU,
  };

  globalThis.fetch = async (url) => {
    const alvo = String(url);
    const chave = Object.keys(respostas).find((k) =>
      alvo.toLowerCase().includes(k.toLowerCase()),
    );
    const corpo = respostas[chave] ?? "";
    return {
      ok: true,
      status: 200,
      text: async () => corpo,
      json: async () => JSON.parse(corpo || "null"),
    };
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
    assert.ok(card.image?.url, "o card leva a capa do candidato");
    assert.match(
      card.image.url,
      /^https:\/\/meusanimes\.blog\/wp-content\/uploads\/.*\/yLZS\.jpg$/,
      "a capa vai em tamanho grande (sem o sufixo -150x150)",
    );
    assert.match(card.caption, /My Hero Academia/, "mostra o título encontrado");
    assert.match(card.caption, /Traduzi/, "explica que traduziu o termo");

    const ids = card.interactiveButtons
      .map((b) => JSON.parse(b.buttonParamsJson || "{}"))
      .find((p) => p.sections)?.sections?.[0]?.rows?.map((r) => r.id);
    assert.ok(ids.includes("anm:an:0"), "a lista tem o candidato");
    assert.ok(
      !ids.some((id) => id.startsWith("anm:ep:")),
      "a lista de candidatos não mostra episódios",
    );
  } finally {
    delete globalThis.fetch;
  }
});

/**
 * Com correspondência exata, o fluxo NÃO mostra lista nenhuma: o comportamento
 * histórico (seguir direto para os episódios) tem de ficar intacto. Sem esta
 * prova, a desambiguação podia introduzir um passo extra em todos os pedidos.
 */
test("com correspondência exata, segue direto sem lista de candidatos", async () => {
  resetAnimeSessions();
  const restaurar = soMeusanimes();

  const respostas = {
    "/?s=naruto": `
      <div class="result-item"><article><div class="image"><div class="thumbnail animation-2"> <a href="https://meusanimes.blog/a/naruto/"> <img src="https://meusanimes.blog/wp-content/uploads/2025/04/yLZS-150x150.jpg" alt="Naruto" /> </a></div></div><div class="details"><div class="title"> <a href="https://meusanimes.blog/a/naruto/">Naruto</a></div><div class="meta"> <span class="year">2002</span></div></div></article></div>`,
    "/a/naruto/": `
      <div id='seasons'><div class='se-c'><div class='se-q'><span class='title'>Temporada 1</span></div><div class='se-a' style="display:block"><ul class='episodios'><li class='mark-1'><div class='episodiotitle'><a href='https://meusanimes.blog/e/naruto-1-episodio-1/'>Episódio 1</a></div></li></ul></div></div></div>`,
    "/e/naruto-1-episodio-1/": `<div id="option-2" class="play-box-iframe"><iframe src="https://serv01.exemplo.club/#/video/1/1/1/"></iframe></div>`,
  };

  globalThis.fetch = async (url) => {
    const alvo = String(url);
    const chave = Object.keys(respostas).find((k) =>
      alvo.toLowerCase().includes(k.toLowerCase()),
    );
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
    assert.equal(card.image, undefined, "sem ambiguidade o card não leva capa");
  } finally {
    delete globalThis.fetch;
  }
});

/**
 * Escolher um candidato continua o fluxo a partir DELE (e não do primeiro
 * resultado): é a garantia de que a escolha do utilizador é respeitada.
 */
test("escolher um candidato carrega os episódios do candidato escolhido", async () => {
  resetAnimeSessions();
  const restaurar = soMeusanimes();

  const respostas = {
    "translate.googleapis.com": JSON.stringify([
      [["My Hero Academia", "Meu Hero Academia", null, null]],
      null,
      "pt",
    ]),
    "/?s=meu%20hero%20academia": BUSCA_EIYUU,
    "/?s=my%20hero%20academia": BUSCA_DOIS,
    "/a/boku-no-hero-academia/": `
      <div id='seasons'><div class='se-c'><div class='se-q'><span class='title'>Temporada 1</span></div><div class='se-a' style="display:block"><ul class='episodios'><li class='mark-1'><div class='episodiotitle'><a href='https://meusanimes.blog/e/bnha-1-episodio-1/'>Episódio 1</a></div></li></ul></div></div></div>`,
  };

  globalThis.fetch = async (url) => {
    const alvo = String(url);
    const chave = Object.keys(respostas).find((k) =>
      alvo.toLowerCase().includes(k.toLowerCase()),
    );
    const corpo = respostas[chave] ?? "";
    return {
      ok: true,
      status: 200,
      text: async () => corpo,
      json: async () => JSON.parse(corpo || "null"),
    };
  };

  try {
    const socket = { sendMessage: async () => ({ key: { id: "m" } }) };

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
    assert.equal(depois.provider, "meusanimes");
    assert.deepEqual(depois.candidates, [], "a lista é limpa depois da escolha");
  } finally {
    delete globalThis.fetch;
    restaurar();
  }
});
