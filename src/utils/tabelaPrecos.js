/**
 * Tabelas de preços do bot.
 *
 * Duas tabelas, ambas mostradas pelo comando `tabela` através de uma lista
 * interativa (1 = planos por dias, 2 = pacotes de créditos):
 *
 * - `dias`: planos de acesso pagos em meticais (MT).
 * - `creditos`: pacotes de créditos pagos em meticais (MT).
 *
 * Este módulo é só dados e formatação: não fala com o WhatsApp nem com o
 * Baileys, para poder ser testado isoladamente. O envio fica em
 * `src/utils/richTable.js`.
 */

/** Tabela 1 — planos de acesso por dias. */
const DIAS = {
  id: "dias",
  titulo: "Tabela de planos (dias)",
  cabecalho: ["Dias", "Preço"],
  linhas: [
    ["7 dias", "20 MT"],
    ["14 dias", "45 MT"],
    ["20 dias", "60 MT"],
    ["30 dias", "90 MT"],
    ["60 dias", "140 MT"],
  ],
  valores: [
    { dias: 7, mt: 20 },
    { dias: 14, mt: 45 },
    { dias: 20, mt: 60 },
    { dias: 30, mt: 90 },
    { dias: 60, mt: 140 },
  ],
  comando: "tabela-dias",
  resumo: "7, 14, 20, 30 e 60 dias",
};

/** Tabela 2 — pacotes de créditos. */
const CREDITOS = {
  id: "creditos",
  titulo: "Tabela de créditos",
  cabecalho: ["Preço", "Créditos"],
  linhas: [
    ["5 MT", "15 créditos"],
    ["10 MT", "30 créditos"],
    ["20 MT", "55 créditos"],
    ["30 MT", "85 créditos"],
    ["50 MT", "120 créditos"],
  ],
  valores: [
    { mt: 5, creditos: 15 },
    { mt: 10, creditos: 30 },
    { mt: 20, creditos: 55 },
    { mt: 30, creditos: 85 },
    { mt: 50, creditos: 120 },
  ],
  comando: "tabela-creditos",
  resumo: "5, 10, 20, 30 e 50 MT",
};

export const TABELAS = { dias: DIAS, creditos: CREDITOS };

/** Ids na ordem em que a lista interativa os apresenta (1 = dias, 2 = créditos). */
export const TABELA_IDS = ["dias", "creditos"];

/**
 * Tabela pelo id.
 *
 * @param {string} id "dias" | "creditos"
 * @returns {{id: string, titulo: string, cabecalho: string[], linhas: string[][], comando: string, resumo: string}|null}
 */
export function getTabela(id) {
  return TABELAS[String(id || "").trim().toLowerCase()] || null;
}

/**
 * Opções da lista interativa, na ordem de apresentação.
 *
 * @returns {Array<{numero: string, id: string, titulo: string, descricao: string, comando: string}>}
 */
export function tabelaOpcoes() {
  return TABELA_IDS.map((id, index) => {
    const tabela = TABELAS[id];
    return {
      numero: String(index + 1),
      id,
      titulo: `Tabela ${index + 1} — ${tabela.titulo.replace("Tabela de ", "")}`,
      descricao: tabela.resumo,
      comando: tabela.comando,
    };
  });
}

/**
 * Converte "1", "2", "dias" ou "creditos" no id da tabela.
 *
 * @param {string} valor
 * @returns {string|null}
 */
export function tabelaIdDoArgumento(valor) {
  const bruto = String(valor || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!bruto) return null;

  const numero = Number(bruto);
  if (Number.isInteger(numero) && numero >= 1 && numero <= TABELA_IDS.length) {
    return TABELA_IDS[numero - 1];
  }

  return getTabela(bruto)?.id || null;
}

/**
 * Tabela em texto alinhado, para o fallback quando o rich response não passa.
 *
 * @param {string} id
 * @returns {string}
 */
export function formatTabelaTexto(id) {
  const tabela = getTabela(id);
  if (!tabela) return "";

  const colunas = [tabela.cabecalho, ...tabela.linhas];
  const larguras = tabela.cabecalho.map((_, coluna) =>
    Math.max(...colunas.map((linha) => String(linha[coluna] ?? "").length)));

  return colunas
    .map((linha) =>
      linha
        .map((celula, coluna) =>
          coluna === linha.length - 1
            ? String(celula ?? "")
            : String(celula ?? "").padEnd(larguras[coluna]))
        .join("   ")
        .trimEnd())
    .join("\n");
}
