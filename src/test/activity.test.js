/**
 * Testes para o serviço de atividade (estatísticas e auditoria do painel).
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_EVENTS,
  activityByHour,
  newUsersByDay,
  recentEvents,
  recordCommandUsage,
  recordEvent,
  recordEventThrottled,
  resetActivity,
  topCommands,
  topUsers,
} from "../services/activity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const activityPath = path.resolve(__dirname, "..", "..", "database", "activity.json");
let backup;

beforeEach(() => {
  backup = fs.existsSync(activityPath)
    ? fs.readFileSync(activityPath, "utf8")
    : undefined;
  fs.writeFileSync(activityPath, "{}");
  // O limiar de eventos vive em memória; sem o limpar, um teste "contamina" o
  // seguinte e o mesmo par chave/janela já pareceria registado.
  resetActivity();
});

afterEach(() => {
  if (backup !== undefined) fs.writeFileSync(activityPath, backup);
  else if (fs.existsSync(activityPath)) fs.unlinkSync(activityPath);
});

describe("recordCommandUsage", () => {
  it("conta execuções do mesmo comando", () => {
    recordCommandUsage({ comando: "play", usuario: "111@lid" });
    recordCommandUsage({ comando: "play", usuario: "111@lid" });

    const comandos = topCommands();
    assert.strictEqual(comandos[0].nome, "play");
    assert.strictEqual(comandos[0].count, 2);
  });

  it("guarda o nome do usuário na primeira vez e mantém-no depois", () => {
    recordCommandUsage({ comando: "menu", usuario: "111@lid", nome: "Yanik" });
    recordCommandUsage({ comando: "menu", usuario: "111@lid" });

    assert.strictEqual(topUsers()[0].name, "Yanik");
  });

  it("regista firstAt e não o altera em usos seguintes", () => {
    recordCommandUsage({ comando: "menu", usuario: "111@lid" });
    const firstAt = JSON.parse(fs.readFileSync(activityPath, "utf8")).users["111@lid"]
      .firstAt;

    recordCommandUsage({ comando: "menu", usuario: "111@lid" });
    const depois = JSON.parse(fs.readFileSync(activityPath, "utf8")).users["111@lid"]
      .firstAt;

    assert.strictEqual(depois, firstAt);
  });

  it("ordena os comandos do mais usado para o menos", () => {
    recordCommandUsage({ comando: "a" });
    recordCommandUsage({ comando: "b" });
    recordCommandUsage({ comando: "b" });
    recordCommandUsage({ comando: "b" });

    assert.deepStrictEqual(
      topCommands().map((c) => c.nome),
      ["b", "a"],
    );
  });
});

describe("recordEvent", () => {
  it("guarda o evento mais recente à frente", () => {
    recordEvent({ tipo: "painel", acao: "primeiro" });
    recordEvent({ tipo: "painel", acao: "segundo" });

    const eventos = recentEvents();
    assert.strictEqual(eventos[0].acao, "segundo");
    assert.strictEqual(eventos[1].acao, "primeiro");
  });

  it("limita o número de eventos guardados", () => {
    for (let i = 0; i < MAX_EVENTS + 25; i++) {
      recordEvent({ tipo: "teste", acao: `evento ${i}` });
    }

    assert.strictEqual(recentEvents(9999).length, MAX_EVENTS);
    // As mais recentes são as que ficam.
    assert.strictEqual(recentEvents(1)[0].acao, `evento ${MAX_EVENTS + 24}`);
  });

  it("filtra eventos por tipo", () => {
    recordEvent({ tipo: "erro", acao: "falhou" });
    recordEvent({ tipo: "blacklist", acao: "banido" });

    const erros = recentEvents(10, { tipo: "erro" });
    assert.strictEqual(erros.length, 1);
    assert.strictEqual(erros[0].acao, "falhou");
  });
});

describe("recordEventThrottled", () => {
  it("regista a primeira ocorrência e ignora as seguintes na mesma janela", () => {
    assert.strictEqual(
      recordEventThrottled({ chave: "banido:111@lid", tipo: "acesso-negado", acao: "x" }),
      true,
    );
    assert.strictEqual(
      recordEventThrottled({ chave: "banido:111@lid", tipo: "acesso-negado", acao: "x" }),
      false,
    );
    assert.strictEqual(recentEvents(9999).length, 1);
  });

  it("trata chaves diferentes de forma independente", () => {
    recordEventThrottled({ chave: "banido:111@lid", tipo: "acesso-negado", acao: "x" });
    recordEventThrottled({ chave: "banido:222@lid", tipo: "acesso-negado", acao: "x" });

    assert.strictEqual(recentEvents(9999).length, 2);
  });

  it("volta a registar depois de a janela passar", () => {
    recordEventThrottled({
      chave: "banido:111@lid",
      janelaMs: 0,
      tipo: "acesso-negado",
      acao: "x",
    });

    assert.strictEqual(
      recordEventThrottled({
        chave: "banido:111@lid",
        janelaMs: 0,
        tipo: "acesso-negado",
        acao: "x",
      }),
      true,
    );
  });
});

describe("activityByHour", () => {
  it("devolve sempre 24 horas completas", () => {
    const horas = activityByHour();
    assert.strictEqual(horas.length, 24);
    assert.deepStrictEqual(
      horas.map((h) => h.hora),
      Array.from({ length: 24 }, (_, i) => i),
    );
  });

  it("conta os eventos na hora certa", () => {
    recordEvent({ tipo: "teste", acao: "agora" });

    const horaAtual = new Date().getHours();
    assert.strictEqual(activityByHour()[horaAtual].count, 1);
  });
});

describe("newUsersByDay", () => {
  it("devolve um ponto por dia, terminando hoje", () => {
    const dias = newUsersByDay(7);
    assert.strictEqual(dias.length, 7);
    assert.strictEqual(dias[6].dia, new Date().toISOString().slice(0, 10));
  });

  it("conta um usuário novo no dia em que apareceu", () => {
    recordCommandUsage({ comando: "menu", usuario: "111@lid" });

    const dias = newUsersByDay(7);
    assert.strictEqual(dias[6].count, 1);
  });
});

describe("resetActivity", () => {
  it("limpa comandos, usuários e eventos", () => {
    recordCommandUsage({ comando: "menu", usuario: "111@lid" });
    recordEvent({ tipo: "teste", acao: "x" });

    resetActivity();

    assert.deepStrictEqual(topCommands(), []);
    assert.deepStrictEqual(topUsers(), []);
    assert.deepStrictEqual(recentEvents(), []);
  });
});
