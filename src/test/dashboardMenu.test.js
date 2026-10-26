/**
 * Testes para o menu e visuais do painel.
 *
 * @author Dev Gui
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  PANEL_TABS,
  barra,
  barraDeEstado,
  buildPanelMenu,
  sparkline,
} from "../utils/dashboardMenu.js";

describe("PANEL_TABS", () => {
  it("cada aba tem ícone, título e um comando de destino", () => {
    assert.ok(PANEL_TABS.length >= 10);

    for (const aba of PANEL_TABS) {
      assert.ok(aba.id, "id ausente");
      assert.ok(aba.icone, `aba ${aba.id} sem ícone`);
      assert.ok(aba.titulo, `aba ${aba.id} sem título`);
      assert.match(aba.target, /^\./, `aba ${aba.id} sem prefixo`);
    }
  });

  it("não repete ids nem destinos", () => {
    assert.strictEqual(new Set(PANEL_TABS.map((a) => a.id)).size, PANEL_TABS.length);
    assert.strictEqual(new Set(PANEL_TABS.map((a) => a.target)).size, PANEL_TABS.length);
  });
});

describe("buildPanelMenu", () => {
  it("gera uma linha por aba, com ids únicos e não repetidos", () => {
    const menu = buildPanelMenu({ texto: "corpo" });
    const rows = menu.content.sections[0].rows;

    assert.strictEqual(rows.length, PANEL_TABS.length);
    assert.strictEqual(new Set(rows.map((r) => r.rowId)).size, PANEL_TABS.length);
  });

  it("mapeia cada id para o comando da aba e cada número para o mesmo comando", () => {
    const menu = buildPanelMenu({ texto: "corpo" });

    assert.strictEqual(menu.responseMappings.length, PANEL_TABS.length);
    assert.strictEqual(menu.fallbackActions.length, PANEL_TABS.length);

    menu.responseMappings.forEach((mapping, i) => {
      assert.strictEqual(mapping.target, PANEL_TABS[i].target);
    });

    menu.fallbackActions.forEach((action, i) => {
      assert.strictEqual(action.number, String(i + 1));
      assert.strictEqual(action.id, PANEL_TABS[i].target);
    });
  });

  it("o fallback em texto lista todas as abas por número", () => {
    const menu = buildPanelMenu({ texto: "corpo" });

    for (let i = 1; i <= PANEL_TABS.length; i++) {
      assert.ok(menu.fallbackText.includes(`${i}. `), `falta a opção ${i}`);
    }
  });

  it("usa um token curto no rowId, nunca um comando/URL cru (o WhatsApp descarta listas grandes)", () => {
    const menu = buildPanelMenu({ texto: "corpo" });

    for (const row of menu.content.sections[0].rows) {
      assert.match(row.rowId, /^kmenu:[0-9a-f-]+$/);
      assert.ok(!row.rowId.includes(" "), `rowId com espaços: ${row.rowId}`);
    }
  });
});

describe("sparkline", () => {
  it("devolve uma string vazia sem números", () => {
    assert.strictEqual(sparkline([]), "");
    assert.strictEqual(sparkline([null, null]), "");
  });

  it("marca a série completa com blocos do alfabeto", () => {
    const linha = sparkline([0, 1, 2, 3, 4, 5, 6, 7]);
    assert.strictEqual(linha.length, 8);
    assert.strictEqual(linha[0], "▁");
    assert.strictEqual(linha[7], "█");
  });

  it("não rebenta com uma série constante", () => {
    const linha = sparkline([50, 50, 50]);
    assert.strictEqual(linha.length, 3);
    assert.ok(linha.split("").every((c) => c === linha[0]));
  });

  it("usa · para os buracos da série", () => {
    assert.ok(sparkline([1, null, 3]).includes("·"));
  });
});

describe("barra", () => {
  it("enche proporcionalmente ao máximo", () => {
    assert.strictEqual(barra(10, 10, 10), "██████████");
    assert.strictEqual(barra(0, 10, 10), "░░░░░░░░░░");
    assert.strictEqual(barra(5, 10, 10), "█████░░░░░");
  });

  it("nunca passa da largura pedida", () => {
    assert.strictEqual(barra(999, 10, 6).length, 6);
  });

  it("devolve vazia quando o máximo é zero", () => {
    assert.strictEqual(barra(5, 0, 4), "░░░░");
  });
});

describe("barraDeEstado", () => {
  it("mostra a hora, o sinal e a bateria", () => {
    const linha = barraDeEstado({
      ramPct: 20,
      cpuPct: 10,
      agora: new Date("2026-10-22T15:37:00"),
    });

    assert.ok(linha.includes("🕒"));
    assert.ok(linha.includes("📶"));
    assert.ok(linha.includes("🔋"));
  });

  it("assinala bateria fraca quando a RAM está quase cheia", () => {
    const linha = barraDeEstado({ ramPct: 90, cpuPct: 10 });
    assert.ok(linha.includes("🪫"));
  });

  it("mostra n/d sem métricas em vez de inventar números", () => {
    const linha = barraDeEstado({});
    assert.ok(linha.includes("n/d"));
  });
});
