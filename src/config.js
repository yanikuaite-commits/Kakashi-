import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefixo padrão dos comandos.
export const PREFIX = ".";

// Emoji do bot (mude se preferir).
export const BOT_EMOJI = "🤖";

// Nome do bot (mude se preferir).
export const BOT_NAME = "Kakashi Bot";

// Tema visual das mensagens do bot.
// "plain" (padrão): envia só o conteúdo — sem cabeçalho cósmico, sem caixa e
// sem o rodapé "✦ Constelado por Yanik Uaite ✦".
// "galaxy": o tema completo (☄️ · ✦ · ˚ ✧ · ☾ + caixa + rodapé).
// Qualquer outro valor cai em "plain", para um engano não reativar a decoração.
export const MESSAGE_THEME =
  String(process.env.MESSAGE_THEME || "plain").trim().toLowerCase() === "galaxy"
    ? "galaxy"
    : "plain";

// Atalho booleano, para o formatMessage não repetir a comparação.
export const PLAIN_MESSAGE_THEME = MESSAGE_THEME === "plain";

// Assinatura gravada nos metadados das figurinhas (o "publisher" que o WhatsApp
// mostra ao ver o pacote). Aparece por baixo do nome de quem criou a figurinha.
export const STICKER_PACK_PUBLISHER =
  process.env.STICKER_PACK_PUBLISHER ||
  "⋆｡°✩ Feito por Dev Yanik ✩°｡⋆";

// LID do bot (no caso, o que você rodará o bot).
// Para obter o LID do bot, use o comando <prefixo>lid respondendo em cima de uma mensagem do número do bot
// Troque o <prefixo> pelo prefixo do bot (ex: /lid).
export const BOT_LID = "12345678901234567890@lid";

// LID do dono do bot (no caso, o seu!).
// Para obter o LID do dono do bot, use o comando <prefixo>meu-lid
// Troque o <prefixo> pelo prefixo do bot (ex: /meu-lid).
export const OWNER_LID = "275381038891241@lid";

// ==========================================================================
// DONO NO PRIVADO
// ==========================================================================
// true = o dono usa todos os comandos do bot na conversa privada (membro,
// admin e dono), mesmo com o bot desativado, sem estar na lista de privados
// e sem gastar créditos. false = no privado vale só o que vale para membros.
export const OWNER_PRIVATE_ALL = true;

// Em chat privado não existe "participant", então o bot reconhece o dono pelo
// OWNER_LID na conversa (forma LID e forma alternativa que o Baileys publica).
// Se você não for reconhecido, coloque aqui os seus números com DDI, ex:
// ["258840000000"].
export const OWNER_PRIVATE_JIDS = [];

// Diretório dos comandos
export const COMMANDS_DIR = path.join(__dirname, "commands");

// Diretório de arquivos de mídia.
//
// `DATABASE_DIR` e `AUTH_DIR` são configuráveis por ambiente porque em hosts
// com disco efémero o estado só sobrevive se ficar num volume persistente, e
// cada host monta o volume num caminho diferente. Sem o override, apontar o
// volume para outro sítio obrigava a mexer no código.
export const DATABASE_DIR =
  process.env.DATABASE_DIR || path.resolve(__dirname, "..", "database");

// Diretório de arquivos de mídia.
export const ASSETS_DIR = path.resolve(__dirname, "..", "assets");

// Sessão do WhatsApp (Baileys). Separado do resto porque é o que se perde a
// cada deploy sem volume: sem esta pasta o bot volta a pedir pareamento.
export const AUTH_DIR =
  process.env.AUTH_DIR || path.join(ASSETS_DIR, "auth", "baileys");

// Diretório de arquivos temporários.
export const TEMP_DIR = path.resolve(__dirname, "..", "assets", "temp");

// ==========================================================================
// MENU PRINCIPAL (card visual do .menu)
// ==========================================================================
// Nome mostrado no card é o BOT_NAME acima; o criador aparece no card e no
// rodapé.
export const MAIN_MENU_CREATOR = process.env.MAIN_MENU_CREATOR || "Yanik Uaite";

// Número do dono com DDI, só dígitos (ex.: 258840000000). Vazio esconde o
// botão "👑 Dono" (https://wa.me/NUMERO). Configurado para o dono do bot.
export const MAIN_MENU_OWNER_NUMBER =
  process.env.MAIN_MENU_OWNER_NUMBER || "258834788141";

// Canal oficial do botão "📢 Canal". Vazio esconde o botão.
// É também o canal usado pelos cards de anime e pelo fluxo guiado.
export const MAIN_MENU_CHANNEL_URL =
  process.env.MAIN_MENU_CHANNEL_URL ||
  "https://www.youtube.com/@devyanik?sub_confirmation=1";

// Imagem do cabeçalho: caminho local OU URL https. Vazio = card sem imagem.
export const MAIN_MENU_IMAGE =
  process.env.MAIN_MENU_IMAGE ||
  path.join(ASSETS_DIR, "images", "kakashi-bot.png");

// Rodapé exato do card interativo.
export const MAIN_MENU_FOOTER =
  process.env.MAIN_MENU_FOOTER || `© ${BOT_NAME} • Escolha abaixo`;

// Timeout em milissegundos por evento (evita banimento).
export const TIMEOUT_IN_MILLISECONDS_BY_EVENT = 500;

// Plataforma de API's
export const SPIDER_API_BASE_URL = "https://api.spiderx.com.br/api";

// Obtenha seu token, criando uma conta em: https://api.spiderx.com.br.
export const SPIDER_API_TOKEN = "seu_token_aqui";

// Plataforma recomendada para o comando gerar-link.
// Com chave propria do Linker, os links seguem a duracao do plano Linker.
// Com token da Spider X API, os links duram 1 dia.
// O domínio padrão é o do Dev Yanik; se o serviço mudar, aponte LINKER_BASE_URL
// no ambiente (ou configure o token da Spider X API e deixe esta em branco).
export const LINKER_BASE_URL =
  process.env.LINKER_BASE_URL || "https://linker.devyaniik.dev/api";

// Obtenha sua chave em: https://linker.devyaniik.dev.
// Não tem valor fixo aqui de propósito (o repositório é público): defina
// `LINKER_API_KEY` no ambiente ou use `.set-linker-api-token` no WhatsApp.
// Sem esta chave, o bot usa automaticamente o token da Spider X API.
export const LINKER_API_KEY = process.env.LINKER_API_KEY || "";

// Caso queira responder apenas um grupo específico,
// coloque o ID dele na configuração abaixo.
// Para saber o ID do grupo, use o comando <prefixo>get-group-id
// Troque o <prefixo> pelo prefixo do bot (ex: /get-group-id).
export const ONLY_GROUP_ID = "";

// Configuração para modo de desenvolvimento
// mude o valor para ( true ) sem os parênteses
// caso queira ver os logs de mensagens recebidas
export const DEVELOPER_MODE = false;

// Chave da OpenAI para o comando de suporte
export const OPENAI_API_KEY = "";

// Configuracoes do projeto e APIs.
// Segredos NÃO ficam versionados: este repositório é público e o GitHub revoga
// sozinho qualquer token que encontre num ficheiro de repo público (foi o que
// aconteceu aos valores que aqui estavam). Defina-os nos segredos do host.
export const HF_TOKEN = process.env.HF_TOKEN || "";

// ==========================================================================
// GROQ (IA do bot: chat e transcrição)
// ==========================================================================
// Crie a sua chave em: https://console.groq.com/keys
// O valor vem do ambiente: sem `GROQ_API_KEY` definido, o chat e a transcrição
// ficam indisponíveis e o bot avisa em vez de falhar com uma chave inválida.
export const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_CHAT_URL = `${GROQ_BASE_URL}/chat/completions`;
export const GROQ_TRANSCRIPTION_URL = `${GROQ_BASE_URL}/audio/transcriptions`;

// Modelos de chat, tentados nesta ordem (o primeiro é o usado pelo .kakashi).
// Só modelos de produção: a Groq descontinuou llama-3.3-70b-versatile e
// llama-3.1-8b-instant em 16/08/2026, e qwen/qwen3-32b em 17/07/2026.
export const GROQ_MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"];

// Ajustes de geração (temperatura vai de 0 a 2; top_p de 0 a 1).
// Temperatura baixa: as respostas do chat são factuais (comandos do bot e
// contas), não criativas. Subir isto volta a encher as respostas de rodeios.
export const GROQ_TEMPERATURE = 0.3;
export const GROQ_TOP_P = 1;
// Teto curto de propósito: a IA responde em poucas frases, não em artigos.
export const GROQ_MAX_TOKENS = 512;

// Quantas mensagens do histórico de cada conversa são enviadas ao modelo.
export const GROQ_HISTORY_SIZE = 10;

// Instrução de sistema do chat da IA (comandos `.kakashi`, `.gemini`, `.gpt`,
// `.deepseek`). Fica na configuração para o dono ajustar o âmbito sem mexer no
// serviço: a IA fala do Kakashi Bot, de matemática simples e de conversa básica.
export const GROQ_SYSTEM_PROMPT = `Você é o Kakashi Bot, um bot de WhatsApp. Falas em português do Brasil, com um tom simpático e natural, como uma pessoa a conversar.

Podes responder a:
1. Conversa básica: cumprimentos ("tudo bem?", "bom dia"), quem és tu e o que fazes. Nestes casos responde em uma frase curta e simpática (ex.: "Tudo bem! E contigo? Em que posso ajudar?"). Não uses rodeios nem discursos.
2. Dúvidas sobre o Kakashi Bot: comandos, como usar cada um, como recarregar créditos, preços, planos, erros, instalação, animes, downloads e afins. Tens abaixo um bloco "COMANDOS DISPONÍVEIS" e "COMO RECARREGAR" com os dados reais: usa-os como verdade, indica o comando exato (com o prefixo) e não inventes comandos nem valores.
3. Matemática simples: soma, subtração, multiplicação, divisão, porcentagem, regra de três e contas básicas. Mostra a conta e o resultado na mesma linha.

Para qualquer outro assunto (notícias, política, saúde, receitas, fofoca, conselhos pessoais, programação genérica fora do bot, etc.), recusa em uma frase curta: diz que só ajudas com o Kakashi Bot, contas simples e conversa básica.

Regras:
- no máximo 3 frases ou 60 palavras; sem introdução e sem despedida;
- sem listas longas e sem emojis decorativos;
- usa os blocos "COMANDOS DISPONÍVEIS" e "COMO RECARREGAR" para responder sobre o bot; se algo não estiver lá, diz que não sabes;
- se receberes um bloco "ESTADO ATUAL DO BOT", usa-o como verdade para responder sobre números e estado reais do bot (whitelist, banidos, créditos, etc.).`;

// Instrução extra dada APENAS ao dono, quando o bot injeta o estado real.
// Fica separada do prompt público para o âmbito de membros não mudar.
export const GROQ_OWNER_CONTEXT_PROMPT = `O dono do bot está a falar contigo e recebeste o ESTADO ATUAL DO BOT. Responde com os valores reais que lá estão; não os inventes nem os arredondes. Se o dado pedido não estiver no bloco, diz que não tens essa informação. Não reveles segredos nem chaves.`;

// Protocolo de acção: quando o pedido é "ativa/desativa X", a IA devolve um
// JSON em vez de prosa. O bot re-despacha o comando real (permissões e
// anti-flood continuam a valer); a IA nunca escreve diretamente no estado.
export const GROQ_ACTION_PROMPT = `O usuário está autorizado a pedir que executes comandos de ligar/desligar de recursos do grupo (a lista está no bloco "AÇÕES QUE PODES PEDIR").

Se — e só se — o pedido for EXPLÍCITO e corresponder a um desses comandos, responde APENAS com um objeto JSON, sem texto à volta, sem crases:
{"action":"run","command":"<nome>","intent":"on|off"}

- "intent":"on" para ativar/ligar; "intent":"off" para desativar/desligar.
- Para "abrir"/"fechar" o grupo não uses intent (basta o command).
- Usa o nome do comando SEM prefixo e exatamente como aparece na lista.

Em qualquer outro caso (conversa, perguntas, dúvidas, contas, ou um pedido que não corresponda a nenhum comando da lista), responde em texto normal, como sempre, e NÃO devolvas JSON.`;

// Comando .suporte (assistente que responde com AGENTS.md/README.md no contexto).
export const GROQ_SUPPORT_MODEL = "openai/gpt-oss-120b";
export const GROQ_SUPPORT_MAX_TOKENS = 2048;

// Análise de imagem no .suporte: a Groq só aceita imagens em modelos de visão
// (ex: "qwen/qwen3.8-27b", em preview). Deixe false para responder só texto.
export const GROQ_SUPPORT_VISION = false;

// ==========================================================================
// GOOGLE GEMINI (o que a Groq não faz: gerar imagem)
// ==========================================================================
// Crie a sua chave em: https://aistudio.google.com/apikey
// O valor vem do ambiente (o mesmo motivo do HF_TOKEN/GROQ_API_KEY).
// IMPORTANTE: a geração de IMAGEM não tem free tier na Google (exige billing
// ativado na conta).
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

// Geração de imagem (a doc usa a versão v1 nesses modelos).
// Modelos de imagem suportados pela API: gemini-3-pro-image,
// gemini-3.1-flash-image, gemini-3.1-flash-lite-image e gemini-2.5-flash-image.
// Trocar para gemini-3-pro-image aumenta a qualidade (e o custo por imagem).
export const GEMINI_IMAGE_API = `${GEMINI_BASE_URL}/v1/models`;
export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
export const GEMINI_IMAGE_ASPECT_RATIO = "1:1";
export const GEMINI_IMAGE_SIZE = "1K";
export const GEMINI_IMAGE_TIMEOUT_MS = 60 * 1000;

// Transcrição de áudio (comando .transcrever).
// Limite de upload do free tier: 25 MB.
export const GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
export const GROQ_TRANSCRIPTION_LANGUAGE = "pt";
// Token do GitHub para o backup remoto. Lê do AMBIENTE e não tem valor fixo
// aqui de propósito: o repositório é público e o GitHub revoga sozinho qualquer
// token que encontre num ficheiro versionado (foi o que aconteceu ao valor que
// aqui estava, o que fazia o `.backup` responder HTTP 401). Defina
// `GITHUB_TOKEN` nos segredos do host — ou use `.set-github-token` no WhatsApp,
// que guarda o valor em `database/config.json` (não versionado).
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
// Repositório de destino do backup. Configurável por ambiente para poder
// apontar para um repositório PRIVADO: o arquivo leva o `.env` e os dados dos
// clientes, e num repositório público ficariam à vista de qualquer pessoa.
// O destino por padrão é um repositório só para os backups, separado do código:
// assim o histórico do projeto não guarda, para sempre, cada versão do arquivo.
export const GITHUB_REPOSITORY =
  process.env.GITHUB_REPOSITORY || "yanikuaite-commits/Servidor-";
export const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
export const GITHUB_BACKUP_PATH = "backups/kakashi-database.tar.gz";
// Intervalo do backup automático, em horas. 0 (ou inválido) desliga o
// agendamento e o backup volta a ser só por `.backup`.
//
// Uma hora é o padrão: com o destino no Turso cada backup é uma linha, não um
// commit, por isso a frequência não enche histórico nenhum. A retenção
// (`BACKUP_RETENTION`) é que limita o crescimento.
export const BACKUP_INTERVAL_HOURS = Number(
  process.env.BACKUP_INTERVAL_HOURS ?? 1,
);
// Onde os backups são guardados.
//
// `turso` (padrão) guarda cada backup como uma linha na base — barato e sem
// depender do GitHub. `github` mantém o comportamento antigo (um commit por
// backup num repositório privado).
//
// Nota honesta: com o destino no Turso, o backup vive na MESMA base que os
// dados. Isso serve para desfazer uma eliminação acidental (há versões
// anteriores no histórico), mas NÃO protege de perder a base: se a base
// desaparecer, o original e a cópia desaparecem juntos. Para uma cópia
// independente, use `github` (ou os dois, alternando).
export const BACKUP_TARGET = (
  process.env.BACKUP_TARGET || "turso"
).toLowerCase();
// Quantos backups manter no Turso. Cada backup é uma linha com o arquivo
// comprimido (~200 KB com sessão, ~2 KB só com dados), portanto 24 ocupam
// alguns megabytes no máximo. Os mais antigos são apagados depois de cada
// backup novo, para a tabela não crescer sem fim.
export const BACKUP_RETENTION = Math.max(
  1,
  Number(process.env.BACKUP_RETENTION || 24),
);
// Incluir a sessão do WhatsApp nos backups automáticos.
//
// Desligado por padrão: a sessão são as chaves privadas do número, e um backup
// desatendido que as levasse ficaria guardado sem ninguém dar por isso. O
// arquivo de backup é um ponto-no-tempo que pode ser restaurado por engano.
//
// A sessão é guardada à parte, no espelho contínuo (`SESSION_SYNC_*`), que é o
// que a faz sobreviver aos deploys. Ligar isto acrescenta-a também ao histórico
// de backups, para um restauro de catástrofe ser auto-suficiente.
export const BACKUP_INCLUDE_SESSION =
  String(process.env.BACKUP_INCLUDE_SESSION || "false").toLowerCase() ===
  "true";
// A sessão do Baileys vive em milhares de ficheiros pequenos que o WhatsApp
// reescreve constantemente. Espelhá-la a cada escrita martelaria o Turso, por
// isso é guardada por intervalo (e no encerramento, onde não se perde nada).
export const SESSION_SYNC_INTERVAL_MINUTES = Math.max(
  1,
  Number(process.env.SESSION_SYNC_INTERVAL_MINUTES || 15),
);
// Nome da entrada da sessão na tabela de estado (não é um `database/*.json`).
export const SESSION_STATE_NAME = "session";
// Segredo pedido pela página de pareamento (com ou sem o "/pairing").
// Você pode trocar o valor aqui ou definir PAIRING_SECRET no ambiente do bot
// (variável de ambiente do host, por exemplo); o ambiente tem prioridade.
// A comparação diferencia maiúsculas de minúsculas e ignora espaços nas pontas.
export const PAIRING_SECRET = process.env.PAIRING_SECRET || "KakashiPairing2026";

// Opcional: número usado para pedir o código automaticamente, sem passar pela
// página. Ex: "258850421617". Vazio = pergunta no terminal ou na página.
export const PAIRING_NUMBER = process.env.PAIRING_NUMBER || "";

// ==========================================================================
// SISTEMA DE CRÉDITOS
// ==========================================================================

// Fuso usado no reset diário dos créditos e do planejamento semanal.
// Moçambique usa UTC+2 o ano inteiro (sem horário de verão).
export const CREDITS_TIMEZONE = "Africa/Maputo";

// Créditos gratuitos renovados todos os dias às 00h00 (horário de Moçambique).
export const DAILY_FREE_CREDITS = 10;

// Contato do dono para receber pagamento e recarregar créditos.
// Use o número com DDI e DDD, apenas dígitos (ex: "258840000000").
export const OWNER_CONTACT = "258834788141";

// Comandos isentos de créditos (navegação, ajuda e a própria conta).
// A comparação usa o nome "oficial" do comando (não os atalhos).
export const FREE_COMMANDS = [
  "ping",
  "menu",
  "help",
  "info",
  "meu-lid",
  "perfil",
  "conta",
  "suporte",
  "exemplos-de-mensagens",
  "tabela",
  "tabela-dias",
  "tabela-creditos",
  "pagamento",
];

// Hierarquia de custo dos downloads, do mais leve ao mais pesado.
//
// O degrau é um nome e não um número solto para o preço viver num sítio só:
// subir o vídeo de rede social não pode obrigar a acertar seis linhas iguais.
// A âncora é o degrau leve (3 créditos), que é o download mais barato do bot.
export const DOWNLOAD_CREDIT_TIERS = {
  leve: 3, // áudio curto e imagem: quase não gastam banda
  medio: 4, // vídeo de rede social: um ficheiro, sem pesquisa
  pesado: 5, // YouTube: pesquisa + melhor qualidade disponível
};

// Custo em créditos por comando (nome oficial do comando).
// Comandos de membro que não estão aqui gastam DEFAULT_COMMAND_CREDITS.
export const COMMAND_CREDITS = {
  // Downloads — os degraus de DOWNLOAD_CREDIT_TIERS, do leve ao pesado.
  "tik-tok-audio": DOWNLOAD_CREDIT_TIERS.leve,
  pinterest: DOWNLOAD_CREDIT_TIERS.leve,
  "tik-tok": DOWNLOAD_CREDIT_TIERS.medio,
  instagram: DOWNLOAD_CREDIT_TIERS.medio,
  facebook: DOWNLOAD_CREDIT_TIERS.medio,
  "x-twitter": DOWNLOAD_CREDIT_TIERS.medio,
  baixar: DOWNLOAD_CREDIT_TIERS.medio,
  "play-video": DOWNLOAD_CREDIT_TIERS.pesado,
  "play-audio": DOWNLOAD_CREDIT_TIERS.pesado,
  // Navegação: só pesquisa, sem baixar nada.
  anime: 2,
  megacine: 2,
  "yt-search": 5,
  // Inteligência artificial
  "deepseek": 6,
  "gemini": 6,
  "gpt-5-mini": 7,
  "flux": 8,
  "ia-sticker": 9,
  "tts": 6,
  // Mídia, stickers e utilidades
  "sticker": 5,
  "rename": 5,
  "attp": 5,
  "ttp": 5,
  "brat": 5,
  "bratvid": 7,
  "to-mp3": 6,
  "togif": 6,
  "toimage": 5,
  "transcrever": 8,
  "removebg": 7,
  "gerar-link": 6,
};

// Custo de qualquer outro comando de membro não listado acima.
export const DEFAULT_COMMAND_CREDITS = 5;

// Custo por episódio de anime baixado. A pesquisa e o menu custam
// `COMMAND_CREDITS.anime` (2 créditos, barato porque só pesquisar não gasta
// banda), mas cada episódio efetivamente baixado custa isto: o gasto real é o
// download, não a navegação.
//
// 13 créditos, abaixo do degrau mais pesado dos vídeos: um episódio é um
// download longo, e a 10 créditos/dia gratuitos continua a exigir recarga
// (cerca de um episódio por dia), sem tornar o comando inútil.
export const ANIME_EPISODE_CREDITS = 13;

// ==========================================================================
// ANTI-FLOOD
// ==========================================================================

// Intervalo mínimo entre comandos do mesmo usuário (segundos). Um usuário pode
// disparar um comando a cada N segundos; abaixo disso é flood. 0 desliga.
export const COMMAND_COOLDOWN_SECONDS = Number(
  process.env.COMMAND_COOLDOWN_SECONDS || 5,
);

// Teto de comandos por usuário por dia (00h00 de Moçambique). O dono não conta.
// 0 desliga o teto.
export const MAX_COMMANDS_PER_DAY = Number(
  process.env.MAX_COMMANDS_PER_DAY || 200,
);

// O cooldown e o teto valem só para estes comandos: os que gastam recursos
// caros (banda, CPU, APIs pagas). Comandos de navegação (`conta`, `menu`) e de
// grupo (`warn`, `mute`) não entram, para não atrapalhar a moderação.
export const RATE_LIMITED_COMMANDS = new Set([
  "anime",
  "attp",
  "baixar",
  "brat",
  "bratvid",
  "deepseek",
  "facebook",
  "flux",
  "gemini",
  "gerar-link",
  "gpt-5-mini",
  "ia-sticker",
  "instagram",
  "pinterest",
  "play-audio",
  "play-video",
  "removebg",
  "rename",
  "sticker",
  "tik-tok",
  "tik-tok-audio",
  "to-gif",
  "to-image",
  "to-mp3",
  "transcrever",
  "ttp",
  "tts",
  "x-twitter",
  "yt-search",
]);

// ==========================================================================
// FILA DE DOWNLOADS
// ==========================================================================

// Lê um inteiro positivo do ambiente, com um padrão quando o valor falta ou não
// presta. Sem esta guarda um valor inválido (ex. `DOWNLOAD_CONCURRENCY=abc`)
// virava NaN, e `running < NaN` é sempre falso: a fila nunca arrancava nada e
// todo o download morria no timeout. O bot tem de aguentar qualquer host, por
// isso um valor torto degrada para o padrão em vez de parar a fila.
function positiveIntFromEnv(name, fallback) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

// Quantos downloads correm ao mesmo tempo. O excedente espera na fila em vez de
// dividir a banda com os outros. 1 (padrão) serializa tudo: uma coisa de cada
// vez, em qualquer host.
export const DOWNLOAD_CONCURRENCY = positiveIntFromEnv("DOWNLOAD_CONCURRENCY", 1);

// Tempo máximo na fila antes de desistir (ms). Evita esperas sem fim quando o
// downloader à frente encrava. Também passa pela guarda: um `NaN` aqui fazia o
// temporizador disparar logo e desistir de todos os pedidos.
export const DOWNLOAD_QUEUE_TIMEOUT_MS = positiveIntFromEnv(
  "DOWNLOAD_QUEUE_TIMEOUT_MS",
  5 * 60 * 1000,
);


// ==========================================================================
// PAGAMENTOS E RECARGAS (e-mola / m-pesa)
// ==========================================================================
// Números que recebem os pagamentos. O bot só trata como pagamento as
// mensagens de SMS que citem um destes números.
export const PAYMENT_E_MOLA_NUMBER = process.env.PAYMENT_E_MOLA_NUMBER || "865672009";
export const PAYMENT_M_PESA_NUMBER = process.env.PAYMENT_M_PESA_NUMBER || "850446446";

// Titular de cada número, mostrado pelo comando `.pagamento` por baixo do
// respetivo número. O nome confirma ao usuário para quem está a transferir.
export const PAYMENT_E_MOLA_NAME = process.env.PAYMENT_E_MOLA_NAME || "Yanik";
export const PAYMENT_M_PESA_NAME = process.env.PAYMENT_M_PESA_NAME || "Helton";

// Quanto tempo o dono tem para confirmar uma recarga antes de a transação
// caducar (10 horas). Depois disso o usuário tem de enviar o pagamento de novo.
export const PAYMENT_CONFIRM_TTL_MS =
  Number(process.env.PAYMENT_CONFIRM_TTL_MS) || 10 * 60 * 60 * 1000;

// Créditos extras para mídias longas/pesadas.
// A duração é usada quando a API informa; senão, o tamanho do arquivo.
export const MEDIA_CREDITS_BY_DURATION = [
  { minSeconds: 0, credits: 0 },
  { minSeconds: 3 * 60, credits: 2 },
  { minSeconds: 10 * 60, credits: 4 },
  { minSeconds: 30 * 60, credits: 6 },
];

export const MEDIA_CREDITS_BY_SIZE = [
  { minBytes: 0, credits: 0 },
  { minBytes: 10 * 1024 * 1024, credits: 2 },
  { minBytes: 30 * 1024 * 1024, credits: 4 },
  { minBytes: 60 * 1024 * 1024, credits: 6 },
];

// ==========================================================================
// YT-DLP (downloader local, recomendado em Docker)
// ==========================================================================
// O binário "yt-dlp_linux" é instalado pelo Dockerfile (e por
// "npm run setup:ytdlp" em hosts sem Docker). Quando ele não existe, os
// downloads continuam funcionando pela API GenDownload (fallback).
export const YTDLP_ENABLED = process.env.YTDLP_ENABLED !== "false";
export const YTDLP_PATH = process.env.YTDLP_PATH || "";
// Teto de tempo de UMA execução do yt-dlp. 50 min por omissão: um episódio de
// 24 min em 480p (~95 MB) desce a ~7 MB/min de alguns hosts, e com o teto de
// 800 MB os ficheiros grandes precisam de mais folga — o processo era morto a
// meio, sem stderr, e o utilizador só via o comando (ver `friendlyError` em
// `src/services/ytdlp.js`).
// Ajustável por YTDLP_TIMEOUT_MS; valor não numérico ou <= 0 cai no default.
const ytdlpTimeoutMs = Number(process.env.YTDLP_TIMEOUT_MS);
export const YTDLP_TIMEOUT_MS =
  Number.isFinite(ytdlpTimeoutMs) && ytdlpTimeoutMs > 0
    ? ytdlpTimeoutMs
    : 50 * 60 * 1000;
// Cookies (formato Netscape) para o YouTube aceitar a sessão em IP de datacenter.
export const YTDLP_COOKIES_PATH = process.env.YTDLP_COOKIES_PATH || "";
export const YTDLP_PROXY = process.env.YTDLP_PROXY || "";
// Runtime JavaScript para os desafios do YouTube (Node 22+). Vazio desativa.
export const YTDLP_JS_RUNTIME = process.env.YTDLP_JS_RUNTIME ?? "node";
export const YTDLP_IMPERSONATE = process.env.YTDLP_IMPERSONATE || "";
export const YTDLP_EXTRACTOR_ARGS = process.env.YTDLP_EXTRACTOR_ARGS || "";
// Fragmentos HLS baixados em paralelo. 1 = sequencial. CDNs com rate limit
// (o dos animes responde 429 a pedidos concorrentes) precisam de 1, senão o
// yt-dlp perde fragmentos e falha com "No such file ...-FragN".
export const YTDLP_CONCURRENT_FRAGMENTS = Number(
  process.env.YTDLP_CONCURRENT_FRAGMENTS || 4,
);
// Remux/transcode do vídeo antes de o enviar como VÍDEO (≤ 100 MB): põe o
// índice (`moov`) antes dos dados e garante H.264, sem o que o WhatsApp responde
// "vídeo não está disponível". Só corre quando o ficheiro não está já em H.264
// com `moov` no início. Desligável por VIDEO_FIX_ENABLED=false.
export const VIDEO_FIX_ENABLED = process.env.VIDEO_FIX_ENABLED !== "false";
// Teto de tempo de uma conversão. Um episódio AV1 de 80 MB em 480p fica na casa
// dos 30-60s; 5 min dá folga sem prender o download para sempre.
export const VIDEO_FIX_TIMEOUT_MS = Number(
  process.env.VIDEO_FIX_TIMEOUT_MS || 5 * 60 * 1000,
);

// ==========================================================================
// MONGODB (persistência durável; opcional)
// ==========================================================================
// Com `MONGODB_URI` definido, o estado (créditos, assinaturas, banimentos,
// prefixos, ...) passa a ser gravado no MongoDB Atlas em vez de só no disco do
// host — que num host de disco efémero é apagado a cada deploy. Sem a
// variável, o bot mantém o comportamento antigo (JSON em disco),
// por isso a migração é reversível por configuração, sem reverter código.
//
// A URI contém a password: defina-a por variável de ambiente ou em
// `database/config.json` (não versionado). NUNCA em ficheiro versionado.
export const MONGODB_URI = process.env.MONGODB_URI || "";
export const MONGODB_DB = process.env.MONGODB_DB || "kakashi";
// Coleção única com um documento por ficheiro de estado: o mapeamento é 1:1 com
// os `database/*.json` atuais, o que torna a migração e o diagnóstico simples.
export const MONGODB_STATE_COLLECTION =
  process.env.MONGODB_STATE_COLLECTION || "state";
// Tempo máximo à espera de um servidor do Atlas antes de desistir. Curto de
// propósito: o arranque do bot não pode ficar pendurado por causa do banco.
export const MONGODB_SERVER_SELECTION_TIMEOUT_MS = Number(
  process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 5000,
);
// Atraso entre a alteração em memória e a gravação no Mongo. Agrupa rajadas de
// escritas (o anti-flood e os créditos escrevem em sequência) num só pedido,
// reduzindo round-trips e o risco de throttling no plano M0.
export const MONGODB_FLUSH_DEBOUNCE_MS = Number(
  process.env.MONGODB_FLUSH_DEBOUNCE_MS || 1000,
);
// Intervalo entre tentativas quando a gravação falha (rede em baixo). O flush
// volta a tentar sozinho, para que uma queda temporária não deixe dados por
// sincronizar até ao próximo restart.
export const MONGODB_FLUSH_RETRY_MS = Number(
  process.env.MONGODB_FLUSH_RETRY_MS || 30000,
);

// ==========================================================================
// TURSO (SQLite na nuvem; alternativa ao MongoDB)
// ==========================================================================
// O Turso é SQLite na nuvem. Vantagem prática sobre o Atlas: NÃO tem lista de
// IPs permitidos, o que no Pterodactyl (IP dinâmico) obrigava a abrir
// `0.0.0.0/0`. O estado fica numa tabela que se lê pelo painel ou por
// `turso db shell`.
//
// A consola do Turso mostra a URL com o esquema `turso://`, mas o cliente
// oficial (@libsql/client) REJEITA esse esquema com "URL_SCHEME_NOT_SUPPORTED":
// só aceita `libsql:`, `wss:`, `ws:`, `https:`, `http:` e `file:`.
// `src/services/turso.js` traduz `turso://` → `libsql://` automaticamente, por
// isso colar a URL da consola funciona na mesma.
export const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || "";
export const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";
// Tabela com uma linha por ficheiro de estado (name/data/updated_at).
export const TURSO_TABLE = process.env.TURSO_TABLE || "kakashi_state";
// Tabela dos backups: uma linha por backup (histórico ponto-no-tempo).
export const TURSO_BACKUP_TABLE =
  process.env.TURSO_BACKUP_TABLE || "kakashi_backups";

// ==========================================================================
// ANIMES (fonte única: saimo)
// ==========================================================================
// O fluxo de animes usa UMA fonte: `saimo` (`src/services/saimoAnime.js`). O
// catálogo é servido em ficheiros de texto num Cloudflare Pages (sem desafio) e
// a maioria dos episódios é HLS com degraus 360p/720p, pelo que o menu de
// qualidades deixa o utilizador escolher.
//
// O `meusanimes` (`src/services/meusanimes.js`) continua no repositório mas
// deixou de ser chamado; se um dia voltar, o ponto de entrada é
// `src/services/anime.js`, trocando `FONTE`.
//
// `ANIME_USER_AGENT` é o cabeçalho aplicado a todos os pedidos à fonte, e o
// `ANIME_ACCEPT_LANGUAGE` o idioma preferido. `ANIME_PROXY_URL` é a saída de
// emergência para quando o IP do host é desafiado pelo Cloudflare: um proxy HTTP
// residencial, no formato http://user:pass@host:port.
export const ANIME_USER_AGENT =
  process.env.ANIME_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
export const ANIME_ACCEPT_LANGUAGE = process.env.ANIME_ACCEPT_LANGUAGE || "en-US,en;q=0.9";
export const ANIME_PROXY_URL = process.env.ANIME_PROXY_URL || "";

export const ANIME_API_TIMEOUT_MS = 30 * 1000;

// ==========================================================================
// MEGACINE (séries, doramas e animes episódicos)
// ==========================================================================
// Catálogo diferente do dos animes: aqui o foco são séries com temporadas e
// episódios, que o bot não tinha. Fica num comando próprio (`.megacine`) porque
// misturar os dois catálogos confundiria pesquisas com regras diferentes.
// Filmes ficam de fora — ver `MEGACINE_TIPOS_EXCLUIDOS`.
//
// O stream vive num domínio separado do site e esse domínio tem dois lados: o
// primário (`ondemand.madfirebox.shop`) bloqueia IPs de datacenter com 403 do
// Cloudflare, e o fallback (`forks-<tipo>.madfirebox.shop`) serve normalmente.
// O bot usa o fallback — ver `src/services/megacine.js`.
export const MEGACINE_BASE_URL =
  process.env.MEGACINE_BASE_URL || "https://www.megacine.online";

export const MEGACINE_USER_AGENT =
  process.env.MEGACINE_USER_AGENT || ANIME_USER_AGENT;

export const MEGACINE_TIMEOUT_MS = 30 * 1000;

// O m3u8 é servido por um CDN que responde devagar: medições repetidas deram
// 9–28 s só para o manifesto, muito acima do que uma página HTML do site
// demora (~1 s). Com o timeout curto das páginas, a verificação da playlist
// abortava um stream que estava bom — e o utilizador via "a fonte não
// respondeu" num título que funcionava. Por isso este passo tem um teto
// próprio e generoso.
export const MEGACINE_PLAYLIST_TIMEOUT_MS = Number(
  process.env.MEGACINE_PLAYLIST_TIMEOUT_MS || 60 * 1000,
);

// Tipos que a pesquisa do `.megacine` deve ignorar. Vazio por omissão: FILMES
// ENTRAM. O comando deixou de servir só conteúdo episódico — um filme é um
// download único, sem temporadas, e o menu deteta-o pelo tipo (`f`) para seguir
// outro caminho (faixa → qualidade → compressão → envio).
//
// A lista mantém-se configurável: `MEGACINE_TIPOS_EXCLUIDOS=filmes` repõe o
// comportamento antigo (só séries, doramas e animes episódicos).
export const MEGACINE_TIPOS_EXCLUIDOS = (
  process.env.MEGACINE_TIPOS_EXCLUIDOS || ""
)
  .split(",")
  .map((tipo) => tipo.trim().toLowerCase())
  .filter(Boolean);

// Custo por episódio baixado. A pesquisa e o menu são baratos
// (`COMMAND_CREDITS.megacine`), porque só pesquisar não gasta banda — o gasto
// real é o download.
//
// Mesmo valor dos animes: as duas funções baixam um episódio, e preços
// diferentes para o mesmo trabalho seriam arbitrários.
export const MEGACINE_DOWNLOAD_CREDITS = Number(
  process.env.MEGACINE_DOWNLOAD_CREDITS || ANIME_EPISODE_CREDITS,
);

// Teto do download de séries/doramas. As séries do Saimo são MP4 diretos e
// passam com frequência dos 500 MB (medidos: 509 a 752 MB em 6 de 7 títulos).
// Segue o teto dos animes (`ANIME_DOCUMENT_LIMIT_MB`, definido abaixo): baixar
// mais do que o envio aceita só gastava banda e disco para depois recusar no
// fim. O envio mantém o download E a cópia encriptada do Baileys em disco
// (~2x), por isso este valor exige ~2x o seu tamanho livre no diretório
// temporário. A precedência é `MEGACINE_MAX_DOWNLOAD_MB`, depois o teto dos
// animes.
export const MEGACINE_MAX_DOWNLOAD_BYTES =
  Number(process.env.MEGACINE_MAX_DOWNLOAD_MB || 800) * 1024 * 1024;

// ==========================================================================
// FILMES (download único, com compressão)
// ==========================================================================
// Um filme do catálogo é um MP4 único. Medido em 30 títulos: mediana ~1,6 GB e
// máximo ~2,3 GB, com alguns filmes pequenos (<100 MB) que já cabem no envio. A
// maioria excede o teto, e como o ficheiro TEM de ser baixado inteiro antes de
// comprimir, o teto do download é o que limita o disco: o processo mantém o
// original E a cópia comprimida em disco ao mesmo tempo.
//
// 5 GB cobre todo o catálogo medido com folga. O disco do host precisa de ~1,4x
// este valor livre (original + versão comprimida, que é uma fração do original).
export const FILME_MAX_DOWNLOAD_BYTES =
  Number(process.env.FILME_MAX_DOWNLOAD_MB || 5120) * 1024 * 1024;

// Teto de ENVIO do filme, separado do teto dos animes (`ANIME_DOCUMENT_LIMIT_MB`,
// 800 MB). A 720p um filme de 2 h pode passar dos 800 MB e seria cancelado
// depois de todo o download e da compressão — a mesma armadilha que a lista de
// qualidade existe para evitar. 1,5 GB é o teto dos downloads gerais
// (`MAX_FILE_SIZE_BYTES`) e cobre um filme comprimido.
export const FILME_MAX_SEND_BYTES =
  Number(process.env.FILME_MAX_SEND_MB || 1536) * 1024 * 1024;

// Altura-alvo da compressão. 720p corta a maior parte do tamanho mantendo a
// qualidade num ecrã de telemóvel; 480p corta mais e é a opção para quem quer o
// ficheiro mais leve possível. A escolha é do utilizador no menu; estes são os
// degraus oferecidos.
export const FILME_COMPRESS_HEIGHTS = (
  process.env.FILME_COMPRESS_HEIGHTS || "720,480"
)
  .split(",")
  .map((v) => Number(v.trim()))
  .filter((v) => Number.isFinite(v) && v > 0);

// Qualidade da compressão (CRF do libx264): mais alto = ficheiro menor e mais
// artefactos. 28 é o valor escolhido para 720p.
export const FILME_COMPRESS_CRF = Number(process.env.FILME_COMPRESS_CRF || 28);

// Preset do libx264. Medido neste host (720p→480p, `testsrc`): `veryfast` corre
// a ~17x o tempo real (um filme de 90 min em ~5 min); `ultrafast` é ~21x mais
// rápido mas gera ~78% mais bytes. `veryfast` é o equilíbrio; num host lento o
// dono pode subir para `ultrafast` ou descer para `faster`.
export const FILME_COMPRESS_PRESET = process.env.FILME_COMPRESS_PRESET || "veryfast";

// Teto de uma só compressão. Um filme de 90 min a `veryfast` leva ~5 min neste
// host; o teto de 45 min dá folga a um host ARM mais lento sem deixar um
// processo preso indefinidamente. Excedido, a compressão é abortada e o original
// é enviado (ver `comprimirVideo`), para não perder o download já feito.
export const FILME_COMPRESS_TIMEOUT_MS =
  Number(process.env.FILME_COMPRESS_TIMEOUT_MS || 45 * 60 * 1000);

// Tradução de títulos PT → língua do catálogo (ver `src/services/translate.js`).
//
// É um extra: serve só para desempatar quando a pesquisa pelo termo original não
// encontra correspondência exata. `TRANSLATE_ENABLED=false` desliga-a, e o teto
// curto evita que um tradutor lento atrase a pesquisa — sem tradução o fluxo
// segue com o termo original.
export const TRANSLATE_ENABLED = process.env.TRANSLATE_ENABLED !== "false";
export const TRANSLATE_TIMEOUT_MS = 8 * 1000;
// Limite do WhatsApp: acima de 100 MB só como documento (a mesma regra do
// YouTube, aplicada pelo `decideAnimeSend`); acima deste teto o envio é
// cancelado e o utilizador é convidado a escolher uma qualidade menor.
//
// 800 MB: o envio mantém em disco o download e a cópia encriptada do Baileys,
// ou seja ~2x o tamanho (800 MB -> ~1.6 GB). O Oracle Cloud (instância ARM com
// volume persistente) aguenta esse pico, ao contrário dos hosts de disco
// efémero com pouca RAM que existiam antes. O valor continua configurável para
// hosts mais apertados.
export const ANIME_DOCUMENT_LIMIT_MB = Number(
  process.env.ANIME_DOCUMENT_LIMIT_MB || 800,
);
export const ANIME_MAX_DOWNLOAD_BYTES = ANIME_DOCUMENT_LIMIT_MB * 1024 * 1024;

// Resolução máxima do download de animes. O provider entrega um m3u8 com várias
// faixas (240p–1080p) e, sem limite, o yt-dlp escolhe a maior (1080p): um
// episódio de 24 min passa de 400 MB, gasta o dobro da banda e arrisca o teto
// de 800 MB. Fixar 480p mantém o episódio leve. Se a faixa de 480p não existir,
// o seletor do yt-dlp cai para a melhor disponível em vez de falhar.
export const ANIME_MAX_HEIGHT = Number(process.env.ANIME_MAX_HEIGHT) || 480;

// Procurar a faixa DUBLADA primeiro quando o episódio publica as duas.
//
// Sem escolha explícita do utilizador, um episódio com dublagem PT-BR é mais
// útil do que o legendado — é o que a maioria dos pedidos procura. A escolha
// explícita do menu (`anm:aud:`) tem sempre prioridade sobre isto, e um
// episódio sem dublagem continua a cair para o legendado em vez de falhar.
// `ANIME_PREFER_DUBBED=false` repõe o comportamento antigo.
export const ANIME_PREFER_DUBBED =
  String(process.env.ANIME_PREFER_DUBBED ?? "true").toLowerCase() !== "false";

// Providers cuja faixa "dublada" é PORTUGUÊS (PT-BR), e não inglês.
//
// A faixa é um booleano no site ("dubbed" ou não), mas o IDIOMA dessa dublagem
// depende do site. Com a fonte única atual (`meusanimes`, um site brasileiro) a
// lista só tem esse nome; o mecanismo mantém-se porque o rótulo do card e o
// aviso de idioma ainda o consultam.
export const ANIME_PT_DUB_PROVIDERS = (
  process.env.ANIME_PT_DUB_PROVIDERS || "saimo,meusanimes"
)
  .split(",")
  .map((nome) => nome.trim().toLowerCase())
  .filter(Boolean);

export const DOWNLOAD_TIMEOUT_MS = 50 * 60 * 1000;
export const AI_TIMEOUT_MS = 30 * 1000;
export const ATTP_TIMEOUT_MS = 10 * 1000;
export const PENDING_DOWNLOAD_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_VIDEO_HEIGHT = 720;
// Teto de cancelamento de um download geral (TikTok, Instagram, X, Facebook,
// Pinterest, GenDownload, cobalt). Acima disto o download é recusado em vez de
// encher o disco. É um teto próprio, separado do teto dos animes
// (`ANIME_DOCUMENT_LIMIT_MB`), que é maior.
export const MAX_FILE_SIZE_BYTES = 1536 * 1024 * 1024;
export const ATTP_APIS = [
	"https://api.urfake.com/attp?text=",
	"https://widipe.com/api/attp?text=",
	"https://rest.apibotwa.com/api/attp?text=",
];
