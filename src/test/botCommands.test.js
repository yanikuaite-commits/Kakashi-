/**
 * Testes do catálogo de comandos que a IA pode executar.
 *
 * O foco é a segurança: o que a IA consegue despachar, o que nunca consegue e
 * como a frase do usuário se traduz num comando.
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  AI_FORBIDDEN_COMMANDS,
  AI_TOGGLE_COMMANDS,
  acaoDoTexto,
  aiCommandCatalogText,
  intencaoDoTexto,
  resolveAiAction,
  tokenizar,
} from "../services/botCommands.js";

describe("tokenizar", () => {
  it("remove acentos e pontuação", () => {
    assert.deepStrictEqual(tokenizar("Anti-Marcação Status!"), [
      "anti",
      "marcacao",
      "status",
    ]);
  });
});

describe("intencaoDoTexto", () => {
  it("reconhece ligar e desligar nas várias formas", () => {
    for (const texto of ["ativar anti-link", "liga o anti-link", "liga"]) {
      assert.strictEqual(intencaoDoTexto(texto), "on");
    }

    for (const texto of ["desativar anti-link", "desliga o anti-link", "off"]) {
      assert.strictEqual(intencaoDoTexto(texto), "off");
    }
  });

  it("não inventa intenção numa conversa", () => {
    assert.strictEqual(intencaoDoTexto("oi, tudo bem?"), null);
    assert.strictEqual(intencaoDoTexto("quanto é 2+2?"), null);
  });
});

describe("acaoDoTexto", () => {
  it("traduz o pedido do usuário no comando real", async () => {
    assert.deepStrictEqual(await acaoDoTexto("Kakashi, ativar anti status"), {
      command: "anti-status-grupo",
      intent: "on",
    });

    assert.deepStrictEqual(await acaoDoTexto("desliga o anti-video"), {
      command: "anti-video",
      intent: "off",
    });
  });

  it("aceita o alias que o menu mostra (bem-vindo)", async () => {
    assert.deepStrictEqual(await acaoDoTexto("ativar bem vindo"), {
      command: "welcome",
      intent: "on",
    });
  });

  it("não confunde anti status com anti link", async () => {
    const acao = await acaoDoTexto("ativar anti status");

    assert.strictEqual(acao.command, "anti-status-grupo");
  });

  it("abre e fecha o grupo sem palavra de ligar/desligar", async () => {
    assert.deepStrictEqual(await acaoDoTexto("abre o grupo"), {
      command: "abrir",
      intent: "on",
    });

    assert.deepStrictEqual(await acaoDoTexto("fecha o grupo"), {
      command: "fechar",
      intent: "off",
    });
  });

  it("não confunde 'abre o menu' com abrir o grupo", async () => {
    assert.strictEqual(await acaoDoTexto("abre o menu"), null);
    assert.strictEqual(await acaoDoTexto("abrir"), null);
  });

  it("devolve null quando não há pedido", async () => {
    assert.strictEqual(await acaoDoTexto("me conta uma piada"), null);
    assert.strictEqual(await acaoDoTexto("quanto é 2+2?"), null);
    assert.strictEqual(await acaoDoTexto("o que faz o anti-link?"), null);
  });
});

describe("resolveAiAction", () => {
  it("liga e desliga um interruptor com o valor certo", async () => {
    assert.deepStrictEqual(
      await resolveAiAction({ command: "anti-status-grupo", intent: "on" }),
      { ok: true, comando: "anti-status-grupo", tipo: "admin", args: "1" },
    );

    assert.deepStrictEqual(
      await resolveAiAction({ command: "anti-link", intent: "off" }),
      { ok: true, comando: "anti-link", tipo: "admin", args: "0" },
    );
  });

  it("assume ligar quando o modelo não manda intenção", async () => {
    const resolvido = await resolveAiAction({ command: "anti-link" });

    assert.strictEqual(resolvido.ok, true);
    assert.strictEqual(resolvido.args, "1");
  });

  it("aceita os alias reais do comando", async () => {
    const resolvido = await resolveAiAction({ command: "bemvindo", intent: "on" });

    assert.strictEqual(resolvido.ok, true);
    assert.strictEqual(resolvido.comando, "welcome");
    assert.strictEqual(resolvido.args, "1");
  });

  it("aceita o nome falado, sem hífen", async () => {
    const resolvido = await resolveAiAction({ command: "anti status", intent: "on" });

    assert.strictEqual(resolvido.ok, true);
    assert.strictEqual(resolvido.comando, "anti-status-grupo");
    assert.strictEqual(resolvido.args, "1");
  });

  it("prefere o nome exato à correspondência por tokens", async () => {
    const resolvido = await resolveAiAction({ command: "anti-link", intent: "on" });

    assert.strictEqual(resolvido.comando, "anti-link");
  });

  it("abre/fecha sem valor", async () => {
    assert.deepStrictEqual(await resolveAiAction({ command: "abrir" }), {
      ok: true,
      comando: "abrir",
      tipo: "admin",
      args: "",
    });
  });

  it("recusa um comando destrutivo mesmo que a IA o peça", async () => {
    for (const comando of AI_FORBIDDEN_COMMANDS) {
      const resolvido = await resolveAiAction({ command: comando, intent: "on" });
      assert.strictEqual(resolvido.ok, false, `${comando} não devia ser executável`);
    }
  });

  it("recusa comandos de membro e nomes inventados", async () => {
    for (const comando of ["anime", "play-video", "comando-inventado", ""]) {
      const resolvido = await resolveAiAction({ command: comando, intent: "on" });
      assert.strictEqual(resolvido.ok, false);
    }
  });
});

describe("catálogo mostrado à IA", () => {
  it("lista só interruptores de grupo e abrir/fechar", async () => {
    const catalogo = await aiCommandCatalogText();
    const nomes = catalogo.split("\n").map((linha) => linha.split(":")[0]);

    for (const nome of nomes) {
      assert.ok(
        AI_TOGGLE_COMMANDS.includes(nome) || ["abrir", "fechar"].includes(nome),
        `${nome} não devia estar no catálogo da IA`,
      );
    }
  });
});
