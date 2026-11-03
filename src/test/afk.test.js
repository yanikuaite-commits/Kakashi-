/**
 * Testes das ausências (AFK): armazenamento, aviso de grupo/global e broadcast.
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  getAfkReason,
  getAfkSnapshot,
  getGlobalAfkReason,
  removeGlobalAfkMember,
  setAfkMember,
  setGlobalAfkMember,
} from "../utils/database.js";
import { handleAfkReferences } from "../middlewares/afkHandler.js";
import { broadcastToAllGroups, listJoinedGroupIds, BROADCAST_DELAY_MS } from "../utils/afkBroadcast.js";
import afkCommand from "../commands/admin/afk.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const afkPath = path.resolve(__dirname, "..", "..", "database", "afk-groups.json");
let backup;

const GROUP = "123@g.us";
const OUTRO = "999@g.us";
const OWNER = "275381038891241@lid";
const MEMBRO = "111222333@lid";

beforeEach(() => {
  backup = fs.existsSync(afkPath) ? fs.readFileSync(afkPath, "utf8") : undefined;
  fs.writeFileSync(afkPath, "{}");
});

afterEach(() => {
  if (backup !== undefined) fs.writeFileSync(afkPath, backup);
  else if (fs.existsSync(afkPath)) fs.unlinkSync(afkPath);
});

function makeCommon({
  commandName = "",
  userLid = MEMBRO,
  prefix = ".",
  remoteJid = GROUP,
} = {}) {
  const replies = [];
  return {
    replies,
    commonFunctions: {
      isGroup: true,
      commandName,
      fullMessage: "oi",
      prefix,
      remoteJid,
      userLid,
      sendReply: async (text, mentions) => replies.push({ text, mentions }),
    },
  };
}

function messageWith({ mentioned = [], quotedFrom, remoteJid = GROUP } = {}) {
  return {
    key: { remoteJid },
    message: {
      extendedTextMessage: {
        text: "oi",
        contextInfo: {
          mentionedJid: mentioned,
          participant: quotedFrom,
          quotedMessage: quotedFrom ? { conversation: "msg antiga" } : undefined,
        },
      },
    },
  };
}

function makeCommandCtx({
  userLid,
  isOwner = false,
  fullArgs = "",
  isGroup = true,
  remoteJid = GROUP,
} = {}) {
  const sent = [];
  const replies = [];
  const socket = {
    groupFetchAllParticipating: async () => ({ [GROUP]: {}, [OUTRO]: {} }),
    sendMessage: async (jid, payload) => sent.push({ jid, payload }),
  };
  return {
    sent,
    replies,
    ctx: {
      fullArgs,
      isGroup,
      isOwner,
      remoteJid,
      socket,
      userLid,
      sendSuccessReply: async (text) => replies.push(text),
    },
  };
}

describe("armazenamento de ausência", () => {
  it("guarda a ausência global e por grupo em camadas separadas", () => {
    setGlobalAfkMember(OWNER, "viagem");
    setAfkMember(GROUP, OWNER, "viagem");

    assert.strictEqual(getGlobalAfkReason(OWNER), "viagem");
    assert.strictEqual(getAfkReason(GROUP, OWNER), "viagem");
    assert.strictEqual(getAfkReason(OUTRO, OWNER), null);

    const snap = getAfkSnapshot(OUTRO);
    assert.strictEqual(snap.global[OWNER], "viagem");
    assert.strictEqual(snap.group[OWNER], undefined);
  });

  it("remove a ausência global sem tocar nas de grupo", () => {
    setGlobalAfkMember(OWNER, "viagem");
    setAfkMember(GROUP, OWNER, "viagem");

    assert.strictEqual(removeGlobalAfkMember(OWNER), true);
    assert.strictEqual(getGlobalAfkReason(OWNER), null);
    assert.strictEqual(getAfkReason(GROUP, OWNER), "viagem");
  });
});

describe("handleAfkReferences", () => {
  it("avisa ao marcar o ausente, mencionando-o", async () => {
    setGlobalAfkMember(OWNER, "viagem");
    const { commonFunctions, replies } = makeCommon();

    await handleAfkReferences({
      webMessage: messageWith({ mentioned: [OWNER] }),
      commonFunctions,
    });

    assert.strictEqual(replies.length, 1);
    assert.match(replies[0].text, /encontra-se ausente/);
    assert.match(replies[0].text, /viagem/);
    assert.match(replies[0].text, new RegExp(`@${OWNER.split("@")[0]}`));
    assert.deepStrictEqual(replies[0].mentions, [OWNER]);
  });

  it("a ausência global responde em qualquer grupo", async () => {
    setGlobalAfkMember(OWNER, "viagem");
    const { commonFunctions, replies } = makeCommon({ remoteJid: OUTRO });

    await handleAfkReferences({
      webMessage: messageWith({ mentioned: [OWNER], remoteJid: OUTRO }),
      commonFunctions,
    });

    assert.strictEqual(replies.length, 1);
  });

  it("a ausência por grupo não responde noutro grupo", async () => {
    setAfkMember(GROUP, MEMBRO, "almoço");
    const { commonFunctions, replies } = makeCommon({ remoteJid: OUTRO });

    await handleAfkReferences({
      webMessage: messageWith({ mentioned: [MEMBRO], remoteJid: OUTRO }),
      commonFunctions,
    });

    assert.strictEqual(replies.length, 0);
  });

  it("avisa também quando o ausente é citado", async () => {
    setAfkMember(GROUP, MEMBRO, "almoço");
    // Quem cita é um terceiro: se fosse o próprio ausente, a mensagem
    // cancelaria a ausência antes do aviso.
    const { commonFunctions, replies } = makeCommon({ userLid: "444555666@lid" });

    await handleAfkReferences({
      webMessage: messageWith({ quotedFrom: MEMBRO }),
      commonFunctions,
    });

    assert.strictEqual(replies.length, 1);
    assert.deepStrictEqual(replies[0].mentions, [MEMBRO]);
  });

  it("não responde a uma mensagem sem marcação nem citação", async () => {
    setAfkMember(GROUP, MEMBRO, "almoço");
    const { commonFunctions, replies } = makeCommon();

    await handleAfkReferences({
      webMessage: { key: { remoteJid: GROUP }, message: { conversation: "bom dia" } },
      commonFunctions,
    });

    assert.strictEqual(replies.length, 0);
  });

  it("cancela a ausência quando o próprio ausente fala", async () => {
    setGlobalAfkMember(OWNER, "viagem");
    setAfkMember(GROUP, OWNER, "viagem");
    const { commonFunctions } = makeCommon({ userLid: OWNER });

    await handleAfkReferences({
      webMessage: { key: { remoteJid: GROUP }, message: { conversation: "voltei" } },
      commonFunctions,
    });

    assert.strictEqual(getGlobalAfkReason(OWNER), null);
    assert.strictEqual(getAfkReason(GROUP, OWNER), null);
  });

  it("o comando .afk renova em vez de cancelar", async () => {
    setGlobalAfkMember(OWNER, "viagem");
    setAfkMember(GROUP, OWNER, "viagem");
    const { commonFunctions } = makeCommon({ commandName: "afk", userLid: OWNER });

    await handleAfkReferences({
      webMessage: { key: { remoteJid: GROUP }, message: { conversation: ".afk reunião" } },
      commonFunctions,
    });

    assert.strictEqual(getGlobalAfkReason(OWNER), "viagem");
    assert.strictEqual(getAfkReason(GROUP, OWNER), "viagem");
  });
});

describe("comando afk", () => {
  it("o dono grava nas duas camadas e avisa os restantes grupos", async () => {
    const { ctx, sent, replies } = makeCommandCtx({
      userLid: OWNER,
      isOwner: true,
      fullArgs: "viagem",
    });

    await afkCommand.handle(ctx);

    assert.strictEqual(getGlobalAfkReason(OWNER), "viagem");
    assert.strictEqual(getAfkReason(GROUP, OWNER), "viagem");
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].jid, OUTRO);
    assert.deepStrictEqual(sent[0].payload.mentions, [OWNER]);
    assert.match(sent[0].payload.text, new RegExp(`@${OWNER.split("@")[0]}`));
    assert.ok(replies.some((r) => /enviado a mais 1 grupo/.test(r)));
  });

  it("o dono cancela as duas camadas com 'voltei'", async () => {
    setGlobalAfkMember(OWNER, "viagem");
    setAfkMember(GROUP, OWNER, "viagem");
    const { ctx, sent } = makeCommandCtx({
      userLid: OWNER,
      isOwner: true,
      fullArgs: "voltei",
    });

    await afkCommand.handle(ctx);

    assert.strictEqual(getGlobalAfkReason(OWNER), null);
    assert.strictEqual(getAfkReason(GROUP, OWNER), null);
    assert.strictEqual(sent.length, 0);
  });

  it("um membro comum avisa só o grupo onde escreveu", async () => {
    const { ctx, sent } = makeCommandCtx({ userLid: MEMBRO, fullArgs: "almoço" });

    await afkCommand.handle(ctx);

    assert.strictEqual(getGlobalAfkReason(MEMBRO), null);
    assert.strictEqual(getAfkReason(GROUP, MEMBRO), "almoço");
    assert.strictEqual(sent.length, 0);
  });

  it("usa um motivo padrão quando não é enviado nenhum", async () => {
    const { ctx } = makeCommandCtx({ userLid: MEMBRO, fullArgs: "" });

    await afkCommand.handle(ctx);

    assert.strictEqual(getAfkReason(GROUP, MEMBRO), "não informado");
  });

  it("recusa fora de um grupo", async () => {
    const { ctx } = makeCommandCtx({ userLid: OWNER, isOwner: true, isGroup: false });

    await assert.rejects(() => afkCommand.handle(ctx), /só pode ser usado em grupos/);
  });
});

describe("afkBroadcast", () => {
  it("lista os grupos do socket, salta o grupo de origem e marca o membro", async () => {
    const sent = [];
    const socket = {
      groupFetchAllParticipating: async () => ({ [GROUP]: {}, [OUTRO]: {} }),
      sendMessage: async (jid, payload) => sent.push({ jid, payload }),
    };

    assert.deepStrictEqual((await listJoinedGroupIds(socket)).sort(), [GROUP, OUTRO].sort());

    const enviados = await broadcastToAllGroups({
      socket,
      text: "aviso",
      mentions: [OWNER],
      skipJid: GROUP,
      delayMs: 0,
    });

    assert.strictEqual(enviados, 1);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].jid, OUTRO);
    assert.deepStrictEqual(sent[0].payload.mentions, [OWNER]);
  });

  it("devolve vazio quando o socket não sabe listar grupos", async () => {
    assert.deepStrictEqual(await listJoinedGroupIds({}), []);
  });

  it("não rebenta quando um grupo falha", async () => {
    const sent = [];
    const socket = {
      groupFetchAllParticipating: async () => ({ [GROUP]: {}, [OUTRO]: {} }),
      sendMessage: async (jid) => {
        if (jid === GROUP) throw new Error("sem permissão");
        sent.push(jid);
      },
    };

    const enviados = await broadcastToAllGroups({ socket, text: "aviso", delayMs: 0 });

    assert.strictEqual(enviados, 1);
    assert.deepStrictEqual(sent, [OUTRO]);
  });

  it("mantém um delay anti-spam entre grupos", () => {
    assert.ok(BROADCAST_DELAY_MS >= 500);
  });
});
