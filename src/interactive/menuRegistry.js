/**
 * Registo do fluxo guiado (menu em 4 passos).
 *
 * Este ficheiro é a ÚNICA fonte de verdade das funções guiadas:
 *
 *   { id, categoria, titulo, icone, descricao, guia, aceita, comando, exemplo, validador, args }
 *
 * - `aceita`: "link" | "texto" | "midia" | "nenhum"
 *   - link   → a próxima mensagem tem de ser um link (e passar no `validador`)
 *   - texto  → qualquer texto com 2+ caracteres (aceita também links)
 *   - midia  → imagem, vídeo, áudio ou figurinha
 *   - nenhum → a função executa no toque (botão ▶️ Executar)
 * - `comando`: comando REAL do projeto (o fluxo reutiliza o handler dele;
 *   nenhuma lógica de download/IA é duplicada).
 * - `validador`: opcional, recebe o texto e devolve boolean.
 * - `args`: opcional, argumentos fixos (ex.: `conta custos`).
 *
 * Para ADICIONAR uma função nova basta acrescentar uma entrada aqui:
 *
 *   entry("download", "kwai", "kwai", {
 *     titulo: "Kwai",
 *     icone: "🎬",
 *     descricao: "Baixa vídeos do Kwai.",
 *     guia: "Envie o link do vídeo do Kwai.",
 *     aceita: "link",
 *     exemplo: "https://kwai.com/...",
 *     validador: (valor) => /kwai\.com/i.test(valor),
 *   })
 *
 * As categorias vêm de `MENU_CATEGORIES` (src/menu.js), para o fluxo guiado e
 * o catálogo de texto nunca divergirem; aqui ficam só a descrição curta e a
 * restrição de permissão.
 *
 * @author Dev Gui
 */
import { MENU_CATEGORIES } from "../menu.js";

/** Mini descrição de cada categoria (obrigatória para todas). */
const DESCRICOES = {
  geral: "🌐 Estado do bot, suporte e exemplos avançados de mensagens.",
  util: "🛠️ Utilidades rápidas: CEP, links e citações fictícias.",
  texto: "🔤 Figurinhas de texto: animadas, estáticas e Brat.",
  info: "🌍 Informações do bot, do seu perfil e do seu ID.",
  diversao: "😁 Brincadeiras e interações divertidas com membros.",
  imagem: "🖼️ Efeitos em imagem: responda a uma foto com o comando.",
  midia: "📲 Converte mídia: áudio, GIF, imagem e transcrição.",
  download: "📥 Baixe vídeos e músicas das redes sociais, sem marca d'água quando possível.",
  protecao: "🛡️ Admin: anti-link, anti-porn e outras travas do grupo.",
  admin: "👮 Administração do grupo: ban, mute, avisos e limpeza.",
  sticker: "🎨 Figurinhas: cria, renomeia e gera com IA.",
  ia: "🤖 Inteligência artificial para perguntas, imagens e voz.",
  creditos: "💳 Saldo, custos e histórico dos seus créditos.",
  dono: "👑 Dono do bot: estado, backup e configuração.",
};

/** Categorias restritas: "admin" (admin do grupo ou dono) e "owner". */
const RESTRITAS = {
  protecao: "admin",
  admin: "admin",
  dono: "owner",
};

export const CATEGORIES = MENU_CATEGORIES.map(
  ({ key, label, icon, aliases = [] }) => ({
    id: key,
    titulo: label,
    icone: icon,
    aliases,
    descricao: DESCRICOES[key] || "Funções do bot.",
    restrita: RESTRITAS[key] || null,
  }),
);

function entry(categoria, id, comando, data) {
  return { categoria, id, comando, ...data };
}

const ehLinkDo = (padrao) => (valor) => padrao.test(String(valor || ""));

/**
 * Funções guiadas. A ordem aqui é a ordem apresentada nas listas.
 */
export const FUNCTIONS = [
  /* ═══════════ DOWNLOAD ═══════════ */
  entry("download", "tiktok", "tik-tok", {
    titulo: "TikTok",
    icone: "🎵",
    descricao: "Baixa o vídeo do TikTok, sem marca d'água quando possível.",
    guia: "Envie o link do vídeo do TikTok.",
    aceita: "link",
    exemplo: "https://vm.tiktok.com/ZM...",
    validador: ehLinkDo(/(?:tiktok\.com|vt\.tiktok|vm\.tiktok)/i),
  }),
  entry("download", "instagram", "instagram", {
    titulo: "Instagram",
    icone: "📸",
    descricao: "Baixa posts, reels, stories e fotos do Instagram.",
    guia: "Envie o link do post, reel ou story.",
    aceita: "link",
    exemplo: "https://www.instagram.com/reel/...",
    validador: ehLinkDo(/instagram\.com|instagr\.am/i),
  }),
  entry("download", "youtube-video", "play-video", {
    titulo: "YouTube Vídeo",
    icone: "▶️",
    descricao: "Baixa o vídeo do YouTube na qualidade que escolheres.",
    guia: "Envie o link ou o nome do vídeo.",
    aceita: "texto",
    exemplo: "https://youtu.be/...",
  }),
  entry("download", "youtube-audio", "play-audio", {
    titulo: "YouTube Áudio",
    icone: "🎧",
    descricao:
      "Baixa a música do YouTube; depois escolhes áudio, nota de voz ou documento.",
    guia: "Envie o link ou o nome da música.",
    aceita: "texto",
    exemplo: "https://youtu.be/...",
  }),
  entry("download", "facebook", "facebook", {
    titulo: "Facebook",
    icone: "📘",
    descricao: "Baixa vídeos e reels do Facebook.",
    guia: "Envie o link do vídeo.",
    aceita: "link",
    exemplo: "https://www.facebook.com/watch/?v=...",
    validador: ehLinkDo(/facebook\.com|fb\.watch|fb\.com/i),
  }),
  entry("download", "tiktok-audio", "tik-tok-audio", {
    titulo: "TikTok Áudio",
    icone: "🎶",
    descricao: "Extrai só o áudio de um vídeo do TikTok.",
    guia: "Envie o link do vídeo do TikTok.",
    aceita: "link",
    exemplo: "https://vm.tiktok.com/ZM...",
    validador: ehLinkDo(/(?:tiktok\.com|vt\.tiktok|vm\.tiktok)/i),
  }),
  entry("download", "pinterest", "pinterest", {
    titulo: "Pinterest",
    icone: "📌",
    descricao: "Baixa o vídeo ou imagem de um pin.",
    guia: "Envie o link do pin.",
    aceita: "link",
    exemplo: "https://pin.it/...",
    validador: ehLinkDo(/pinterest\.|pin\.it/i),
  }),
  entry("download", "xtwitter", "xtwitter", {
    titulo: "X / Twitter",
    icone: "🐦",
    descricao: "Baixa vídeos e GIFs de posts do X (Twitter).",
    guia: "Envie o link do post.",
    aceita: "link",
    exemplo: "https://x.com/usuario/status/...",
    validador: ehLinkDo(/(?:twitter\.com|x\.com|t\.co)/i),
  }),
  entry("download", "baixar", "baixar", {
    titulo: "Baixar",
    icone: "⬇️",
    descricao: "Baixa vídeo de várias plataformas suportadas.",
    guia: "Envie o link do vídeo.",
    aceita: "link",
    exemplo: "https://...",
  }),
  entry("download", "yt", "yt", {
    titulo: "Pesquisar no YouTube",
    icone: "🔎",
    descricao: "Pesquisa no YouTube e mostra 5 resultados com foto.",
    guia: "Envie o termo de pesquisa.",
    aceita: "texto",
    exemplo: "MC Hariel",
  }),

  /* ═══════════ TEXTO ═══════════ */
  ...[
    ["attp", "Attp", "🔠", "Figurinha animada com o texto enviado."],
    ["ttp", "Ttp", "🔤", "Figurinha estática com o texto enviado."],
    ["brat", "Brat", "🟩", "Figurinha no estilo Brat."],
    ["bratvid", "Brat vídeo", "🎞️", "Brat em vídeo."],
  ].map(([comando, titulo, icone, descricao]) =>
    entry("texto", comando, comando, {
      titulo,
      icone,
      descricao,
      guia: "Envie o texto que deve aparecer na figurinha.",
      aceita: "texto",
      exemplo: "Olá mundo",
    }),
  ),

  /* ═══════════ STICKERS ═══════════ */
  entry("sticker", "sticker", "sticker", {
    titulo: "Criar figurinha",
    icone: "🎨",
    descricao: "Transforma imagem, vídeo ou GIF em figurinha.",
    guia: "Envie (ou responda a) uma imagem, vídeo ou GIF.",
    aceita: "midia",
    exemplo: "imagem/vídeo",
  }),
  entry("sticker", "rename", "rename", {
    titulo: "Renomear figurinha",
    icone: "✏️",
    descricao: "Renomeia o pacote e o autor de uma figurinha.",
    guia: "Responda a uma figurinha com: pacote / autor.",
    aceita: "texto",
    exemplo: "Meu pacote / Meu nome",
  }),
  entry("sticker", "ia-sticker", "ia-sticker", {
    titulo: "Figurinha com IA",
    icone: "🤖",
    descricao: "Gera uma figurinha a partir de uma descrição.",
    guia: "Envie a descrição da figurinha.",
    aceita: "texto",
    exemplo: "gato astronauta",
  }),

  /* ═══════════ IMAGEM ═══════════ */
  ...[
    ["removebg", "Remover fundo"],
    ["blur", "Desfocar"],
    ["bolsonaro", "Efeito Bolsonaro"],
    ["cadeia", "Efeito cadeia"],
    ["contraste", "Contraste"],
    ["espelhar", "Espelhar"],
    ["gray", "Preto e branco"],
    ["inverter", "Inverter cores"],
    ["pixel", "Pixelar"],
    ["rip", "Efeito RIP"],
  ].map(([comando, titulo]) =>
    entry("imagem", comando, comando, {
      titulo,
      icone: "🖼️",
      descricao: `Aplica o efeito "${titulo}" na imagem.`,
      guia: "Envie (ou responda a) uma imagem.",
      aceita: "midia",
      exemplo: "imagem",
    }),
  ),

  /* ═══════════ MÍDIA ═══════════ */
  ...[
    ["to-mp3", "Vídeo para MP3", "Responda a um vídeo para extrair o áudio."],
    ["togif", "Figurinha para GIF", "Responda a uma figurinha animada."],
    ["toimage", "Figurinha para imagem", "Responda a uma figurinha."],
    ["transcrever", "Transcrever áudio", "Responda a um áudio ou nota de voz."],
  ].map(([comando, titulo, descricao]) =>
    entry("midia", comando, comando, {
      titulo,
      icone: "📲",
      descricao,
      guia: "Envie ou responda à mídia indicada.",
      aceita: "midia",
      exemplo: "mídia",
    }),
  ),

  /* ═══════════ IA ═══════════ */
  ...[
    ["kakashi", "Kakashi IA", "🤖"],
    ["gemini", "Gemini", "✨"],
    ["deepseek", "DeepSeek", "🧠"],
    ["gpt-5-mini", "GPT-5 Mini", "💬"],
    ["flux", "Flux (imagem)", "🎨"],
    ["tts", "Texto para voz", "🔊"],
  ].map(([comando, titulo, icone]) =>
    entry("ia", comando, comando, {
      titulo,
      icone,
      descricao: `Usa ${titulo} para responder ao teu pedido.`,
      guia:
        comando === "tts"
          ? "Envie o texto e, se quiseres, a voz: ana, joao ou pedro."
          : comando === "flux"
            ? "Envie a descrição da imagem que queres gerar."
            : "Envie a tua pergunta.",
      aceita: "texto",
      exemplo: comando === "tts" ? "Olá, tudo bem? / ana" : "O que é um buraco negro?",
    }),
  ),

  /* ═══════════ UTILITÁRIOS ═══════════ */
  entry("util", "cep", "cep", {
    titulo: "Consultar CEP",
    icone: "📮",
    descricao: "Consulta um CEP e devolve o endereço.",
    guia: "Envie o número do CEP (8 dígitos).",
    aceita: "texto",
    exemplo: "01001000",
    validador: (valor) => /\d{5}-?\d{3}/.test(valor),
  }),
  entry("util", "gerar-link", "gerar-link", {
    titulo: "Gerar link",
    icone: "🔗",
    descricao: "Gera um link a partir de uma imagem.",
    guia: "Responda a uma imagem.",
    aceita: "midia",
    exemplo: "imagem",
  }),
  entry("util", "fake-chat", "fake-chat", {
    titulo: "Citação fictícia",
    icone: "💬",
    descricao: "Cria uma citação fictícia para brincar.",
    guia: "Envie: @usuário / citação / resposta.",
    aceita: "texto",
    exemplo: "@fulano / Oi / Olá!",
  }),

  /* ═══════════ GERAL / INFO / DIVERSÃO / CRÉDITOS ═══════════ */
  entry("geral", "ping", "ping", {
    titulo: "Ping",
    icone: "🏓",
    descricao: "Testa a latência do bot.",
    guia: "Não precisa enviar nada.",
    aceita: "nenhum",
    exemplo: "",
  }),
  entry("geral", "suporte", "suporte", {
    titulo: "Suporte",
    icone: "🆘",
    descricao: "Pede ajuda à IA de suporte do bot.",
    guia: "Envie a tua dúvida.",
    aceita: "texto",
    exemplo: "Como uso o play audio?",
  }),
  entry("info", "info", "info", {
    titulo: "Info do bot",
    icone: "🌍",
    descricao: "Mostra informações e versão do bot.",
    guia: "Não precisa enviar nada.",
    aceita: "nenhum",
    exemplo: "",
  }),
  entry("info", "perfil", "perfil", {
    titulo: "Meu perfil",
    icone: "👤",
    descricao: "Mostra o teu perfil no bot.",
    guia: "Não precisa enviar nada.",
    aceita: "nenhum",
    exemplo: "",
  }),
  entry("info", "meu-lid", "meu-lid", {
    titulo: "Meu ID",
    icone: "🪪",
    descricao: "Mostra o teu LID/ID no WhatsApp.",
    guia: "Não precisa enviar nada.",
    aceita: "nenhum",
    exemplo: "",
  }),
  ...[
    ["abracar", "Abraçar"],
    ["beijar", "Beijar"],
    ["dado", "Dado"],
    ["jantar", "Jantar"],
    ["lutar", "Lutar"],
    ["matar", "Matar"],
    ["socar", "Socar"],
    ["tapa", "Tapa"],
  ].map(([comando, titulo]) =>
    entry("diversao", comando, comando, {
      titulo,
      icone: "😁",
      descricao: `Interação divertida: ${titulo.toLowerCase()}.`,
      guia: "Não precisa enviar nada.",
      aceita: "nenhum",
      exemplo: "",
    }),
  ),
  entry("creditos", "conta", "conta", {
    titulo: "Meu saldo",
    icone: "💳",
    descricao: "Mostra saldo e estatísticas dos teus créditos.",
    guia: "Não precisa enviar nada.",
    aceita: "nenhum",
    exemplo: "",
  }),
  entry("creditos", "conta-custos", "conta", {
    titulo: "Tabela de custos",
    icone: "📊",
    descricao: "Mostra quanto custa cada função.",
    guia: "Não precisa enviar nada.",
    aceita: "nenhum",
    args: "custos",
    exemplo: "",
  }),

  /* ═══════════ PROTEÇÃO (admin) ═══════════ */
  ...[
    "anti-audio",
    "anti-call",
    "anti-document",
    "anti-event",
    "anti-image",
    "anti-link",
    "anti-lottie-sticker",
    "anti-payment",
    "anti-product",
    "anti-status-grupo",
    "anti-sticker",
    "anti-video",
    "only-admin",
    "welcome",
    "exit",
    "auto-sticker",
  ].map((comando) =>
    entry("protecao", comando, comando, {
      titulo: comando.replaceAll("-", " "),
      icone: "🛡️",
      descricao: `Ativa (1) ou desativa (0) ${comando.replaceAll("-", " ")}.`,
      guia: "Envie 1 para ativar ou 0 para desativar.",
      aceita: "texto",
      exemplo: "1",
      validador: (valor) => /^[01]$/.test(String(valor).trim()),
    }),
  ),

  /* ═══════════ ADMINISTRAÇÃO (admin) ═══════════ */
  ...[
    ["abrir", "Abrir grupo", "Abre o grupo para todos."],
    ["fechar", "Fechar grupo", "Fecha o grupo (só admins falam)."],
    ["link-grupo", "Link do grupo", "Envia o link de convite do grupo."],
    ["saldo", "Saldo do grupo", "Mostra o saldo de créditos do grupo."],
    ["limpar-chat", "Limpar chat", "Limpa as mensagens do bot no chat."],
  ].map(([comando, titulo, descricao]) =>
    entry("admin", comando, comando, {
      titulo,
      icone: "👮",
      descricao,
      guia: "Não precisa enviar nada.",
      aceita: "nenhum",
      exemplo: "",
    }),
  ),
  ...[
    ["afk", "AFK", "Envie o motivo (ou nada para ausência simples)."],
    ["set-name", "Nome do grupo", "Envie o novo nome do grupo."],
    ["hide-tag", "Marcar todos", "Envie o texto da marcação."],
    ["agendar-mensagem", "Agendar mensagem", "Envie: minutos | mensagem."],
  ].map(([comando, titulo, guia]) =>
    entry("admin", comando, comando, {
      titulo,
      icone: "👮",
      descricao: `${titulo} no grupo.`,
      guia,
      aceita: "texto",
      exemplo: "",
    }),
  ),

  /* ═══════════ DONO ═══════════ */
  ...[
    ["bot-on", "Ligar bot", "Liga o bot para os usuários."],
    ["bot-off", "Desligar bot", "Desliga o bot para os usuários."],
    ["bot-status", "Estado do bot", "Mostra se o bot está ligado."],
    ["backup", "Backup", "Cria um backup dos dados."],
    ["get-group-id", "ID do grupo", "Mostra o ID do chat atual."],
    ["blocked-commands", "Comandos bloqueados", "Lista os comandos bloqueados."],
  ].map(([comando, titulo, descricao]) =>
    entry("dono", comando, comando, {
      titulo,
      icone: "👑",
      descricao,
      guia: "Não precisa enviar nada.",
      aceita: "nenhum",
      exemplo: "",
    }),
  ),
  ...[
    ["block-command", "Bloquear comando", "Envie o nome do comando a bloquear."],
    ["unblock-command", "Desbloquear comando", "Envie o nome do comando a desbloquear."],
    ["set-prefix", "Mudar prefixo", "Envie o novo símbolo de prefixo."],
    ["recarregar", "Adicionar créditos", "Envie: créditos @usuario."],
    [
      "private-whitelist",
      "Whitelist privada",
      "Envie: add|remove|list [jid].",
    ],
  ].map(([comando, titulo, guia]) =>
    entry("dono", comando, comando, {
      titulo,
      icone: "👑",
      descricao: `${titulo} (só o dono do bot).`,
      guia,
      aceita: "texto",
      exemplo: "",
    }),
  ),
];

/** Permissões normalizadas. */
function podeVer(categoria, { isOwner = false, isAdmin = false } = {}) {
  if (!categoria.restrita) return true;
  if (categoria.restrita === "owner") return isOwner;
  return isOwner || isAdmin;
}

export function canAccess(categoria, permissions = {}) {
  return podeVer(categoria, permissions);
}

export function listCategories(permissions = {}) {
  return CATEGORIES.filter((categoria) => podeVer(categoria, permissions));
}

export function resolveCategory(value, permissions = {}) {
  const chave = String(value || "").trim().toLowerCase();
  if (!chave) return null;

  const categoria = CATEGORIES.find(
    (item) => item.id === chave || item.aliases.includes(chave),
  );

  if (!categoria || !podeVer(categoria, permissions)) return null;
  return categoria;
}

export function getCategory(id) {
  return CATEGORIES.find((categoria) => categoria.id === id) || null;
}

export function listFunctions(categoryId) {
  return FUNCTIONS.filter((funcao) => funcao.categoria === categoryId);
}

export function getFunction(categoryId, functionId) {
  return (
    FUNCTIONS.find(
      (funcao) =>
        funcao.categoria === categoryId && funcao.id === functionId,
    ) || null
  );
}
