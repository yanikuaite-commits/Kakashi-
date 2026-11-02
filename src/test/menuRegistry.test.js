import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATEGORIES,
  FUNCTIONS,
  getFunction,
  listFunctions,
} from "../interactive/menuRegistry.js";
import { MENU_CATEGORIES } from "../menu.js";
import { readCommandImports } from "../utils/index.js";

/**
 * Todos os nomes de comando publicados pelos ficheiros de `src/commands`.
 *
 * Usa o mesmo carregador do bot em vez de analisar o texto dos ficheiros: os
 * comandos de chave de API são construídos por uma fábrica, pelo que não têm um
 * `commands: [...]` literal para uma expressão regular encontrar.
 */
async function comandosDisponiveis() {
  const disponiveis = new Set();
  const importados = await readCommandImports();

  for (const comandos of Object.values(importados)) {
    for (const comando of comandos) {
      if (!comando) continue;
      if (comando.name) disponiveis.add(comando.name.toLowerCase());
      for (const alias of comando.commands || []) {
        disponiveis.add(String(alias).toLowerCase());
      }
    }
  }

  return disponiveis;
}

test("toda entrada do menu aponta para um comando que existe", async () => {
  const disponiveis = await comandosDisponiveis();

  for (const funcao of FUNCTIONS) {
    assert.ok(
      disponiveis.has(funcao.comando.toLowerCase()),
      `${funcao.categoria}/${funcao.id}: comando "${funcao.comando}" não existe`,
    );
  }
});

test("toda função declara o que espera e uma descrição", () => {
  const tipos = new Set(["link", "texto", "midia", "nenhum"]);

  for (const funcao of FUNCTIONS) {
    assert.ok(
      tipos.has(funcao.aceita),
      `${funcao.categoria}/${funcao.id}: aceita inválido "${funcao.aceita}"`,
    );
    assert.ok(funcao.titulo, `${funcao.categoria}/${funcao.id}: sem título`);
    assert.ok(funcao.descricao, `${funcao.categoria}/${funcao.id}: sem descrição`);
    assert.ok(funcao.guia, `${funcao.categoria}/${funcao.id}: sem guia`);
  }
});

test("nenhuma categoria do menu abre vazia", () => {
  for (const categoria of CATEGORIES) {
    assert.ok(
      listFunctions(categoria.id).length > 0,
      `categoria "${categoria.id}" (${categoria.titulo}) está vazia`,
    );
  }
});

test("a categoria cinema oferece o megacine", () => {
  const funcoes = listFunctions("cinema").map((funcao) => funcao.comando);
  assert.ok(funcoes.includes("megacine"));
});

test("a categoria dev é restrita ao dono e cobre os exemplos de envio", () => {
  const dev = CATEGORIES.find((categoria) => categoria.id === "dev");
  assert.ok(dev, "categoria dev existe");
  assert.equal(dev.restrita, "owner");

  const funcoes = listFunctions("dev").map((funcao) => funcao.comando);
  for (const esperado of ["enviar-texto", "enviar-botoes", "raw-message"]) {
    assert.ok(funcoes.includes(esperado), `dev sem "${esperado}"`);
  }
});

test("a categoria dev acompanha o catálogo de texto", () => {
  const chaves = MENU_CATEGORIES.map((categoria) => categoria.key);
  assert.ok(chaves.includes("dev"));
});

test("as entradas de moderação exigem uma marcação com @", () => {
  const ban = getFunction("admin", "ban");
  assert.ok(ban.validador);
  assert.equal(ban.validador("@5511999999999"), true);
  assert.equal(ban.validador("5511999999999"), false);
  assert.equal(ban.validador("@abc"), false);
});

test("a whitelist privada exige um LID válido", () => {
  const whitelist = getFunction("dono", "private-whitelist");
  assert.equal(whitelist.args, "add");
  assert.equal(whitelist.validador("275381038891241@lid"), true);
  assert.equal(whitelist.validador("275381038891241:12@lid"), true);
  assert.equal(whitelist.validador("275381038891241"), true);
  assert.equal(whitelist.validador("123"), false);
});
