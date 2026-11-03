/**
 * Testes do conhecimento do bot injetado na IA (comandos + recarga).
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  botKnowledgeText,
  commandCatalogText,
  paymentGuideText,
  resetBotKnowledgeCache,
} from "../services/botKnowledge.js";
import { PREFIX } from "../config.js";

describe("catálogo de comandos", () => {
  it("lista comandos reais de membro e de admin", async () => {
    const catalogo = await commandCatalogText();

    assert.match(catalogo, /\[member\]/);
    assert.match(catalogo, /\[admin\]/);
    // Comandos que existem mesmo no projeto.
    assert.match(catalogo, /^anime: /m);
    assert.match(catalogo, /^pagamento: /m);
    assert.match(catalogo, /^ban: /m);
  });

  it("não anuncia as amostras de desenvolvedor ao membro comum", async () => {
    const catalogo = await commandCatalogText();

    assert.ok(!/enviar-texto:/.test(catalogo));
    assert.ok(!/enviar-imagem-de-url:/.test(catalogo));
    assert.ok(!/raw-message:/.test(catalogo));
  });

  it("não vaza comandos de dono (só o fluxo público)", async () => {
    const catalogo = await commandCatalogText();

    assert.ok(!/backup:/.test(catalogo));
    assert.ok(!/set-github-token:/.test(catalogo));
    assert.ok(!/private-whitelist:/.test(catalogo));
  });
});

describe("guia de recarga", () => {
  it("explica o fluxo de pagamento e mostra as tabelas reais", () => {
    const guia = paymentGuideText();

    assert.match(guia, /COMO RECARREGAR/);
    assert.match(guia, new RegExp(`${PREFIX}pagamento`));
    assert.match(guia, /Reencaminha o SMS do comprovativo/);
    assert.match(guia, /5 MT → 15 créditos/);
    assert.match(guia, /7 dias → 20 MT → \+40 créditos/);
  });
});

describe("botKnowledgeText", () => {
  it("junta o contexto do bot, o catálogo e a recarga", async () => {
    const texto = await botKnowledgeText();

    assert.match(texto, /SOBRE O KAKASHI BOT/);
    assert.match(texto, /COMANDOS DISPONÍVEIS/);
    assert.match(texto, /COMO RECARREGAR/);
  });

  it("cacheia o resultado entre chamadas", async () => {
    resetBotKnowledgeCache();
    const primeiro = await botKnowledgeText();
    const segundo = await botKnowledgeText();

    assert.strictEqual(primeiro, segundo);
  });
});
