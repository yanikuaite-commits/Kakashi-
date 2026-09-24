import { BOT_NAME } from "./config.js";
import { getPrefix } from "./utils/database.js";
import { formatCommand } from "./utils/index.js";

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
    commands: [
      ["yt <termo>", "5 resultados com fotos"],
      ["play-audio <nome ou link>", "pesquisa ou link"],
      ["play-video <nome ou link>", "escolha a resolução"],
      ["baixar <link>", "vídeo de várias plataformas"],
      ["instagram <link>"], ["facebook <link>"],
      ["tik-tok <link>"], ["tik-tok-audio <link>"],
      ["xtwitter <link>"], ["pinterest <link>"],
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
      ["deepseek <pergunta>"], ["gemini <pergunta>"],
      ["gpt-5-mini <pergunta>"], ["flux <descrição>"],
      ["tts <texto> / <voz>", "ana, joao ou pedro"],
    ],
  },
  {
    key: "dono", label: "Dono", icon: "👑", aliases: ["cdono", "owner"],
    commands: [
      ["bot-on"], ["bot-off"], ["bot-status"],
      ["backup"], ["restore"], ["get-group-id"],
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
      return `├ ${prefix}${display}${hint ? ` — ${hint}` : ""}`;
    });
    return `╭━━━ ⚡ *${BOT_NAME}* ⚡\n┃ ${category.icon} *${category.label.toUpperCase()}*\n${category.intro ? `┃ ${category.intro}\n` : ""}┣━━━━━━━━━━━━━━━━━━\n${items.join("\n")}\n╰━━ Voltar: ${prefix}menu`;
  }

  const safeName = String(userName || "Você").replace(/[\r\n*_~`]/g, "").slice(0, 32);
  const categories = MENU_CATEGORIES.map(({ key: name, label, icon }) =>
    `├ *${prefix}menu ${name}* — ${icon} ${label}`);

  return `╭━━━ ⚡ *${BOT_NAME}* ⚡\n┃ MENU PRINCIPAL\n┣ 👤 Usuário: ${safeName}\n┣ 🟢 Status: Online\n┣ 📱 Chat: ${groupJid?.endsWith("@g.us") ? "Grupo" : "Privado"}\n┣━━━━━━━━━━━━━━━━━━\n┃ 📚 *CATEGORIAS*\n${categories.join("\n")}\n╰━━ Escolha: ${prefix}menu download`;
}
