import fs from "node:fs";
import path from "node:path";

import { DATABASE_DIR, PREFIX } from "../../config.js";
import { clearState, getActiveDriver } from "../../services/remoteStore.js";
import { InvalidParameterError } from "../../errors/index.js";

/** Entradas que nunca são apagadas: guardam as credenciais do próprio destino. */
const PRESERVAR = ["config"];

/**
 * Apaga o estado do bot de forma consistente: remoto E disco.
 *
 * Por que os dois: o remoto é a fonte de verdade no arranque, mas o disco é
 * quem o alimenta quando o remoto está vazio. Apagar só o remoto faz o bot
 * reenviar tudo do disco no arranque seguinte; apagar só o disco deixa o remoto
 * a repor tudo. Sem tratar dos dois, "apagar" não apaga.
 *
 * O `config.json` é preservado nos dois lados: guarda os tokens do dono e as
 * credenciais do destino, e apagá-lo deixaria o bot sem se conseguir ligar.
 *
 * A sessão do WhatsApp (`assets/auth/baileys`) também é apagada quando pedido
 * com `sessao`, porque é o que obriga a re-parear o número.
 */
export default {
  name: "apagar-dados",
  description: "Apaga os dados do bot no Turso e no disco, de forma consistente.",
  commands: ["apagar-dados", "limpar-dados", "wipe"],
  usage: `${PREFIX}apagar-dados confirmar [sessao]`,
  handle: async ({ args, sendWaitReply, sendSuccessReply }) => {
    // Confirmação obrigatória: este comando não tem volta e é fácil de enviar
    // por engano (o prefixo `!` do modo texto torna-o num acidente à espera).
    if (args[0]?.toLowerCase() !== "confirmar") {
      throw new InvalidParameterError(
        "Este comando APAGA todos os dados (créditos, assinaturas, grupos, whitelist).\n\n" +
          `Se é mesmo isso que quer, envie: ${PREFIX}apagar-dados confirmar\n` +
          `Para apagar também a sessão do WhatsApp (obriga a re-parear): ${PREFIX}apagar-dados confirmar sessao`,
      );
    }

    const apagarSessao = args.some((arg) => arg.toLowerCase() === "sessao");

    await sendWaitReply("Apagando os dados do bot...");

    const resultados = [];

    // 1. Remoto. Sem destino configurado, salta.
    if (getActiveDriver()) {
      const apagadas = await clearState({ keep: PRESERVAR });

      resultados.push(`${apagadas} entrada(s) apagadas do destino remoto`);
    } else {
      resultados.push("sem destino remoto configurado");
    }

    // 2. Disco. É este passo que impede o remoto de ser reposto no arranque.
    let ficheirosApagados = 0;

    if (fs.existsSync(DATABASE_DIR)) {
      for (const entry of fs.readdirSync(DATABASE_DIR)) {
        if (!entry.endsWith(".json") || PRESERVAR.includes(entry.replace(/\.json$/, ""))) {
          continue;
        }

        fs.rmSync(path.join(DATABASE_DIR, entry), { force: true });
        ficheirosApagados += 1;
      }
    }

    resultados.push(`${ficheirosApagados} ficheiro(s) apagados do disco`);

    // 3. Sessão, só a pedido explícito.
    if (apagarSessao) {
      const { AUTH_DIR } = await import("../../config.js");

      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }

      resultados.push(
        "sessão do WhatsApp apagada (o bot vai pedir um novo pareamento)",
      );
    }

    await sendSuccessReply(
      `🗑️ Dados apagados:\n\n${resultados.map((linha) => `• ${linha}`).join("\n")}\n\n` +
        "O `config.json` foi preservado (guarda os tokens).\n" +
        "Reinicie o bot para ele arrancar limpo.",
    );
  },
};
