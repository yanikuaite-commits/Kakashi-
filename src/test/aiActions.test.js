/**
 * Teste ponta-a-ponta do chat da IA: a acção pedida é re-despachada pelo
 * `dynamicCommand`, e é ele que manda na permissão.
 *
 * O objetivo é provar que a IA NÃO é um atalho para as permissões: um membro
 * comum com um admin no comando `handle` continua a ser travado pelo
 * `checkPermission` do despacho.
 *
 * @author Dev Yanik
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { DATABASE_DIR, OWNER_LID } from "../config.js";
import {
  activateGroup,
  deactivateAntiLinkGroup,
  isActiveAntiLinkGroup,
  setBotEnabled,
} from "../utils/database.js";
import { extractDataFromMessage } from "../utils/index.js";
import { resetBotCommandsCache } from "../services/botCommands.js";

const GROUP = "ai-action@g.us";
const ANTI_LINK_FILE = path.join(DATABASE_DIR, "anti-link-groups.json");
const INACTIVE_FILE = path.join(DATABASE_DIR, "inactive-groups.json");
const BOT_STATE_FILE = path.join(DATABASE_DIR, "bot-state.json");

let antiLinkBackup;
let inactiveBackup;
let botStateBackup;

before(async () => {
  antiLinkBackup = await readFile(ANTI_LINK_FILE).catch(() => null);
  inactiveBackup = await readFile(INACTIVE_FILE).catch(() => null);
  botStateBackup = await readFile(BOT_STATE_FILE).catch(() => null);
});

after(async () => {
  if (antiLinkBackup !== null) await writeFile(ANTI_LINK_FILE, antiLinkBackup);
  if (inactiveBackup !== null) await writeFile(INACTIVE_FILE, inactiveBackup);
  if (botStateBackup !== null) await writeFile(BOT_STATE_FILE, botStateBackup);
});

beforeEach(() => {
  deactivateAntiLinkGroup(GROUP);
  activateGroup(GROUP);
  // O despacho só atende não-donos com o bot ligado; sem isto o teste mediria o
  // interruptor global, não a permissão do comando.
  setBotEnabled(true);
});

/**
 * Corre o chat da IA com a resposta do modelo forçada a um pedido de execução.
 * O `fetch` é substituído porque a IA é externa; tudo o resto (permissões,
 * persistência, despacho) é código real.
 */
async function correrChat({ texto, userLid, isOwner = false, admin = null, respostaDoModelo }) {
  const { setApiKey, removeApiKey } = await import("../utils/database.js");
  const gemini = (await import("../commands/member/ia/gemini.js")).default;

  setApiKey("groq_api_key", "gsk_test_key_123456");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: respostaDoModelo } }] }),
  });

  const warnings = [];
  const errors = [];
  const successes = [];

  const webMessage = {
    key: { remoteJid: GROUP, participant: userLid },
    pushName: "Pessoa",
    message: { conversation: texto },
  };

  try {
    await gemini.handle({
      ...extractDataFromMessage(webMessage),
      userLid,
      isOwner,
      isGroup: true,
      webMessage,
      startProcess: Date.now(),
      socket: {
        groupMetadata: async () => ({
          owner: "outro@lid",
          participants: [
            { id: userLid, admin },
            { id: "outro@lid", admin: "superadmin" },
          ],
        }),
        sendPresenceUpdate: async () => {},
        sendMessage: async () => ({}),
      },
      getGroupName: async () => "Grupo",
      getGroupParticipants: async () => [],
      sendWaitReply: async () => null,
      sendSuccessReply: async (text) => successes.push(text),
      sendEditedReply: async () => {},
      sendReply: async (text) => warnings.push(text),
      sendWarningReply: async (text) => warnings.push(text),
      sendErrorReply: async (text) => errors.push(text),
      sendSuccessReact: async () => {},
    });
  } finally {
    globalThis.fetch = originalFetch;
    removeApiKey("groq_api_key");
  }

  return { warnings, errors, successes };
}

describe("IA e execução de comandos", () => {
  it("um membro comum não executa nada, mesmo que o modelo peça", async () => {
    resetBotCommandsCache();
    const { successes, errors } = await correrChat({
      texto: "ativar anti link",
      userLid: "membro@lid",
      admin: null,
      respostaDoModelo: '{"action":"run","command":"anti-link","intent":"on"}',
    });

    // O anti-link continua desligado: o membro nem recebe o prompt de acção.
    assert.equal(isActiveAntiLinkGroup(GROUP), false);
    assert.equal(errors.length, 0);

    // O que ele recebe é o JSON como texto, não a execução.
    assert.equal(successes.length, 1);
    assert.match(successes[0], /anti-link/);
  });

  it("o dono liga o anti-link pela IA", async () => {
    resetBotCommandsCache();
    await correrChat({
      texto: "ativar anti link",
      userLid: OWNER_LID,
      isOwner: true,
      respostaDoModelo: '{"action":"run","command":"anti-link","intent":"on"}',
    });

    assert.equal(isActiveAntiLinkGroup(GROUP), true);
  });

  it("um admin do grupo liga o anti-link pela IA", async () => {
    resetBotCommandsCache();
    await correrChat({
      texto: "ativar anti link",
      userLid: "admin@lid",
      admin: "admin",
      respostaDoModelo: '{"action":"run","command":"anti-link","intent":"on"}',
    });

    assert.equal(isActiveAntiLinkGroup(GROUP), true);
  });

  it("executa mesmo quando o modelo responde em prosa", async () => {
    resetBotCommandsCache();
    await correrChat({
      texto: "Kakashi, ativar anti link",
      userLid: OWNER_LID,
      isOwner: true,
      // O modelo não devolveu JSON; o texto do usuário é lido como pedido.
      respostaDoModelo: "Claro! Vou ativar o anti-link neste grupo.",
    });

    assert.equal(isActiveAntiLinkGroup(GROUP), true);
  });

  it("uma resposta em texto não executa nada", async () => {
    resetBotCommandsCache();
    const { successes, errors } = await correrChat({
      texto: "o que faz o anti-link?",
      userLid: OWNER_LID,
      isOwner: true,
      respostaDoModelo: "O anti-link apaga links que os membros enviarem.",
    });

    assert.equal(isActiveAntiLinkGroup(GROUP), false);
    assert.equal(errors.length, 0);
    assert.equal(successes.length, 1);
    assert.match(successes[0], /apaga links/);
  });
});
