import assert from "node:assert/strict";
import { test } from "node:test";
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
