import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureFrame, formatMessage, RODAPE } from "../utils/formatMessage.js";

test("respostas simples ganham cabeçalho por tipo e rodapé", () => {
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
  const explicit = formatMessage({ icone: "📋", titulo: "Menu", campos: ["Opção"] });
  assert.equal(ensureFrame(explicit), explicit);

  const longText = "linha\n".repeat(45);
  assert.equal(ensureFrame(longText), longText);
});