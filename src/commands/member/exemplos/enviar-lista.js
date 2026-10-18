import { delay } from "baileys";
import { PREFIX } from "../../../config.js";
import { formatMessage, RODAPE } from "../../../utils/formatMessage.js";
import {
  clearInteractiveMenu,
  createInteractiveActionId,
  numberedFallback,
  sendInteractiveWithFallback,
} from "../../../utils/interactive.js";

export default {
  name: "enviar-lista",
  description: "Exemplo de como enviar mensagens em formato de lista",
  commands: ["enviar-lista", "lista-exemplo", "enviar-list"],
  usage: `${PREFIX}enviar-lista`,
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
    await sendReact("📋");

    const triggerCommand = (parametro) =>
      `${prefix || PREFIX}exemplo-gatilho ${parametro}`;
    const ownerId =
      userLid || (remoteJid.endsWith("@g.us") ? "" : remoteJid);
    clearInteractiveMenu(remoteJid, ownerId);
    const listOptions = [
      { number: "1", label: "Imagem", target: triggerCommand("imagem") },
      { number: "2", label: "Vídeo", target: triggerCommand("video") },
      { number: "3", label: "Áudio", target: triggerCommand("audio") },
      { number: "4", label: "Botões", target: triggerCommand("botoes") },
      { number: "5", label: "Carrossel", target: triggerCommand("carrossel") },
    ].map((option) => ({ ...option, id: createInteractiveActionId() }));

    await delay(2000);

    await sendReply(`Vou enviar um exemplo de mensagem em lista
      
⚠️ Atenção: não funciona no WhatsApp Business!`);

    await delay(3000);

    await sendInteractiveWithFallback({
      socket,
      chatId: remoteJid,
      content: {
        text: formatMessage({
          icone: "📋",
          titulo: "Menu de exemplos",
          campos: ["Escolhe uma categoria para ver exemplos:"],
          rodape: null,
        }),
        title: "Menu de exemplos",
        footer: RODAPE,
        buttonText: "Abrir lista",
        sections: [
        {
          title: "Mídias",
          rows: [
            {
              title: "Imagem",
              description: "Exemplos de envio de imagens",
                rowId: listOptions[0].id,
            },
            {
              title: "Vídeo",
              description: "Exemplos de envio de vídeos",
                rowId: listOptions[1].id,
            },
            {
              title: "Áudio",
              description: "Exemplos de envio de áudios",
                rowId: listOptions[2].id,
            },
          ],
        },
        {
          title: "Interação",
          rows: [
            {
              title: "Botões",
              description: "Exemplos com botões",
                rowId: listOptions[3].id,
            },
            {
              title: "Carrossel",
              description: "Exemplos em formato de cards",
                rowId: listOptions[4].id,
            },
          ],
        },
        ],
        viewOnce: true,
      },
      fallbackText: numberedFallback(
        listOptions.map(({ number, label, target }) => ({
          number,
          title: `${label}: ${target}`,
        })),
      ),
      fallbackActions: listOptions.map(({ number, target }) => ({
        number,
        id: target,
      })),
      responseMappings: listOptions.map(({ id, target }) => ({ id, target })),
      ownerId,
      sendReply,
    });

    await delay(3000);

    await sendReply(`📋 *Como usar mensagens em lista:*

\`\`\`
await socket.sendMessage(remoteJid, {
  text: 'Descrição da lista',
  title: 'Título da lista',
  footer: 'Rodapé',
  buttonText: 'Abrir lista',
  viewOnce: true,
  sections: [
    {
      title: 'Seção',
      rows: [
        {
          title: 'Opção 1',
          description: 'Descrição da opção',
          rowId: '${prefix || PREFIX}exemplo-gatilho imagem'
        }
      ]
    }
  ]
});
\`\`\`

💡 *Dicas:*
• \`buttonText\` é obrigatório para abrir a lista
• \`sections\` cria uma lista usando native flow por padrão
• \`useLegacyList: true\` força o formato antigo \`listMessage\`
• Cada seção pode ter várias linhas
• Use \`rowId\` para identificar a opção escolhida
⚠️ Importante: a baileys do Kakashi foi modificada para suportar listas!`);
  },
};
