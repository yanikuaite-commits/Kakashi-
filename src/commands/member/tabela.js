import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";
import { getPrefix } from "../../utils/database.js";
import { formatMessage, RODAPE } from "../../utils/formatMessage.js";
import {
  clearInteractiveMenu,
  createInteractiveActionId,
  numberedFallback,
  sendInteractiveWithFallback,
} from "../../utils/interactive.js";
import { sendTabela } from "../../utils/richTable.js";
import { tabelaIdDoArgumento, tabelaOpcoes } from "../../utils/tabelaPrecos.js";

export default {
  name: "tabela",
  description: "Mostra as tabelas de preços (planos por dias e pacotes de créditos)",
  commands: ["tabela", "tabelas", "precos"],
  usage: `${PREFIX}tabela [1|2]`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    socket,
    remoteJid,
    userLid,
    webMessage,
    fullArgs,
    sendReply,
    sendReact,
    prefix,
  }) => {
    const prefixo = prefix || getPrefix(remoteJid) || PREFIX;
    const argumento = String(fullArgs || "").trim();
    const escolhido = tabelaIdDoArgumento(argumento);

    // Atalho direto: ".tabela 1", ".tabela 2" (ou "dias"/"creditos") sem menu.
    if (escolhido) {
      await sendReact("📋");
      await sendTabela({
        socket,
        remoteJid,
        quoted: webMessage,
        sendReply,
        id: escolhido,
      });
      return;
    }

    if (argumento) {
      throw new InvalidParameterError(
        `Tabela "${argumento}" não existe. Usa *1* (planos por dias) ou *2* (pacotes de créditos).`,
      );
    }

    await sendReact("📋");

    const ownerId = userLid || (remoteJid.endsWith("@g.us") ? "" : remoteJid);
    clearInteractiveMenu(remoteJid, ownerId);

    const opcoes = tabelaOpcoes().map((opcao) => ({
      ...opcao,
      token: createInteractiveActionId(),
      target: `${prefixo}${opcao.comando}`,
    }));

    await sendInteractiveWithFallback({
      socket,
      chatId: remoteJid,
      content: {
        text: formatMessage({
          icone: "📋",
          titulo: "Tabelas de preços",
          campos: [
            "Escolhe a tabela que queres ver:",
            "",
            ...opcoes.map(({ numero, titulo, descricao }) => `${numero}. ${titulo} — ${descricao}`),
          ],
          rodape: null,
        }),
        title: "Tabelas de preços",
        footer: RODAPE,
        buttonText: "Ver tabelas",
        sections: [
          {
            title: "Tabelas",
            rows: opcoes.map(({ token, titulo, descricao }) => ({
              title: titulo,
              description: descricao,
              rowId: token,
            })),
          },
        ],
        viewOnce: true,
      },
      fallbackText: numberedFallback(
        opcoes.map(({ numero, titulo, target }) => ({ number: numero, title: `${titulo} (${target})` })),
      ),
      fallbackActions: opcoes.map(({ numero, target }) => ({ number: numero, id: target })),
      responseMappings: opcoes.map(({ token, target }) => ({ id: token, target })),
      ownerId,
      sendReply,
    });
  },
};
