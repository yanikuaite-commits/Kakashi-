/**
 * Testes do comando `.broadcast`.
 *
 * O defeito original: a lista era enviada com `interactiveButtons` (nativeFlow),
 * mas as opções não eram registadas — o `interactive.js` só lê `content.sections`
 * — por isso o clique não fazia nada. A mensagem também era reconstruída com
 * `fullArgs.split(" ").slice(0, -1)`, que cortava a última palavra.
 *
 * Estes testes guardam o fluxo correto em dois passos: a lista com os destinos,
 * o mapeamento do clique para `<prefixo>broadcast <alvo>` e o reenvio do texto
 * integral guardado na sessão. Cada teste usa um chat próprio para a sessão em
 * memória de um não contaminar o seguinte.
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import broadcast from "../commands/owner/broadcast.js";
import { handleInteractiveMenuReply } from "../utils/interactive.js";

const OUTRO = "222@g.us";
const OWNER = "275381038891241@lid";

let contador = 0;
function proximoChat() {
  contador += 1;
  return `dono-${contador}@g.us`;
}

function makeCtx({ fullArgs = "", prefix = ".", isOwner = true } = {}) {
  const sent = [];
  const replies = [];
  const remoteJid = proximoChat();
  const socket = {
    groupFetchAllParticipating: async () => ({ "111@g.us": {}, [OUTRO]: {} }),
    groupMetadata: async (id) => ({ subject: `Grupo ${id.slice(0, 3)}` }),
    sendMessage: async (jid, payload) => sent.push({ jid, payload }),
  };

  return {
    sent,
    replies,
    remoteJid,
    ctx: {
      fullArgs,
      isOwner,
      prefix,
      remoteJid,
      socket,
      userLid: OWNER,
      sendReply: async (text) => replies.push(String(text)),
      sendErrorReply: async (text) => replies.push(String(text)),
    },
  };
}

/** Última lista enviada ao chat (o card com as secções). */
function lastList(sent) {
  return [...sent].reverse().find(({ payload }) => payload?.sections)?.payload;
}

describe("broadcast", () => {
  it("recusa quem não é dono", async () => {
    const { ctx } = makeCtx({ fullArgs: "oi", isOwner: false });
    await assert.rejects(() => broadcast.handle(ctx), /Apenas o dono/);
  });

  it("sem mensagem, pede o texto", async () => {
    const { ctx } = makeCtx({ fullArgs: "" });
    await assert.rejects(() => broadcast.handle(ctx), /Informe a mensagem/);
  });

  it("envia uma lista com 'todos' e os grupos", async () => {
    const { ctx, sent } = makeCtx({ fullArgs: "bom dia pessoal" });
    await broadcast.handle(ctx);

    const lista = lastList(sent);
    assert.ok(lista, "a lista devia ter sido enviada");
    const rows = lista.sections[0].rows;
    assert.equal(rows.length, 3);
    assert.match(rows[0].title, /Todos os grupos/);
    assert.ok(
      rows.every((row) => row.rowId.startsWith("kmenu:")),
      "as linhas usam token, não o destino cru",
    );
  });

  it("o clique em 'todos' mapeia para <prefixo>broadcast all", async () => {
    const { ctx, sent, remoteJid } = makeCtx({ fullArgs: "aviso geral" });
    await broadcast.handle(ctx);

    const token = lastList(sent).sections[0].rows[0].rowId;
    const resposta = await handleInteractiveMenuReply({
      chatId: remoteJid,
      senderId: OWNER,
      text: token,
      sendReply: async () => {},
    });

    assert.equal(resposta?.selectedId, ".broadcast all");
  });

  it("reenvia o texto INTEGRAL (não corta a última palavra)", async () => {
    const { ctx, sent, replies } = makeCtx({ fullArgs: "bom dia pessoal" });
    await broadcast.handle(ctx);

    sent.length = 0;
    replies.length = 0;
    await broadcast.handle({ ...ctx, fullArgs: "all" });

    const enviados = sent.map(({ payload }) => payload.text);
    assert.equal(enviados.length, 2, "envia para os dois grupos");
    assert.ok(
      enviados.every((texto) => texto.includes("bom dia pessoal")),
      `o texto foi cortado: ${JSON.stringify(enviados)}`,
    );
    assert.match(replies.join(" "), /2 grupo/);
  });

  it("o clique num grupo mapeia para o JID e envia só para ele", async () => {
    const { ctx, sent, remoteJid } = makeCtx({ fullArgs: "ola grupo" });
    await broadcast.handle(ctx);

    const rows = lastList(sent).sections[0].rows;
    const token = rows.find((row) => row.title.includes("222")).rowId;
    const resposta = await handleInteractiveMenuReply({
      chatId: remoteJid,
      senderId: OWNER,
      text: token,
      sendReply: async () => {},
    });

    assert.equal(resposta?.selectedId, `.broadcast ${OUTRO}`);

    sent.length = 0;
    await broadcast.handle({ ...ctx, fullArgs: OUTRO });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, OUTRO);
    assert.ok(sent[0].payload.text.includes("ola grupo"));
  });

  it("sem sessão, um destino é recusado com instrução", async () => {
    const { ctx } = makeCtx({ fullArgs: "all" });
    await assert.rejects(
      () => broadcast.handle(ctx),
      /Sessão de broadcast expirada/,
    );
  });
});
