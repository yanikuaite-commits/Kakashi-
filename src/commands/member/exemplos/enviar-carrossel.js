import { delay } from "baileys";
import { PREFIX } from "../../../config.js";
import { formatMessage, RODAPE } from "../../../utils/formatMessage.js";
import {
  numberedFallback,
  sendInteractiveWithFallback,
} from "../../../utils/interactive.js";

export default {
  name: "enviar-carrossel",
  description: "Exemplo de como enviar mensagens em formato carrossel (cards)",
  commands: ["enviar-carrossel"],
  usage: `${PREFIX}enviar-carrossel`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ socket, remoteJid, sendReply, sendReact }) => {
    await sendReact("🎠");

    await delay(2000);

    await sendReply(`Vou enviar um exemplo de mensagem em carrossel (cards)
  
⚠️ Atenção: não funciona no WhatsApp Business!`);

    await delay(3000);

    const cards = [
        {
          title: "🖼️ Card 1: Imagem de Exemplo",
          image: {
            url: "https://api.spiderx.com.br/storage/samples/sample-image.jpg",
          },
          caption: formatMessage({
            icone: "🖼️",
            titulo: "Card 1",
            campos: ["Esta é a primeira imagem do carrossel."],
          }),
        },
        {
          title: "📸 Card 2: Outra Imagem",
          image: {
            url: "https://api.spiderx.com.br/assets/images/logo.png",
          },
          caption: formatMessage({
            icone: "📸",
            titulo: "Card 2",
            campos: ["Segunda imagem com descrição diferente."],
          }),
        },
        {
          title: "🎭 Card 3: Terceira Opção",
          image: {
            url: "https://api.spiderx.com.br/storage/samples/sample-image.jpg",
          },
          caption: formatMessage({
            icone: "🎭",
            titulo: "Card 3",
            campos: ["Outro exemplo de card no carrossel."],
          }),
        },
    ];

    await sendInteractiveWithFallback({
      socket,
      chatId: remoteJid,
      content: {
        text: formatMessage({
          icone: "🎠",
          titulo: "Galeria de exemplos",
          campos: ["Desliza para ver os cards."],
          rodape: null,
        }),
        footer: RODAPE,
        cards,
        viewOnce: true,
      },
      fallbackText: numberedFallback(
        cards.map((card, index) => ({
          number: String(index + 1),
          title: card.title,
        })),
        "Este cliente não apresenta carrosséis; as descrições estão acima.",
      ),
      sendReply,
    });

    await delay(3000);

    await sendReply(`📋 *Como usar mensagens carrossel:*

\`\`\`
await socket.sendMessage(remoteJid, {
  text: 'Título principal',
  footer: 'Rodapé da mensagem',
  cards: [
    {
      title: 'Título do card',
      image: { url: 'URL da imagem' },
      caption: 'Descrição do card'
    }
  ],
  viewOnce: true
});
\`\`\`

💡 *Dicas:*
• Você pode adicionar quantos cards quiser
• \`viewOnce: true\` é obrigatório
• Cada card precisa de \`title\`, \`image\` e \`caption\`
⚠️ Importante: a baileys do Kakashi foi modificada para suportar mensagens em carrossel!`);
  },
};
