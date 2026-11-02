/**
 * Registo do fluxo guiado (menu em 4 passos).
 *
 * Este ficheiro é a ÚNICA fonte de verdade das funções guiadas:
 *
 *   { id, categoria, titulo, icone, descricao, guia, aceita, comando, exemplo, validador, args, opcoes } *
 * - `aceita`: "link" | "texto" | "midia" | "nenhum"
 *   - link   → a próxima mensagem tem de ser um link (e passar no `validador`)
 *   - texto  → qualquer texto com 2+ caracteres (aceita também links)
 *   - midia  → imagem, vídeo, áudio ou figurinha
 *   - nenhum → a função executa no toque (botão ▶️ Executar)
 * - `comando`: comando REAL do projeto (o fluxo reutiliza o handler dele;
 *   nenhuma lógica de download/IA é duplicada).
 * - `validador`: opcional, recebe o texto e devolve boolean.
 * - `args`: opcional, argumentos fixos (ex.: `conta custos`).
 * - `entrada`: opcional, como a mensagem de erro nomeia o que se espera (ex.:
 *   `um LID`). Sem isto, uma função validada por `validador` mas de tipo
 *   `texto` diria "um texto válido" mesmo quando recusou por não ser um LID.
 * - `opcoes`: opcional, `{ tipo: "video" }` ou `{ tipo: "audio" }`. Funções com
 *   este campo NÃO executam direto: guardam o link na sessão e enviam a lista
 *   de qualidade/formato (videoFormatMenu / audioFormatMenu); o download só
 *   acontece depois da escolha.
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
 * @author Dev Yanik
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
  anime: "🍿 Animes (HiAnime): escolha o episódio e a qualidade para baixar.",
  protecao: "🛡️ Admin: anti-link, anti-porn e outras travas do grupo.",
  admin: "👮 Administração do grupo: ban, mute, avisos e limpeza.",
  sticker: "🎨 Figurinhas: cria, renomeia e gera com IA.",
  ia: "🤖 Inteligência artificial para perguntas, imagens e voz.",
  creditos: "💳 Saldo, custos e histórico dos seus créditos.",
  dono: "👑 Dono do bot: estado, backup e configuração.",
  dev: "🧑‍💻 Exemplos de envio de mensagens para quem desenvolve comandos.",
};

/** Categorias restritas: "admin" (admin do grupo ou dono) e "owner". */
const RESTRITAS = {
  protecao: "admin",
  admin: "admin",
  dono: "owner",
  dev: "owner",
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
 * Valida um LID/telefone enviado pelo dono.
 *
 * Aceita as formas que o WhatsApp publica para a mesma pessoa — o LID do
 * `.meu-lid` (`275381038891241@lid`), o mesmo com sufixo de aparelho
 * (`275381038891241:12@lid`), o número puro ou o número com `+` e espaços. O
 * critério é a contagem de dígitos, não a forma: rejeitar uma variante que o
 * comando normalizaria faria o menu recusar um LID válido.
 */
const ehLid = (valor) => {
  const digitos = String(valor || "")
    .split("@")[0]
    .split(":")[0]
    .replace(/\D/g, "");

  return digitos.length >= 8 && digitos.length <= 20;
};

/**
 * Valida uma marcação (`@número`) enviada pelo admin.
 *
 * Exige o `@` e pelo menos 8 dígitos: sem o `@` os comandos de moderação
 * (`ban`, `warn`, `promover`, ...) recusam, por isso o menu recusa primeiro e
 * explica o formato em vez de deixar o comando falhar a seguir.
 */
const ehMencao = (valor) => {
  const texto = String(valor || "").trim();
  if (!texto.startsWith("@")) return false;
  const digitos = texto.replace(/\D/g, "");
  return digitos.length >= 8 && digitos.length <= 20;
};

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
    // TEM QUE TER MENU DE QUALIDADE (360p...1080p): depois do link o fluxo
    // guarda o vídeo e manda a lista de qualidade (videoFormatMenu).
    opcoes: { tipo: "video" },
  }),
  entry("download", "youtube-audio", "play-audio", {
    titulo: "YouTube Áudio",
    icone: "🎧",
    descricao:
      "Baixa a música do YouTube; depois escolhes áudio, nota de voz ou documento.",
    guia: "Envie o link ou o nome da música.",
    aceita: "texto",
    exemplo: "https://youtu.be/...",
    // TEM QUE TER MENU DE FORMATO (áudio/nota de voz/documento):
    // o download só acontece depois da escolha (audioFormatMenu).
    opcoes: { tipo: "audio" },
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

  /* ═══════════ ANIMES ═══════════ */
  entry("anime", "anime", "anime", {
    titulo: "Animes (HiAnime)",
    icone: "🍿",
    descricao: "Pesquisa no HiAnime e baixa o episódio na qualidade escolhida.",
    guia: "Envie o nome do anime (ex: Naruto).",
    aceita: "texto",
    exemplo: "Naruto",
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
    ["backup", "Backup", "Cria um backup dos dados (a sessão só com .backup sessao)."],
    ["restore", "Restaurar", "Restaura os dados do GitHub (a sessão só com .restore sessao)."],
    ["delete-backup", "Apagar backup", "Apaga o arquivo de backup do GitHub."],
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
  entry("dono", "private-whitelist", "private-whitelist", {
    titulo: "Whitelist privada",
    icone: "👑",
    descricao: "Autoriza alguém a usar o bot no privado.",
    // Só pede o LID: a ação "add" vai fixa, para o dono não ter de escrever
    // `add`. O fluxo guiado despacha `.private-whitelist add <lid>`.
    guia: "Envie o LID da pessoa (ex: 275381038891241@lid).",
    aceita: "texto",
    args: "add",
    validador: ehLid,
    entrada: "um LID",
    exemplo: "275381038891241@lid",
  }),

  /* ═══════════ CINEMA ═══════════ */
  entry("cinema", "megacine", "megacine", {
    titulo: "Séries & Doramas",
    icone: "📺",
    descricao: "Baixa séries, doramas e animes episódicos do Megacine.",
    guia: "Envie o nome da série (ex: Duna A Profecia).",
    aceita: "texto",
    exemplo: "Duna A Profecia",
  }),

  /* ═══════════ CRÉDITOS (pagamento e tabelas) ═══════════ */
  entry("creditos", "pagamento", "pagamento", {
    titulo: "Como pagar",
    icone: "💳",
    descricao: "Mostra os números de e-mola e m-pesa para recarregar.",
    guia: "Não precisa enviar nada.",
    aceita: "nenhum",
    exemplo: "",
  }),
  ...[
    ["tabela", "Tabelas de preços", "Mostra as duas tabelas (planos e pacotes)."],
    ["tabela-dias", "Planos por dias", "Mostra a tabela de planos por dias."],
    ["tabela-creditos", "Pacotes de créditos", "Mostra a tabela de pacotes de créditos."],
    ["help", "Ajuda", "Ajuda sobre comandos e sobre os créditos."],
  ].map(([comando, titulo, descricao]) =>
    entry("creditos", comando, comando, {
      titulo,
      icone: "🧾",
      descricao,
      guia: "Não precisa enviar nada.",
      aceita: "nenhum",
      exemplo: "",
    }),
  ),

  /* ═══════════ ADMINISTRAÇÃO (membros) ═══════════ */
  ...[
    ["ban", "Remover membro", "Remove o membro marcado do grupo."],
    ["promover", "Promover a admin", "Torna o membro marcado administrador."],
    ["rebaixar", "Rebaixar admin", "Volta o administrador a membro comum."],
    ["mute", "Silenciar membro", "Silencia o membro (as mensagens dele são apagadas)."],
    ["unmute", "Reativar membro", "Desativa o mute do membro."],
    ["warn", "Advertir membro", "Aplica uma advertência ao membro."],
    ["unwarn", "Perdoar advertência", "Remove ou lista advertências válidas."],
    ["warn-reactivate", "Reativar advertência", "Reativa uma advertência inválida."],
  ].map(([comando, titulo, descricao]) =>
    entry("admin", comando, comando, {
      titulo,
      icone: "👮",
      descricao,
      guia: "Marque o membro com @ (ex: @5511999999999).",
      aceita: "texto",
      exemplo: "@5511999999999",
      validador: ehMencao,
      entrada: "uma marcação com @",
    }),
  ),
  entry("admin", "revelar", "revelar", {
    titulo: "Revelar mídia",
    icone: "👁️",
    descricao: "Revela uma imagem ou vídeo de visualização única.",
    guia: "Envie a imagem ou o vídeo de visualização única.",
    aceita: "midia",
    exemplo: "imagem/vídeo",
  }),
  entry("admin", "delete", "delete", {
    titulo: "Apagar mensagem",
    icone: "🗑️",
    descricao: "Apaga a mensagem à qual respondes.",
    guia: "Responda à mensagem que queres apagar.",
    aceita: "nenhum",
    exemplo: "",
  }),
  ...[
    ["auto-responder", "Auto-responder", "Ativa (1) ou desativa (0) o auto-responder."],
    ["add-auto-responder", "Adicionar resposta", "Envie: termo / resposta."],
    ["delete-auto-responder", "Remover resposta", "Envie o ID do termo (ver a lista)."],
    ["list-auto-responder", "Listar respostas", "Lista os termos do auto-responder."],
    ["block-wpp", "Bloquear número", "Bloqueia um número no WhatsApp do bot."],
  ].map(([comando, titulo, descricao]) =>
    entry("admin", comando, comando, {
      titulo,
      icone: "👮",
      descricao,
      guia: "Envie o valor pedido.",
      aceita: comando === "list-auto-responder" ? "nenhum" : "texto",
      exemplo: comando === "add-auto-responder" ? "bom dia / Bom dia!" : "",
    }),
  ),

  /* ═══════════ DONO (painel, pagamentos, configuração) ═══════════ */
  entry("dono", "painel", "painel", {
    titulo: "Painel de administração",
    icone: "📊",
    descricao: "Abre o painel com as abas de gestão do bot.",
    guia: "Não precisa enviar nada.",
    aceita: "nenhum",
    exemplo: "",
  }),
  ...[
    ["painel-sistema", "Painel · Sistema", "RAM, CPU, disco e estado geral."],
    ["painel-graficos", "Painel · Gráficos", "Gráficos de RAM/CPU das últimas 24h."],
    ["painel-banco", "Painel · Banco de dados", "Tamanho e integridade dos dados."],
    ["painel-logs", "Painel · Logs", "Últimos registos do bot."],
    ["painel-usuarios", "Painel · Usuários", "Utilizadores conhecidos e atividade."],
    ["painel-blacklist", "Painel · Blacklist", "Utilizadores banidos do bot."],
    ["painel-whitelist", "Painel · Whitelist", "Autorizados a usar no privado."],
    ["painel-backup", "Painel · Backup", "Estado dos backups."],
    ["painel-config", "Painel · Configurações", "Configuração atual do bot."],
    ["painel-limpar-cache", "Painel · Limpar cache", "Repõe a atividade e as amostras do painel."],
  ].map(([comando, titulo, descricao]) =>
    entry("dono", comando, comando, {
      titulo,
      icone: "📊",
      descricao,
      guia: "Não precisa enviar nada.",
      aceita: "nenhum",
      exemplo: "",
    }),
  ),
  entry("dono", "set-menu-image", "set-menu-image", {
    titulo: "Imagem do menu",
    icone: "🖼️",
    descricao: "Altera a imagem do cabeçalho do menu.",
    guia: "Envie a nova imagem do menu.",
    aceita: "midia",
    exemplo: "imagem",
  }),
  entry("dono", "recarga-confirmar", "recarga-confirmar", {
    titulo: "Confirmar pagamento",
    icone: "✅",
    descricao: "Confirma um pagamento e adiciona os créditos.",
    guia: "Envie o ID da transação (e, se quiseres, os créditos).",
    aceita: "texto",
    exemplo: "MP250101.1234",
  }),
  entry("dono", "recarga-recusar", "recarga-recusar", {
    titulo: "Recusar pagamento",
    icone: "❌",
    descricao: "Recusa um pagamento e cancela a transação.",
    guia: "Envie o ID da transação.",
    aceita: "texto",
    exemplo: "MP250101.1234",
  }),
  entry("dono", "recargas-pendentes", "recargas-pendentes", {
    titulo: "Pagamentos pendentes",
    icone: "🧾",
    descricao: "Lista os pagamentos à espera de confirmação.",
    guia: "Não precisa enviar nada.",
    aceita: "nenhum",
    exemplo: "",
  }),
  ...[
    ["remover-creditos", "Remover créditos", "Envie: créditos @usuario (ou 'tudo')."],
    ["banir", "Banir do bot", "Envie: lid [1h|1d|7d|30d] [motivo]."],
    ["set-prefix", "Mudar prefixo", "Envie o novo símbolo de prefixo."],
    ["set-github-token", "Chave do GitHub", "Envie a chave do backup (ou 'remover')."],
    ["set-spider-api-token", "Chave do Spider X", "Envie a chave da API do Spider (ou 'remover')."],
    ["set-groq-api-token", "Chave da Groq", "Envie a chave da IA, transcrição e suporte."],
    ["set-gemini-api-token", "Chave do Gemini", "Envie a chave da geração de imagem."],
    ["set-linker-api-token", "Chave do Linker", "Envie a chave do gerar-link."],
    ["set-hf-token", "Chave da Hugging Face", "Envie a chave da Hugging Face."],
    ["block-command", "Bloquear comando", "Envie o nome do comando a bloquear."],
    ["unblock-command", "Desbloquear comando", "Envie o nome do comando a desbloquear."],
    ["exec", "Executar no terminal", "Envie o comando de terminal a executar."],
    ["apagar-dados", "Apagar dados", "Envie 'confirmar' para apagar TODOS os dados."],
  ].map(([comando, titulo, descricao]) =>
    entry("dono", comando, comando, {
      titulo,
      icone: "👑",
      descricao,
      guia: descricao,
      aceita: "texto",
      exemplo: "",
    }),
  ),
  entry("dono", "api-keys", "api-keys", {
    titulo: "Chaves de API",
    icone: "🔐",
    descricao: "Mostra o estado de todas as chaves e como configurar cada uma.",
    guia: "Não precisa enviar nada: o card já traz o estado e os comandos.",
    aceita: "nenhum",
    exemplo: "",
  }),
  ...[
    ["on", "Ligar no grupo", "Ativa o bot neste grupo."],
    ["off", "Desligar no grupo", "Desativa o bot neste grupo."],
    ["blocked-commands", "Comandos bloqueados", "Lista os comandos bloqueados."],
    ["testing", "Teste", "Comando de testes do dono."],
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

  /* ═══════════ DESENVOLVEDOR (exemplos de envio) ═══════════ */
  ...[
    ["enviar-texto", "Enviar texto", "Mensagem de texto simples e com menções."],
    ["enviar-botoes", "Enviar botões", "Listas e mensagens com botões."],
    ["enviar-lista", "Enviar lista", "Mensagem em formato de lista."],
    ["enviar-carrossel", "Enviar carrossel", "Mensagem em cards (carrossel)."],
    ["enviar-enquete", "Enviar enquete", "Enquetes/votações em grupos."],
    ["enviar-reacoes", "Enviar reações", "Diferentes tipos de reação (emojis)."],
    ["enviar-resposta", "Enviar respostas", "Respostas de sucesso, erro, aviso e espera."],
    ["enviar-codigo", "Enviar código", "Código com formatação do WhatsApp."],
    ["enviar-latex", "Enviar LaTeX", "Fórmula LaTeX em Rich Response."],
    ["enviar-tabela", "Enviar tabela", "Tabela em Rich Response."],
    ["enviar-reels", "Enviar reels", "Reels em Rich Response."],
    ["enviar-localizacao", "Enviar localização", "Mensagem de localização."],
    ["enviar-contato", "Enviar contato", "Cartão de contato."],
    ["enviar-mensagem-editada", "Mensagem editada", "Enviar e editar uma mensagem."],
    ["enviar-imagem-de-url", "Imagem por URL", "Imagem a partir de um link."],
    ["enviar-video-de-url", "Vídeo por URL", "Vídeo a partir de um link."],
    ["enviar-audio-de-url", "Áudio por URL", "Áudio a partir de um link."],
    ["enviar-gif-de-url", "GIF por URL", "GIF a partir de um link."],
    ["enviar-sticker-de-url", "Sticker por URL", "Sticker a partir de um link."],
    ["enviar-documento-de-url", "Documento por URL", "Documento a partir de um link."],
    ["enviar-imagem-de-arquivo", "Imagem por ficheiro", "Imagem a partir de um ficheiro local."],
    ["enviar-video-de-arquivo", "Vídeo por ficheiro", "Vídeo a partir de um ficheiro local."],
    ["enviar-audio-de-arquivo", "Áudio por ficheiro", "Áudio a partir de um ficheiro local."],
    ["enviar-gif-de-arquivo", "GIF por ficheiro", "GIF a partir de um ficheiro local."],
    ["enviar-sticker-de-arquivo", "Sticker por ficheiro", "Sticker a partir de um ficheiro local."],
    ["enviar-documento-de-arquivo", "Documento por ficheiro", "Documento a partir de um ficheiro local."],
    ["enviar-imagem-de-buffer", "Imagem por buffer", "Imagem a partir de um buffer."],
    ["enviar-video-de-buffer", "Vídeo por buffer", "Vídeo a partir de um buffer."],
    ["enviar-audio-de-buffer", "Áudio por buffer", "Áudio a partir de um buffer."],
    ["enviar-gif-de-buffer", "GIF por buffer", "GIF a partir de um buffer."],
    ["enviar-sticker-de-buffer", "Sticker por buffer", "Sticker a partir de um buffer."],
    ["enviar-documento-de-buffer", "Documento por buffer", "Documento a partir de um buffer."],
    ["funcoes-grupo", "Funções de grupo", "Funções utilitárias de grupo."],
    ["obter-dados-grupo", "Dados do grupo", "Informações detalhadas do grupo."],
    ["raw-message", "Mensagem bruta", "Dados brutos da mensagem."],
    ["exemplos-de-mensagens", "Lista de exemplos", "Lista todos os exemplos disponíveis."],
  ].map(([comando, titulo, descricao]) =>
    entry("dev", comando, comando, {
      titulo,
      icone: "🧑‍💻",
      descricao,
      guia: "Não precisa enviar nada.",
      aceita: "nenhum",
      exemplo: "",
    }),
  ),
  ...[
    ["enviar-texto-colorido", "Texto colorido", "Texto colorido em Rich Response."],
  ].map(([comando, titulo, descricao]) =>
    entry("dev", comando, comando, {
      titulo,
      icone: "🧑‍💻",
      descricao,
      guia: "Envie o texto a colorir.",
      aceita: "texto",
      exemplo: "Olá mundo",
    }),
  ),
  entry("dev", "exemplo-gatilho", "exemplo-gatilho", {
    titulo: "Botão que acionou",
    icone: "🧑‍💻",
    descricao: "Mostra qual botão ou item de lista acionou o comando.",
    guia: "Envie qualquer texto para ver o gatilho.",
    aceita: "texto",
    exemplo: "teste",
  }),
  entry("dev", "obter-metadados-mensagem", "obter-metadados-mensagem", {
    titulo: "Metadados da mensagem",
    icone: "🧑‍💻",
    descricao: "Informações detalhadas da mensagem atual ou citada.",
    guia: "Envie a mensagem a analisar.",
    aceita: "texto",
    exemplo: "olá",
  }),
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
