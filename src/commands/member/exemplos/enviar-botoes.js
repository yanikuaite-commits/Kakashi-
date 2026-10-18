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
  name: "enviar-botoes",
  description: "Exemplo de como enviar mensagens com botões",
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
    const simpleIds = [createInteractiveActionId(), createInteractiveActionId()];
    const quickReplyId = createInteractiveActionId();
    const legacyIds = [createInteractiveActionId(), createInteractiveActionId()];

    await delay(2000);

    await sendReply(`Vou enviar exemplos de mensagens com botões
      
⚠️ Atenção: não funciona no WhatsApp Business!`);

    await delay(3000);

    await sendInteractiveWithFallback({
      socket,
      chatId: remoteJid,
      content: {
        text: formatMessage({
          icone: "🔘",
          titulo: "Exemplo de botões",
          campos: ["Escolhe uma opção:"],
          rodape: null,
        }),
        footer: RODAPE,
        buttons: [
        {
          buttonId: simpleIds[0],
          buttonText: { displayText: "Opção 1" },
        },
        {
          buttonId: simpleIds[1],
          buttonText: { displayText: "Opção 2" },
        },
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
      responseMappings: [
        { id: simpleIds[0], target: triggerCommand("opcao1") },
        { id: simpleIds[1], target: triggerCommand("opcao2") },
      ],
      ownerId,
      sendReply,
    });

    await delay(3000);

    await sendInteractiveWithFallback({
      socket,
      chatId: remoteJid,
      content: {
        text: formatMessage({
          icone: "🧭",
          titulo: "Botões interativos",
          campos: ["Resposta rápida, link, chamada e cópia"],
          rodape: null,
        }),
        footer: RODAPE,
        interactiveButtons: [
        {
          name: "quick_reply",
          buttonParamsJson: JSON.stringify({
            display_text: "Resposta rápida",
            id: quickReplyId,
          }),
        },
        {
          name: "cta_url",
          buttonParamsJson: JSON.stringify({
            display_text: "Abrir site",
            url: "https://github.com/guiireal",
          }),
        },
        {
          name: "cta_call",
          buttonParamsJson: JSON.stringify({
            display_text: "Ligar",
            phone_number: "+5511999999999",
          }),
        },
        {
          name: "cta_copy",
          buttonParamsJson: JSON.stringify({
            display_text: "Copiar código",
            copy_code: "TAKESHI2026",
          }),
        },
        ],
        viewOnce: true,
      },
      fallbackText: numberedFallback([
        { number: "3", title: `Resposta rápida: envia ${triggerCommand("resposta-rapida")}` },
        { number: "4", title: "Abrir https://github.com/guiireal" },
        { number: "5", title: "Ligar para +5511999999999" },
        { number: "6", title: "Copiar o código TAKESHI2026" },
      ]),
      fallbackActions: [
        { number: "3", id: triggerCommand("resposta-rapida") },
        { number: "4", reply: "🔗 https://github.com/guiireal" },
        { number: "5", reply: "📞 Número: +5511999999999" },
        { number: "6", reply: "📋 Código: TAKESHI2026" },
      ],
      responseMappings: [
        { id: quickReplyId, target: triggerCommand("resposta-rapida") },
      ],
      ownerId,
      sendReply,
    });

    await delay(3000);

    await sendInteractiveWithFallback({
      socket,
      chatId: remoteJid,
      content: {
        text: formatMessage({
          icone: "🧩",
          titulo: "Botões legados",
          campos: ["Compatibilidade com buttonsMessage antigo"],
          rodape: null,
        }),
        footer: RODAPE,
        buttons: [
        {
          buttonId: legacyIds[0],
          buttonText: { displayText: "Legado 1" },
        },
        {
          buttonId: legacyIds[1],
          buttonText: { displayText: "Legado 2" },
        },
        ],
        useLegacyButtons: true,
      },
      fallbackText: numberedFallback([
        { number: "7", title: `Legado 1: envia ${triggerCommand("legado1")}` },
        { number: "8", title: `Legado 2: envia ${triggerCommand("legado2")}` },
      ]),
      fallbackActions: [
        { number: "7", id: triggerCommand("legado1") },
        { number: "8", id: triggerCommand("legado2") },
      ],
      responseMappings: [
        { id: legacyIds[0], target: triggerCommand("legado1") },
        { id: legacyIds[1], target: triggerCommand("legado2") },
      ],
      ownerId,
      sendReply,
    });

    await delay(3000);

    await sendReply(`📋 *Como usar mensagens com botões:*

\`\`\`
await socket.sendMessage(remoteJid, {
  text: 'Escolha uma opção',
  footer: 'Rodapé',
  interactiveButtons: [
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

💡 *Dicas:*
• \`buttons\` cria botões simples usando native flow por padrão
• \`useLegacyButtons: true\` força o formato antigo \`buttonsMessage\`
• \`interactiveButtons\` aceita \`quick_reply\`, \`cta_url\`, \`cta_call\`, \`cta_copy\`, \`single_select\`, entre outros
• \`templateButtons\` não é mais renderizado pelo WhatsApp em números comuns, use \`interactiveButtons\`
⚠️ Importante: a baileys do Kakashi foi modificada para suportar esses formatos!`);
  },
};
