import { DAILY_FREE_CREDITS } from "./config.js";
import { getPrefix } from "./utils/database.js";
import { formatMessage } from "./utils/formatMessage.js";
import { formatCommand } from "./utils/index.js";
import { numberedFallback } from "./utils/interactive.js";

export const MENU_CATEGORIES = [
  {
    key: "geral", label: "Geral", icon: "🌐", aliases: ["cgeral"],
    commands: [
      ["ping", "testar o bot"],
      ["suporte <pergunta>", "pedir ajuda"],
      ["exemplos-de-mensagens", "exemplos avançados"],
    ],
  },
  {
    key: "util", label: "Utilitários", icon: "🛠️", aliases: ["cutil", "utilitarios"],
    commands: [
      ["cep <número>", "consultar CEP"],
      ["gerar-link", "responda a uma imagem"],
      ["fake-chat @usuário / citação / resposta", "citação fictícia"],
    ],
  },
  {
    key: "texto", label: "Texto", icon: "🔤", aliases: ["ctexto"],
    commands: [
      ["attp <texto>", "figurinha animada"],
      ["ttp <texto>", "figurinha de texto"],
      ["brat <texto>", "figurinha Brat"],
      ["bratvid <texto>", "Brat em vídeo"],
    ],
  },
  {
    key: "info", label: "Informação", icon: "🌍", aliases: ["cinfo", "informacao"],
    commands: [["info", "sobre o bot"], ["perfil", "seu perfil"], ["meu-lid", "seu ID"]],
  },
  {
    key: "diversao", label: "Diversão", icon: "😁", aliases: ["cdiv", "brincadeiras"],
    commands: ["abracar", "beijar", "dado", "jantar", "lutar", "matar", "socar", "tapa"].map((name) => [name]),
  },
  {
    key: "imagem", label: "Imagem", icon: "🖼️", aliases: ["cimg", "canvas"],
    intro: "Responda a uma imagem para aplicar um efeito.",
    commands: ["removebg", "blur", "bolsonaro", "cadeia", "contraste", "espelhar", "gray", "inverter", "pixel", "rip"].map((name) => [name]),
  },
  {
    key: "midia", label: "Mídia", icon: "📲", aliases: ["cmidia", "media"],
    commands: [
      ["to-mp3", "responda a um vídeo"],
      ["togif", "responda a uma figurinha"],
      ["toimage", "responda a uma figurinha"],
      ["transcrever", "responda a um áudio"],
    ],
  },
  {
    key: "download", label: "Downloads", icon: "📥", aliases: ["cdownload", "downloads"],
    intro: "Cada download gasta créditos. Veja seu saldo em .conta.",
    commands: [
      ["yt <termo>", "5 resultados com fotos"],
      ["play-audio <nome ou link>", "pesquisa ou link"],
      ["play-video <nome ou link>", "escolha a qualidade"],
      ["baixar <link>", "vídeo de várias plataformas"],
      ["instagram <link>"], ["facebook <link>"],
      ["tik-tok <link>"], ["tik-tok-audio <link>"],
      ["xtwitter <link>"], ["pinterest <link>"],
    ],
  },
  {
    key: "anime", label: "Animes", icon: "🍿", aliases: ["canime", "animes"],
    intro: "Animes via providers vivos (animeunity, animepahe, ...). Baixa com yt-dlp.",
    commands: [
      ["anime <nome>", "escolha episódio e qualidade"],
    ],
  },
  {
    key: "protecao", label: "Proteção", icon: "🛡️", aliases: ["cprot", "seguranca"],
    intro: "Admin: use 1 para ativar e 0 para desativar.",
    commands: [
      "anti-audio", "anti-call", "anti-document", "anti-event", "anti-image", "anti-link",
      "anti-lottie-sticker", "anti-payment", "anti-product", "anti-status-grupo",
      "anti-sticker", "anti-video", "only-admin", "welcome", "exit", "auto-sticker",
    ].map((name) => [`${name} <1/0>`]),
  },
  {
    key: "admin", label: "Administração", icon: "👮", aliases: ["cadmin", "administracao"],
    commands: [
      ["abrir"], ["fechar"], ["ban", "responda ao membro"],
      ["promover"], ["rebaixar"], ["mute"], ["unmute"],
      ["warn"], ["unwarn"], ["revelar"],
      ["delete", "responda à mensagem"], ["limpar-chat"], ["link-grupo"],
      ["hide-tag <texto>"], ["saldo"], ["set-name <nome>"],
      ["afk <motivo>"], ["agendar-mensagem"],
      ["auto-responder <1/0>"], ["add-auto-responder"],
      ["delete-auto-responder"], ["list-auto-responder"],
    ],
  },
  {
    key: "sticker", label: "Stickers", icon: "🎨", aliases: ["cstick", "stickers"],
    commands: [
      ["sticker", "responda a imagem/vídeo"],
      ["rename <pacote> / <autor>", "responda à figurinha"],
      ["ia-sticker <descrição>", "gera figurinha"],
    ],
  },
  {
    key: "ia", label: "Inteligência artificial", icon: "🤖", aliases: ["cia"],
    commands: [
      ["kakashi <pergunta>", "IA do bot"],
      ["deepseek <pergunta>"], ["gemini <pergunta>"],
      ["gpt-5-mini <pergunta>"], ["flux <descrição>"],
      ["tts <texto> / <voz>", "ana, joao ou pedro"],
    ],
  },
  {
    key: "creditos", label: "Créditos", icon: "💳", aliases: ["ccred", "carteira"],
    intro: `Cada função gasta créditos. Você ganha ${DAILY_FREE_CREDITS} créditos grátis por dia, renovados às 00h (Moçambique).`,
    commands: [
      ["conta", "saldo de créditos e estatísticas"],
      ["conta custos", "tabela de custos por função"],
      ["pagamento", "números de e-mola e m-pesa"],
      ["tabela", "tabelas de preços (planos e créditos)"],
    ],
  },
  {
    key: "dono", label: "Dono", icon: "👑", aliases: ["cdono", "owner"],
    commands: [
      ["bot-on"], ["bot-off"], ["bot-status"],
      ["backup", "dados (a sessão só com backup sessao)"], ["restore"], ["get-group-id"],
      ["recarregar <créditos> @usuario", "adicionar créditos após pagamento"],
      ["block-command <nome>"], ["unblock-command <nome>"], ["blocked-commands"],
      ["private-whitelist <add|remove|list>"],
      ["set-menu-image", "responda a uma imagem"],
      ["set-prefix <símbolo>"], ["set-spider-api-token <token>"],
      ["on"], ["off"], ["exec <código>"],
    ],
  },
];

export function menuMessage(groupJid, section = "", userName = "Você") {
  const prefix = getPrefix(groupJid);
  const key = formatCommand(String(section).trim());
  const category = MENU_CATEGORIES.find(({ key: name, aliases }) =>
    key === name || aliases.includes(key));

  if (key && !category) return null;

  if (category) {
    const items = category.commands.map(([usage, hint]) => {
      const [name, ...parameters] = usage.split(" ");
      const display = [name.replaceAll("-", " "), ...parameters].join(" ");
      return `${prefix}${display}${hint ? ` — ${hint}` : ""}`;
    });

    const campos = [];
    if (category.intro) campos.push(category.intro, "");
    campos.push(...items, "", `💡 *Volta:* ${prefix}menu`);

    return formatMessage({ icone: category.icon, titulo: category.label, campos });
  }

  const safeName = String(userName || "Você").replace(/[\r\n*_~`]/g, "").slice(0, 32);
  const categories = MENU_CATEGORIES.map(({ key: name, label, icon }) =>
    `${prefix}menu ${name} — ${icon} ${label}`);

  return formatMessage({
    icone: "🌐",
    titulo: "Menu",
    campos: [
      `👤 *Usuário:* ${safeName}`,
      `🟢 *Status:* Online`,
      `📱 *Chat:* ${groupJid?.endsWith("@g.us") ? "Grupo" : "Privado"}`,
      "",
      `📚 *CATEGORIAS*`,
      ...categories,
      "",
      `💡 *Escolha:* ${prefix}menu download`,
    ],
  });
}

export function buildInteractiveMenuPayload(groupJid, section = "", userName = "Você") {
  const prefix = getPrefix(groupJid);
  const key = formatCommand(String(section).trim());
  const category = MENU_CATEGORIES.find(({ key: name, aliases }) =>
    key === name || aliases.includes(key));

  const rows = category
    ? category.commands.map(([usage, hint]) => {
        const [commandName, ...params] = String(usage).split(" ");
        const command = `${prefix}${[commandName, ...params].join(" ")}`.trim();
        return {
          title: commandName.replaceAll("-", " "),
          description: hint || "Abrir comando",
          rowId: command,
        };
      })
    : MENU_CATEGORIES.map(({ key: name, label, icon, intro }) => ({
        title: `${icon} ${label}`,
        description: intro || `Abrir ${label.toLowerCase()}`,
        rowId: `${prefix}menu ${name}`,
      }));

  if (!rows.length) return null;

  const fallbackOptions = rows.map(({ title, description }, index) => ({
    number: String(index + 1),
    title: `${title}${description ? ` — ${description}` : ""}`,
  }));

  const content = {
    text: category
      ? formatMessage({
          icone: category.icon,
          titulo: category.label,
          campos: [
            category.intro || `📚 Comandos da categoria ${category.label}`,
            "",
            ...rows.map(({ title, description }) => `• ${title}${description ? ` — ${description}` : ""}`),
            "",
            `💡 *Volta:* ${prefix}menu`,
          ],
        })
      : formatMessage({
          icone: "🌐",
          titulo: "Menu",
          campos: [
            `👤 *Usuário:* ${String(userName || "Você").replace(/[\r\n*_~`]/g, "").slice(0, 32)}`,
            "",
            `📚 *CATEGORIAS*`,
            ...rows.map(({ title }) => `• ${title}`),
            "",
            `💡 *Escolha:* ${prefix}menu download`,
          ],
        }),
    title: category ? category.label : "Menu principal",
    footer: "© Made by Yanik Uaite",
    buttonText: category ? "Abrir comando" : "Abrir categoria",
    sections: [{
      title: category ? category.label : "Categorias",
      rows: rows.map(({ title, description, rowId }) => ({ title, description, rowId })),
    }],
    viewOnce: true,
  };

  return {
    content,
    fallbackText: numberedFallback(fallbackOptions),
    responseMappings: rows.map(({ rowId }) => ({ id: rowId, target: rowId })),
    fallbackActions: fallbackOptions.map(({ number, title }) => {
      const row = rows[Number(number) - 1];
      return { number, id: row?.rowId ?? title };
    }),
  };
}
