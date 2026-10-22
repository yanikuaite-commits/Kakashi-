/**
 * Testes das tabelas de preços (dados, formatação e despacho 1/2).
 *
 * @author Dev Gui
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTableRows } from "../utils/richTable.js";
import {
  TABELA_IDS,
  TABELAS,
  formatTabelaTexto,
  getTabela,
  tabelaIdDoArgumento,
  tabelaOpcoes,
} from "../utils/tabelaPrecos.js";

test("tabela 1 lista os planos por dias pedidos", () => {
  assert.deepEqual(TABELAS.dias.linhas, [
    ["7 dias", "20 MT"],
    ["14 dias", "45 MT"],
    ["20 dias", "60 MT"],
    ["30 dias", "90 MT"],
    ["60 dias", "140 MT"],
  ]);
  assert.deepEqual(TABELAS.dias.cabecalho, ["Dias", "Preço"]);
});

test("tabela 2 lista os pacotes de créditos pedidos", () => {
  assert.deepEqual(TABELAS.creditos.linhas, [
    ["5 MT", "15 créditos"],
    ["10 MT", "30 créditos"],
    ["20 MT", "55 créditos"],
    ["30 MT", "85 créditos"],
    ["50 MT", "120 créditos"],
  ]);
  assert.deepEqual(TABELAS.creditos.cabecalho, ["Preço", "Créditos"]);
});

test("tabelaOpcoes numera 1 = dias e 2 = créditos, pela ordem da lista", () => {
  const opcoes = tabelaOpcoes();
  assert.deepEqual(opcoes.map(({ numero }) => numero), ["1", "2"]);
  assert.deepEqual(opcoes.map(({ id }) => id), ["dias", "creditos"]);
  assert.equal(opcoes[0].comando, "tabela-dias");
  assert.equal(opcoes[1].comando, "tabela-creditos");
});

test("tabelaIdDoArgumento aceita número e nome, e recusa o resto", () => {
  assert.equal(tabelaIdDoArgumento("1"), "dias");
  assert.equal(tabelaIdDoArgumento("2"), "creditos");
  assert.equal(tabelaIdDoArgumento("dias"), "dias");
  assert.equal(tabelaIdDoArgumento("creditos"), "creditos");
  assert.equal(tabelaIdDoArgumento(" créditos "), "creditos");
  assert.equal(tabelaIdDoArgumento("3"), null);
  assert.equal(tabelaIdDoArgumento("0"), null);
  assert.equal(tabelaIdDoArgumento(""), null);
  assert.equal(tabelaIdDoArgumento("planos"), null);
});

test("getTabela devolve null para id desconhecido", () => {
  assert.equal(getTabela("dias")?.titulo, "Tabela de planos (dias)");
  assert.equal(getTabela("creditos")?.titulo, "Tabela de créditos");
  assert.equal(getTabela("inexistente"), null);
  assert.equal(getTabela(""), null);
});

test("TABELA_IDS é a ordem canónica e cobre todas as tabelas", () => {
  assert.deepEqual(TABELA_IDS, ["dias", "creditos"]);
  assert.deepEqual(Object.keys(TABELAS).sort(), [...TABELA_IDS].sort());
});

test("formatTabelaTexto alinha as colunas e inclui todas as linhas", () => {
  for (const id of TABELA_IDS) {
    const texto = formatTabelaTexto(id);
    const tabela = getTabela(id);
    const linhas = texto.split("\n");
    assert.equal(linhas.length, tabela.linhas.length + 1, id);
    for (const [indice, celulas] of tabela.linhas.entries()) {
      for (const celula of celulas) {
        assert.ok(linhas[indice + 1].includes(celula), `${id}: "${celula}" ausente`);
      }
    }
  }
  assert.equal(formatTabelaTexto("inexistente"), "");
});

test("buildTableRows marca só a primeira linha como cabeçalho", () => {
  const rows = buildTableRows([["A", "B"], ["1", "2"], ["3", "4"]]);
  assert.deepEqual(rows.map(({ isHeading }) => isHeading), [true, false, false]);
  assert.deepEqual(rows[0].items, ["A", "B"]);
  assert.deepEqual(rows[2].items, ["3", "4"]);
});
