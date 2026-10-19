import { delay } from "baileys";
import { PREFIX } from "../../../config.js";
import { formatMessage, RODAPE } from "../../../utils/formatMessage.js";
import {
  clearInteractiveMenu,
  createInteractiveActionId,
  numberedFallback,
  sendInteractiveWithFallback,
  singleSelectList,
  urlButton,
} from "../../../utils/interactive.js";

export default {
  name: "enviar-botoes",
  description: "Exemplo de como enviar listas e mensagens com botões",
  commands: ["enviar-botoes", "enviar-botao", "botoes-exemplo"],
  usage: `${PREFIX}enviar-botoes`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({
    socket,
    remoteJid,
    sendReply,
    sendReact,
    prefix,
    userLid,
  }) => {
    await sendReact("🔘");

    const triggerCommand = (parametro) =>
      `${prefix || PREFIX}exemplo-gatilho ${parametro}`;
    const ownerId =
      userLid || (remoteJid.endsWith("@g.us") ? "" : remoteJid);
    clearInteractiveMenu(remoteJid, ownerId);

    await delay(2000);

    await sendReply(`Vou enviar exemplos de listas e botões

⚠️ Atenção: só lista (single_select) e cta_url FUNCIONAM!
❌ quick_reply, buttonsMessage e templateButtons são descartados
   em silêncio pelo WhatsApp — NUNCA os usares.`);

    await delay(3000);

    await sendInteractiveWithFallback({
      socket,
      chatId: remoteJid,
      content: {
        text: formatMessage({
          icone: "🧭",
          titulo: "Card com lista + Canal",
          campos: ["Único formato de card que renderiza nesta base"],
          rodape: null,
        }),
        footer: RODAPE,
        interactiveButtons: [
          {
            name: "single_select",
            buttonParamsJson: JSON.stringify({
              title: "Abrir lista",
              sections: [
                {
                  title: "Exemplos",
                  rows: [
                    {
                      id: createInteractiveActionId(),
                      title: "Opção 1",
                      description: `Envia ${triggerCommand("opcao1")}`,
                    },
                    {
                      id: createInteractiveActionId(),
                      title: "Opção 2",
                      description: `Envia ${triggerCommand("opcao2")}`,
                    },
                  ],
                },
              ],
            }),
          },
          urlButton("📢 Canal", "https://www.youtube.com/@devgui_?sub_confirmation=1"),
        ],
        viewOnce: true,
      },
      fallbackText: numberedFallback([
        { number: "1", title: `Opção 1: envia ${triggerCommand("opcao1")}` },
        { number: "2", title: `Opção 2: envia ${triggerCommand("opcao2")}` },
      ]),
      fallbackActions: [
        { number: "1", id: triggerCommand("opcao1") },
        { number: "2", id: triggerCommand("opcao2") },
      ],
      ownerId,
      sendReply,
    });

    await delay(3000);

    await sendInteractiveWithFallback({
      socket,
      chatId: remoteJid,
      // Lista clássica (listMessage), alternativa ao card nativeFlow.
      content: singleSelectList({
        text: formatMessage({
          icone: "📋",
          titulo: "Lista clássica",
          campos: ["Também renderiza em todos os clientes"],
          rodape: null,
        }),
        title: "Lista clássica",
        footer: RODAPE,
        buttonText: "Abrir opções",
        sections: [
          {
            title: "Exemplos",
            rows: [
              {
                title: "Opção 3",
                description: `Envia ${triggerCommand("opcao3")}`,
                rowId: triggerCommand("opcao3"),
              },
              {
                title: "Opção 4",
                description: `Envia ${triggerCommand("opcao4")}`,
                rowId: triggerCommand("opcao4"),
              },
            ],
          },
        ],
      }),
      fallbackText: numberedFallback([
        { number: "1", title: `Opção 3: envia ${triggerCommand("opcao3")}` },
        { number: "2", title: `Opção 4: envia ${triggerCommand("opcao4")}` },
      ]),
      fallbackActions: [
        { number: "1", id: triggerCommand("opcao3") },
        { number: "2", id: triggerCommand("opcao4") },
      ],
      ownerId,
      sendReply,
    });

    await delay(3000);

    await sendReply(`📋 *Como enviar mensagens interativas:*

\`\`\`
await socket.sendMessage(remoteJid, {
  text: 'Escolha uma opção',
  footer: 'Rodapé',
  interactiveButtons: [
    {
      name: 'single_select',
      buttonParamsJson: JSON.stringify({
        title: 'Abrir lista',
        sections: [{ title: 'Opções', rows: [{ id: 'id-1', title: 'Opção 1' }] }]
      })
    },
    {
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({
        display_text: 'Abrir site',
        url: 'https://github.com/guiireal'
      })
    }
  ],
  viewOnce: true
});
\`\`\`

💡 *Funcionam nesta base:*
• \`interactiveButtons\` com \`single_select\` (card com lista) e \`cta_url\`
• Lista clássica \`listMessage\` (\`title\`, \`sections\`, \`buttonText\`)

⚠️ *NUNCA usar:*
• \`quick_reply\`, \`buttonsMessage\`/\`buttons\` e \`templateButtons\` — são descartados em silêncio pelo WhatsApp!`);
  },
};
