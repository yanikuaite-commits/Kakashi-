/**
 * Testes do registo de chaves de API configuráveis pelo WhatsApp.
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { DATABASE_DIR } from "../config.js";
import {
  API_KEYS,
  activateGroup,
  getApiKey,
  getGithubToken,
  getSpiderApiToken,
  isApiKeyConfigured,
  listApiKeys,
  removeApiKey,
  setApiKey,
  setBotEnabled,
  setGithubToken,
  setSpiderApiToken,
} from "../utils/database.js";

const configPath = path.join(DATABASE_DIR, "config.json");
const estadoPath = [
  configPath,
  path.join(DATABASE_DIR, "inactive-groups.json"),
  path.join(DATABASE_DIR, "bot-state.json"),
].map((ficheiro) => [ficheiro, null]);

describe("API keys configuráveis", () => {
  before(() => {
    for (const par of estadoPath) {
      const [ficheiro] = par;
      par[1] = fs.existsSync(ficheiro) ? fs.readFileSync(ficheiro, "utf8") : null;
    }
  });

  after(() => {
    for (const [ficheiro, conteudo] of estadoPath) {
      if (conteudo !== null) {
        fs.writeFileSync(ficheiro, conteudo);
      } else if (fs.existsSync(ficheiro)) {
        fs.unlinkSync(ficheiro);
      }
    }
  });

  it("reúne todas as chaves que o bot usa, cada uma com rótulo e dica", () => {
    const chaves = listApiKeys();

    assert.equal(chaves.length, Object.keys(API_KEYS).length);
    for (const chave of chaves) {
      assert.ok(chave.label, `${chave.name} tem rótulo`);
      assert.ok(chave.hint, `${chave.name} tem dica`);
      assert.equal(typeof chave.configured, "boolean");
    }

    // As APIs que o dono pode querer configurar pelo WhatsApp.
    const nomes = chaves.map((c) => c.name);
    for (const esperado of [
      "github_token",
      "spider_api_token",
      "linker_api_key",
      "groq_api_key",
      "gemini_api_key",
      "hf_token",
    ]) {
      assert.ok(nomes.includes(esperado), `o registo inclui ${esperado}`);
    }
  });

  it("guarda uma chave e devolve-a depois", () => {
    const valor = "gsk_teste_" + Date.now();

    assert.equal(setApiKey("groq_api_key", valor), true);
    assert.equal(getApiKey("groq_api_key"), valor);
    assert.equal(isApiKeyConfigured("groq_api_key"), true);

    removeApiKey("groq_api_key");
  });

  it("o valor definido pelo WhatsApp ganha ao valor do ambiente", () => {
    const doWhatsApp = "token_do_whatsapp_" + Date.now();

    setApiKey("spider_api_token", doWhatsApp);
    assert.equal(getApiKey("spider_api_token"), doWhatsApp);
    assert.equal(getSpiderApiToken(), doWhatsApp);

    removeApiKey("spider_api_token");
  });

  it("remover a chave volta a deixar o valor do ambiente (ou vazio)", () => {
    const valor = "ghp_" + Date.now();

    setApiKey("github_token", valor);
    assert.equal(getGithubToken(), valor);

    assert.equal(removeApiKey("github_token"), true);
    // Sem valor no ambiente, fica vazio em vez de devolver a chave removida.
    assert.notEqual(getGithubToken(), valor);
    assert.equal(removeApiKey("github_token"), false);
  });

  it("ignora chaves desconhecidas em vez de as guardar", () => {
    assert.equal(setApiKey("api_que_nao_existe", "x"), false);
    assert.equal(removeApiKey("api_que_nao_existe"), false);
    assert.equal(getApiKey("api_que_nao_existe"), "");
  });

  it("nunca conta o marcador do molde como chave configurada", () => {
    setApiKey("spider_api_token", "seu_token_aqui");

    assert.equal(isApiKeyConfigured("spider_api_token"), false);

    removeApiKey("spider_api_token");
  });

  it("os acessores antigos continuam a funcionar", () => {
    const valor = "spider_antigo_" + Date.now();

    setSpiderApiToken(valor);
    assert.equal(getSpiderApiToken(), valor);

    setGithubToken(valor);
    assert.equal(getGithubToken(), valor);

    removeApiKey("spider_api_token");
    removeApiKey("github_token");
  });

  describe("comando do dono", () => {
    /** Junta as respostas do comando num só texto, para as inspeções. */
    async function correr(comando, texto) {
      const saida = [];

      await comando.handle({
        args: [],
        fullArgs: texto,
        sendReply: async (t) => saida.push(t),
        sendSuccessReply: async (t) => saida.push(t),
        sendWarningReply: async (t) => saida.push(t),
      });

      return saida.join("\n");
    }

    it("sem argumentos explica onde obter a chave, sem a revelar", async () => {
      const comando = (await import("../commands/owner/set-groq-api-token.js")).default;
      const resposta = await correr(comando, "");

      assert.match(resposta, /Groq/);
      assert.match(resposta, /console\.groq\.com/);
    });

    it("recusa uma chave curta demais", async () => {
      const comando = (await import("../commands/owner/set-groq-api-token.js")).default;

      await assert.rejects(() => correr(comando, "curta"), /curta demais/);
    });

    it("recusa uma chave com espaços", async () => {
      const comando = (await import("../commands/owner/set-groq-api-token.js")).default;

      await assert.rejects(
        () => correr(comando, "gsk_" + "a".repeat(30) + " b"),
        /espaços/,
      );
    });

    it("guarda a chave e confirma-a mascarada", async () => {
      const comando = (await import("../commands/owner/set-groq-api-token.js")).default;
      const chave = "gsk_" + "a".repeat(40);
      const resposta = await correr(comando, chave);

      assert.equal(getApiKey("groq_api_key"), chave);
      assert.ok(!resposta.includes(chave), "a resposta não revela a chave");
      assert.match(resposta, /••••aaaa/);

      removeApiKey("groq_api_key");
    });

    it("a palavra 'remover' apaga a chave", async () => {
      const comando = (await import("../commands/owner/set-groq-api-token.js")).default;

      setApiKey("groq_api_key", "gsk_" + "b".repeat(40));
      const resposta = await correr(comando, "remover");

      assert.equal(getApiKey("groq_api_key"), "");
      assert.match(resposta, /removida/);
    });

    it("a listagem mostra o estado e nunca imprime a chave inteira", async () => {
      const comando = (await import("../commands/owner/api-keys.js")).default;
      const chave = "spider_secreta_" + Date.now();

      setApiKey("spider_api_token", chave);
      const resposta = await correr(comando, "");

      assert.match(resposta, /Spider X/);
      assert.match(resposta, /GitHub/);
      assert.ok(!resposta.includes(chave), "a listagem não revela a chave");

      removeApiKey("spider_api_token");
    });

    it("um membro comum não consegue chamar os comandos de chave", async () => {
      const { dynamicCommand } = await import("../utils/dynamicCommand.js");
      const { extractDataFromMessage } = await import("../utils/index.js");

      const respostas = [];
      const membro = "membro-apitest-" + Date.now() + "@lid";
      const remoteJid = `apitest-${Date.now()}@g.us`;

      // O grupo precisa de estar ativo para a mensagem chegar ao dispatcher.
      activateGroup(remoteJid);
      setBotEnabled(true);

      const webMessage = {
        key: { remoteJid, participant: membro },
        pushName: "Membro",
        message: { conversation: ".set-groq-api-token gsk_" + "z".repeat(40) },
      };

      await dynamicCommand(
        {
          ...extractDataFromMessage(webMessage),
          userLid: membro,
          webMessage,
          sendReply: async (m) => respostas.push(String(m)),
          sendWarningReply: async (m) => respostas.push(String(m)),
          sendErrorReply: async (m) => respostas.push(String(m)),
          sendSuccessReply: async (m) => respostas.push(String(m)),
          sendReact: async () => {},
          sendSuccessReact: async () => {},
          sendWaitReact: async () => {},
        },
        Date.now(),
      );

      assert.match(respostas.join("\n"), /permiss/i);
      assert.equal(getApiKey("groq_api_key"), "", "nada foi guardado");
    });
  });
});
