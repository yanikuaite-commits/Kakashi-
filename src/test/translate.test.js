import assert from "node:assert/strict";
import { test } from "node:test";
import { translateToEnglish } from "../services/translate.js";

/**
 * Tradução com a rede substituída (o padrão do repo): prova o contrato do
 * serviço sem depender de um serviço externo, que é instável por natureza.
 *
 * O que importa garantir é a DEGRADAÇÃO: uma falha de tradução nunca pode
 * lançar, porque a tradução é um extra — o download tem de continuar com o
 * termo original.
 */
function comResposta(resposta) {
  globalThis.fetch = async () => resposta;
}

function comJson(corpo) {
  comResposta({ ok: true, status: 200, json: async () => corpo });
}

function limpar() {
  delete globalThis.fetch;
}

test("traduz um título em português para inglês", async () => {
  comJson([[["My Hero Academia", "Meu Hero Academia", null, null]], null, "pt"]);
  try {
    assert.equal(await translateToEnglish("Meu Hero Academia"), "My Hero Academia");
  } finally {
    limpar();
  }
});

test("junta as partes quando a resposta vem segmentada", async () => {
  comJson([
    [
      ["Attack ", "Ataque ", null],
      ["on Titan", "dos Titãs", null],
    ],
    null,
    "pt",
  ]);
  try {
    assert.equal(await translateToEnglish("Ataque dos Titãs"), "Attack on Titan");
  } finally {
    limpar();
  }
});

test("tradução igual ao original devolve null (não há ganho em repetir)", async () => {
  comJson([[["Naruto", "Naruto", null, null]], null, "pt"]);
  try {
    assert.equal(
      await translateToEnglish("Naruto"),
      null,
      "sem termo novo, quem chama não deve repetir a pesquisa",
    );
  } finally {
    limpar();
  }
});

test("ignora maiúsculas ao comparar com o original", async () => {
  comJson([[["one piece", "one piece", null, null]], null, "pt"]);
  try {
    assert.equal(await translateToEnglish("One Piece"), null);
  } finally {
    limpar();
  }
});

test("texto vazio não vai à rede", async () => {
  globalThis.fetch = async () => {
    throw new Error("não devia ser chamado");
  };
  try {
    assert.equal(await translateToEnglish("   "), null);
    assert.equal(await translateToEnglish(""), null);
    assert.equal(await translateToEnglish(null), null);
  } finally {
    limpar();
  }
});

test("HTTP de erro devolve null em vez de rebentar", async () => {
  comResposta({ ok: false, status: 503, json: async () => ({}) });
  try {
    assert.equal(await translateToEnglish("Meu Hero Academia"), null);
  } finally {
    limpar();
  }
});

test("falha de rede devolve null (o download continua com o original)", async () => {
  globalThis.fetch = async () => {
    throw new Error("ENOTFOUND");
  };
  try {
    assert.equal(await translateToEnglish("Meu Hero Academia"), null);
  } finally {
    limpar();
  }
});

test("resposta em formato inesperado devolve null em vez de rebentar", async () => {
  comJson({ inesperado: true });
  try {
    assert.equal(await translateToEnglish("Meu Hero Academia"), null);
  } finally {
    limpar();
  }
});
