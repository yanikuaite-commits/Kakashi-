/**
 * Testes do chat da IA: âmbito (só bot e contas simples) e respostas curtas.
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { askGroq, parseAiAction } from "../services/ai.js";
import geminiCommand from "../commands/member/ia/gemini.js";
import {
  GROQ_MAX_TOKENS,
  GROQ_OWNER_CONTEXT_PROMPT,
  GROQ_SYSTEM_PROMPT,
  GROQ_TEMPERATURE,
  DATABASE_DIR,
} from "../config.js";
import { removeApiKey, setApiKey } from "../utils/database.js";

const configPath = path.join(DATABASE_DIR, "config.json");
let configBackup;
let originalFetch;
let captured;

before(() => {
  configBackup = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf8")
    : null;
});

after(() => {
  if (configBackup !== null) fs.writeFileSync(configPath, configBackup);
  else if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
});

beforeEach(() => {
  originalFetch = globalThis.fetch;
  captured = [];

  globalThis.fetch = async (url, options) => {
    captured.push({ url, body: JSON.parse(options.body) });

    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "2 + 2 = 4" } }] }),
    };
  };

  // A chave vem do `config.json` (tem prioridade sobre o ambiente), que é onde
  // o dono a guarda pelo WhatsApp.
  setApiKey("groq_api_key", "gsk_test_key_123456");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  removeApiKey("groq_api_key");
});

describe("prompt de sistema da IA", () => {
  it("permite conversa básica e mantém-se restrita ao bot e contas simples", () => {
    assert.match(GROQ_SYSTEM_PROMPT, /Conversa básica/);
    assert.match(GROQ_SYSTEM_PROMPT, /Kakashi Bot/);
    assert.match(GROQ_SYSTEM_PROMPT, /matemática simples/i);
    assert.match(GROQ_SYSTEM_PROMPT, /recusa/i);
    assert.match(GROQ_SYSTEM_PROMPT, /tudo bem/i);
    assert.match(GROQ_SYSTEM_PROMPT, /COMANDOS DISPONÍVEIS/);
    assert.match(GROQ_SYSTEM_PROMPT, /COMO RECARREGAR/);
  });

  it("pede respostas curtas e uma temperatura baixa", () => {
    assert.match(GROQ_SYSTEM_PROMPT, /no máximo 3 frases/);
    assert.ok(GROQ_TEMPERATURE <= 0.4);
    assert.ok(GROQ_MAX_TOKENS <= 512);
  });

  it("manda o dono usar os valores reais do estado do bot", () => {
    assert.match(GROQ_OWNER_CONTEXT_PROMPT, /ESTADO ATUAL DO BOT/);
    assert.match(GROQ_OWNER_CONTEXT_PROMPT, /não os inventes/i);
  });
});

describe("askGroq", () => {
  it("envia o prompt de sistema como primeira mensagem", async () => {
    const { text, action } = await askGroq("grupo@g.us", "quanto é 2+2?");

    assert.strictEqual(text, "2 + 2 = 4");
    assert.strictEqual(action, null);

    const { body } = captured.at(-1);
    assert.strictEqual(body.messages[0].role, "system");
    assert.strictEqual(body.messages[0].content, GROQ_SYSTEM_PROMPT);
    assert.strictEqual(body.messages.at(-1).content, "quanto é 2+2?");
    assert.strictEqual(body.temperature, GROQ_TEMPERATURE);
    assert.strictEqual(body.max_completion_tokens, GROQ_MAX_TOKENS);
  });

  it("mantém o prompt de sistema e o histórico nos pedidos seguintes", async () => {
    await askGroq("grupo@g.us", "quanto é 2+2?");
    await askGroq("grupo@g.us", "e 3+3?");

    const { body } = captured.at(-1);
    assert.strictEqual(body.messages[0].role, "system");
    assert.ok(body.messages.some((m) => m.content === "2 + 2 = 4"));
    assert.strictEqual(body.messages.at(-1).content, "e 3+3?");
  });

  it("não mistura o histórico de conversas diferentes", async () => {
    await askGroq("a@g.us", "pergunta A");
    await askGroq("b@g.us", "pergunta B");

    const { body } = captured.at(-1);
    assert.ok(!body.messages.some((m) => m.content === "pergunta A"));
  });

  it("injeta o estado do bot como mensagem de sistema quando há contexto", async () => {
    await askGroq("dono@g.us", "quantos na whitelist?", {
      context: "ESTADO ATUAL DO BOT\n- whitelist privada: 7 usuário(s)",
    });

    const { body } = captured.at(-1);
    const sistemas = body.messages.filter((m) => m.role === "system");

    assert.strictEqual(sistemas[0].content, GROQ_SYSTEM_PROMPT);
    assert.match(sistemas[1].content, /COMANDOS DISPONÍVEIS/);
    assert.strictEqual(sistemas[2].content, GROQ_OWNER_CONTEXT_PROMPT);
    assert.match(sistemas[3].content, /whitelist privada: 7/);
    assert.strictEqual(body.messages.at(-1).content, "quantos na whitelist?");
  });

  it("injeta o conhecimento do bot para qualquer usuário, mas não o estado", async () => {
    await askGroq("membro@g.us", "oi", { context: null });

    const { body } = captured.at(-1);
    const sistemas = body.messages.filter((m) => m.role === "system");

    assert.strictEqual(sistemas[0].content, GROQ_SYSTEM_PROMPT);
    assert.match(sistemas[1].content, /COMANDOS DISPONÍVEIS/);
    assert.match(sistemas[1].content, /COMO RECARREGAR/);
    assert.ok(!sistemas.some((m) => m.content === GROQ_OWNER_CONTEXT_PROMPT));
    assert.ok(
      !sistemas.some((m) => /ESTADO ATUAL DO BOT \(dados reais/.test(m.content)),
    );
  });

  it("não guarda o estado no histórico entre pedidos", async () => {
    const marcador = "SNAPSHOT-MARKER-98765";
    await askGroq("dono2@g.us", "primeira", {
      context: `ESTADO ATUAL DO BOT\n- ${marcador}`,
    });
    await askGroq("dono2@g.us", "segunda");

    const { body } = captured.at(-1);
    // O segundo pedido não recebeu contexto, por isso não pode conter o estado
    // do primeiro: se estivesse no histórico, ficaria colado para sempre.
    assert.ok(!body.messages.some((m) => String(m.content).includes(marcador)));
  });
});

describe("parseAiAction", () => {
  it("lê o pedido de execução do JSON", () => {
    assert.deepStrictEqual(
      parseAiAction('{"action":"run","command":"anti-link","intent":"on"}'),
      { command: "anti-link", intent: "on" },
    );

    assert.deepStrictEqual(
      parseAiAction('```json\n{"action":"run","command":"abrir"}\n```'),
      { command: "abrir" },
    );
  });

  it("ignora texto normal e JSON inválido", () => {
    assert.strictEqual(parseAiAction("2 + 2 = 4"), null);
    assert.strictEqual(parseAiAction('{"action":"run"}'), null);
    assert.strictEqual(parseAiAction('{"action":"outra"}'), null);
    assert.strictEqual(parseAiAction("{isto não é json}"), null);
    assert.strictEqual(parseAiAction(""), null);
  });
});

describe("comando .kakashi (integração)", () => {
  function ctx(extra = {}) {
    return {
      args: ["tudo", "bem?"],
      remoteJid: "grupo@g.us",
      isOwner: false,
      isGroup: true,
      socket: { groupFetchAllParticipating: async () => ({ "a@g.us": {} }) },
      getGroupName: async () => "Grupo X",
      getGroupParticipants: async () => [{}, {}],
      sendWaitReply: async () => null,
      sendSuccessReply: async () => {},
      sendEditedReply: async () => {},
      ...extra,
    };
  }

  it("um membro comum não recebe o estado do bot no pedido", async () => {
    await geminiCommand.handle(ctx({ isOwner: false }));

    const sistemas = captured.at(-1).body.messages.filter(
      (m) => m.role === "system",
    );

    assert.strictEqual(sistemas.length, 2);
    assert.match(sistemas[1].content, /COMANDOS DISPONÍVEIS/);
    assert.ok(
      !captured
        .at(-1)
        .body.messages.some((m) => /whitelist privada:/.test(String(m.content))),
    );
  });

  it("o dono recebe o estado real do bot no pedido", async () => {
    await geminiCommand.handle(ctx({ isOwner: true }));

    const conteudo = captured
      .at(-1)
      .body.messages.map((m) => String(m.content))
      .join("\n");

    assert.match(conteudo, /ESTADO ATUAL DO BOT/);
    assert.match(conteudo, /whitelist privada/);
    assert.match(conteudo, /grupos onde o bot está: 1/);
    assert.match(conteudo, /grupo atual: "Grupo X", 2 participante/);
  });
});
