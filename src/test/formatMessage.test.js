import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PLAIN_MESSAGE_THEME } from "../config.js";
import {
  __setMessageThemeForTests,
  ensureFrame,
  formatMessage,
  RODAPE,
} from "../utils/formatMessage.js";

// O tema ativo vem do config (por omissão "plain"). Os testes abaixo exercitam
// os DOIS temas, para o tema que não está ativo não apodrecer em silêncio.
after(() => __setMessageThemeForTests(PLAIN_MESSAGE_THEME));

test("tema plain: a resposta é só o conteúdo, sem moldura nem rodapé", () => {
  __setMessageThemeForTests(true);

  const result = formatMessage({
    icone: "🎛️",
    titulo: "Resposta",
    campos: ["Olá!"],
  });

  assert.equal(result, "*RESPOSTA*\n\nOlá!");
  assert.ok(!result.includes("┌─〔"), "sem caixa");
  assert.ok(!result.includes("☄️ · ✦"), "sem cabeçalho cósmico");
  assert.ok(!result.includes(RODAPE), "sem rodapé");
  assert.ok(!/KAKASHI BOT/.test(result), "sem a assinatura do molde");
});

test("tema plain: sem título, a resposta é exatamente o conteúdo", () => {
  __setMessageThemeForTests(true);

  assert.equal(formatMessage({ campos: ["Olá!", "", "Tudo bem?"] }), "Olá!\n\nTudo bem?");
});

test("tema plain: mensagens por tipo mantêm o conteúdo e perdem o embrulho", () => {
  __setMessageThemeForTests(true);

  for (const texto of [
    "Feito com sucesso!",
    "Erro: não consegui baixar o arquivo",
    "O membro foi removido do grupo",
  ]) {
    const result = ensureFrame(texto);
    assert.ok(result.includes(texto), `devia manter o conteúdo: ${result}`);
    assert.ok(!result.includes(RODAPE), "sem rodapé");
    assert.ok(!result.includes("┌─〔"), "sem caixa");
  }
});

test("tema galaxy: cabeçalho por tipo, caixa e rodapé", () => {
  __setMessageThemeForTests(false);

  const cases = [
    ["Feito com sucesso!", "✅", "CONCLUÍDO"],
    ["Erro: não consegui baixar o arquivo", "❌", "ERRO"],
    ["A IA respondeu à pergunta", "🤖", "INTELIGÊNCIA ARTIFICIAL"],
    ["O jogador ganhou pontos de XP", "🎮", "JOGO E XP"],
    ["O membro foi removido do grupo", "🛡️", "MODERAÇÃO"],
  ];

  for (const [text, icon, title] of cases) {
    const result = ensureFrame(text);
    assert.match(result, new RegExp(`${icon} \\*KAKASHI BOT • ${title}\\*`));
    assert.ok(result.endsWith(RODAPE));
    assert.ok(result.includes(text));
  }
});

test("respostas explicitamente formatadas e mensagens longas permanecem intactas", () => {
  __setMessageThemeForTests(false);

  const explicit = formatMessage({ icone: "📋", titulo: "Menu", campos: ["Opção"] });
  assert.equal(ensureFrame(explicit), explicit);

  const longText = "linha\n".repeat(45);
  assert.equal(ensureFrame(longText), longText);
});