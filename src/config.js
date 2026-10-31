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
// com disco efémero (Cloady, Render, Fly) o estado só sobrevive se ficar num
// volume persistente, e cada host monta o volume num caminho diferente. Sem o
// override, apontar o volume para outro sítio obrigava a mexer no código.
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
export const MAIN_MENU_CHANNEL_URL =
  process.env.MAIN_MENU_CHANNEL_URL ||
  "https://www.youtube.com/@devgui_?sub_confirmation=1";

// Imagem do cabeçalho: caminho local OU URL https. Vazio = card sem imagem.
export const MAIN_MENU_IMAGE =
  process.env.MAIN_MENU_IMAGE ||
  path.join(ASSETS_DIR, "images", "takeshi-bot.png");

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
export const LINKER_BASE_URL = "https://linker.devgui.dev/api";

// Obtenha sua chave em: https://linker.devgui.dev.
// Se não configurar esta chave, o bot usa automaticamente o token da Spider X API.
export const LINKER_API_KEY = "seu_token_aqui";

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
export const GROQ_TEMPERATURE = 0.6;
export const GROQ_TOP_P = 1;
export const GROQ_MAX_TOKENS = 1024;

// Quantas mensagens do histórico de cada conversa são enviadas ao modelo.
export const GROQ_HISTORY_SIZE = 10;

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
// (variável de ambiente do Render, por exemplo); o ambiente tem prioridade.
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

// Custo em créditos por comando (nome oficial do comando).
// Comandos de membro que não estão aqui gastam DEFAULT_COMMAND_CREDITS.
export const COMMAND_CREDITS = {
  // Downloads
  "tik-tok": 7,
  "tik-tok-audio": 6,
  "instagram": 7,
  "facebook": 7,
  "pinterest": 6,
  "x-twitter": 7,
  "play-video": 8,
  "play-audio": 7,
  "baixar": 7,
  "anime": 2,
  "megacine": 2,
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
export const ANIME_EPISODE_CREDITS = 20;

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

// Quantos downloads correm ao mesmo tempo. O excedente espera na fila em vez de
// dividir a banda com os outros. 1 serializa tudo.
export const DOWNLOAD_CONCURRENCY = Number(
  process.env.DOWNLOAD_CONCURRENCY || 2,
);

// Tempo máximo na fila antes de desistir (ms). Evita esperas sem fim quando o
// downloader à frente encrava.
export const DOWNLOAD_QUEUE_TIMEOUT_MS = Number(
  process.env.DOWNLOAD_QUEUE_TIMEOUT_MS || 5 * 60 * 1000,
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
// YT-DLP (downloader local, recomendado no Render/Docker)
// ==========================================================================
// O binário "yt-dlp_linux" é instalado pelo Dockerfile (e por
// "npm run setup:ytdlp" em hosts sem Docker). Quando ele não existe, os
// downloads continuam funcionando pela API GenDownload (fallback).
export const YTDLP_ENABLED = process.env.YTDLP_ENABLED !== "false";
export const YTDLP_PATH = process.env.YTDLP_PATH || "";
// Teto de tempo de UMA execução do yt-dlp. 15 min por omissão: um episódio de
// 24 min em 480p (~95 MB) desce a ~7 MB/min de alguns hosts, o que não cabia
// nos 5 min anteriores — o processo era morto a meio, sem stderr, e o
// utilizador só via o comando (ver `friendlyError` em `src/services/ytdlp.js`).
// Ajustável por YTDLP_TIMEOUT_MS; valor não numérico ou <= 0 cai no default.
const ytdlpTimeoutMs = Number(process.env.YTDLP_TIMEOUT_MS);
export const YTDLP_TIMEOUT_MS =
  Number.isFinite(ytdlpTimeoutMs) && ytdlpTimeoutMs > 0
    ? ytdlpTimeoutMs
    : 15 * 60 * 1000;
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
// host — que em Render/Cloady/Fly/Railway é efémero e apagava tudo a cada
// deploy. Sem a variável, o bot mantém o comportamento antigo (JSON em disco),
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
// ANIMES (fontes de streaming via @consumet/extensions, em processo)
// ==========================================================================
// A API pública `api.consumet.org` foi DESATIVADA e o provider HiAnime fechou
// em definitivo (março de 2026), pelo que apontar para um servidor Consumet já
// não resolveria. Em vez disso, a biblioteca `@consumet/extensions` corre
// DENTRO do bot (sem servidor) e extrai os links de streaming de providers
// vivos; o yt-dlp baixa o m3u8 resultante.
//
// ANIME_PROVIDERS aceita uma lista separada por vírgulas, por ordem de
// preferência. Cada provider é tentado até um devolver o episódio.
//
// A lista predefinida é `meusanimes` APENAS: os restantes providers estão
// DESATIVADOS por agora, para o fluxo depender de uma só fonte e os erros serem
// atribuíveis. Os providers continuam implementados e registados — reativar é
// só acrescentar nomes a esta lista (ou à variável de ambiente ANIME_PROVIDERS),
// sem tocar em código.
//
// Os nomes conhecidos e a razão de cada um:
//
// - `meusanimes` (ATIVO) responde a IPs de datacenter sem qualquer desafio
//   Cloudflare, agrupa temporadas na própria página e serve o episódio pelo
//   player do Blogger (que o projeto já lê). Publica 360p (~89 MB num episódio
//   de 23 min) e 720p (~285 MB) como degraus separados, pelo que o menu de
//   qualidades deixa o utilizador escolher;
// - `animesonlinehd` tem DUBLAGEM PT-BR real e é estável: responde a IPs de
//   datacenter sem Cloudflare e serve 360p (~75 MB num episódio de 24 min). A
//   imagem é menor do que a dos outros;
// - `animegg` é o mais rápido (HTML estático, sem browser) e entrega H.264 num
//   MP4 direto; falha em ~1 de cada 8 episódios com `videoSources = []`;
// - `anitube` serve HLS H.264, mas só publica 720p (~257 MB num episódio de
//   24 min): só resolve episódios curtos;
// - `animeheaven` publica MP4 720p nativo (~95–128 MB);
// - `anikoto` só publica 1080p (HLS), o que obriga a baixar grande e a reduzir
//   localmente.
//
// `animegg`, `anitube`, `anikoto`, `animeheaven`, `animesonlinehd` e
// `meusanimes` são extraídos diretamente pelo bot (`src/services/*.js`) e
// respondem a IPs de datacenter. Os restantes vêm da biblioteca e servem de
// alternativa (AnimeUnity funciona de IP residencial e de alguns datacenters).
export const ANIME_PROVIDERS = (
  process.env.ANIME_PROVIDERS || "meusanimes"
)
  .split(",")
  .map((nome) => nome.trim().toLowerCase())
  .filter(Boolean);

// A biblioteca NÃO define User-Agent, pelo que o axios envia "axios/1.x" — e o
// Cloudflare (que está à frente de todos estes sites) bloqueia esse agente em
// IPs de datacenter, como o Render. Sem estes cabeçalhos a pesquisa falha com
// "nenhuma fonte respondeu". Isto é o mesmo tipo de bloqueio que o YouTube já
// faz a IPs de datacenter.
export const ANIME_USER_AGENT =
  process.env.ANIME_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
export const ANIME_ACCEPT_LANGUAGE = process.env.ANIME_ACCEPT_LANGUAGE || "en-US,en;q=0.9";

// Escape hatch para quando o IP do host está bloqueado de vez (Cloudflare
// desafia datacenter mesmo com User-Agent de browser): um proxy HTTP
// residencial, no formato http://user:pass@host:port.
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

// O comando serve só conteúdo episódico (séries, doramas e animes). Filmes são
// um download único de duas horas, com outro perfil de uso, e ficaram fora por
// decisão do dono do bot. A lista é configurável para o dia em que isso mudar.
export const MEGACINE_TIPOS_EXCLUIDOS = (
  process.env.MEGACINE_TIPOS_EXCLUIDOS || "filmes"
)
  .split(",")
  .map((tipo) => tipo.trim().toLowerCase())
  .filter(Boolean);

// Custo por episódio baixado. A pesquisa e o menu são baratos
// (`COMMAND_CREDITS.megacine`), porque só pesquisar não gasta banda — o gasto
// real é o download.
export const MEGACINE_DOWNLOAD_CREDITS = Number(
  process.env.MEGACINE_DOWNLOAD_CREDITS || 25,
);

// Teto do download. Um episódio de série fica bem dentro do teto dos animes
// (300 MB), que já cobre um episódio longo em boa qualidade.
export const MEGACINE_MAX_DOWNLOAD_BYTES =
  Number(process.env.MEGACINE_MAX_DOWNLOAD_MB || 300) * 1024 * 1024;

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
// 300 MB: o envio mantém em disco o download e a cópia encriptada do Baileys,
// ou seja ~2x o tamanho (300 MB -> ~600 MB). O plano gratuito do Cloady dá 1 GB
// de RAM e 5 GB de disco, o que aguenta o dobro do que o Render Starter (512 MB)
// aguentava. O valor continua configurável para hosts mais apertados.
export const ANIME_DOCUMENT_LIMIT_MB = Number(
  process.env.ANIME_DOCUMENT_LIMIT_MB || 300,
);
export const ANIME_MAX_DOWNLOAD_BYTES = ANIME_DOCUMENT_LIMIT_MB * 1024 * 1024;

// Resolução máxima do download de animes. O provider entrega um m3u8 com várias
// faixas (240p–1080p) e, sem limite, o yt-dlp escolhe a maior (1080p): um
// episódio de 24 min passa de 200 MB e o envio acaba cancelado. Fixar 480p
// mantém o episódio dentro do limite. Se a faixa de 480p não existir, o seletor
// do yt-dlp cai para a melhor disponível em vez de falhar.
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
// A faixa é um booleano nos sites ("dubbed" ou não), mas o IDIOMA dessa dublagem
// depende do site: o `meusanimes`, o `animesonlinehd` e o `anitube` são sites
// brasileiros (a dublagem é PT-BR), enquanto o `animegg` é um site inglês — o
// "Dubbed" dele é dublagem inglesa. Sem esta distinção, pedir "Dublado" podia
// entregar áudio em inglês com o rótulo em português.
//
// É esta lista que permite procurar a dublagem PT-BR PRIMEIRO: com a faixa
// dublada pedida, estes providers passam à frente na pesquisa e no fallback.
// Ajuste se um site mudar de idioma ou se um provider PT-BR novo for adicionado.
export const ANIME_PT_DUB_PROVIDERS = (
  process.env.ANIME_PT_DUB_PROVIDERS || "meusanimes,animesonlinehd,anitube"
)
  .split(",")
  .map((nome) => nome.trim().toLowerCase())
  .filter(Boolean);

// Teto do provider AnimeHeaven, que publica 720p nativo (~112–164 MB): o
// episódio já cabe no limite de 200 MB, por isso não há razão para o degradar
// para 480p. Mantém-se configurável para o caso de episódios mais pesados.
export const ANIME_HEAVEN_MAX_HEIGHT =
  Number(process.env.ANIME_HEAVEN_MAX_HEIGHT) || 720;

// Resolução preferida no provider AnimeGG, que publica 360p/480p/720p.
//
// 480p por padrão: o mesmo episódio mede 31 MB em 360p, 80 MB em 480p e 201 MB
// em 720p, ou seja o 720p passa o teto de 200 MB e o 360p degrada sem
// necessidade. O provider mede cada degrau por `Content-Length` e só desce/sobe
// se o preferido não couber — ver `escolherDegrau` em `src/services/animegg.js`.
export const ANIME_GG_MAX_HEIGHT = Number(process.env.ANIME_GG_MAX_HEIGHT) || 480;

export const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
export const AI_TIMEOUT_MS = 30 * 1000;
export const ATTP_TIMEOUT_MS = 10 * 1000;
export const PENDING_DOWNLOAD_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_VIDEO_HEIGHT = 720;
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
export const ATTP_APIS = [
	"https://api.urfake.com/attp?text=",
	"https://widipe.com/api/attp?text=",
	"https://rest.apibotwa.com/api/attp?text=",
];
