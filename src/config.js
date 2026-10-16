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
export const DATABASE_DIR = path.resolve(__dirname, "..", "database");

// Diretório de arquivos de mídia.
export const ASSETS_DIR = path.resolve(__dirname, "..", "assets");

// Diretório de arquivos temporários.
export const TEMP_DIR = path.resolve(__dirname, "..", "assets", "temp");

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

// Configuracoes do projeto e APIs. Este projeto foi solicitado sem uso de .env.
export const HF_TOKEN = "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";

// ==========================================================================
// GROQ (IA do bot: chat e transcrição)
// ==========================================================================
// Crie a sua chave em: https://console.groq.com/keys
// A chave fica em branco aqui para você preencher. Se você definir GROQ_API_KEY
// no ambiente do bot, o valor do ambiente tem prioridade sobre este.
export const GROQ_API_KEY = "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";

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
// Deixe em branco aqui para preencher depois; se você definir GEMINI_API_KEY
// no ambiente do bot, o valor do ambiente tem prioridade.
// IMPORTANTE: a geração de IMAGEM não tem free tier na Google (exige billing
// ativado na conta).
export const GEMINI_API_KEY = "AQ.Ab8RN6LurSB7uP0Kt-uaCJnEeJJLkwZMqsFS85XeD_kyXP3rzA";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

// Geração de imagem (a doc usa a versão v1 nesses modelos).
export const GEMINI_IMAGE_API = `${GEMINI_BASE_URL}/v1/models`;
export const GEMINI_IMAGE_MODEL = "gemini-nano-banana-2.1";
export const GEMINI_IMAGE_ASPECT_RATIO = "1:1";
export const GEMINI_IMAGE_SIZE = "1K";
export const GEMINI_IMAGE_TIMEOUT_MS = 60 * 1000;

// Transcrição de áudio (comando .transcrever).
// Limite de upload do free tier: 25 MB.
export const GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
export const GROQ_TRANSCRIPTION_LANGUAGE = "pt";
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
export const GITHUB_REPOSITORY = "yanikuaite-commits/Kakashi-";
export const GITHUB_BRANCH = "main";
export const GITHUB_BACKUP_PATH = "backups/kakashi-database.tar.gz";
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
export const DAILY_FREE_CREDITS = 30;

// Contato do dono para receber pagamento e recarregar créditos.
// Use o número com DDI e DDD, apenas dígitos (ex: "258840000000").
export const OWNER_CONTACT = "";

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
];

// Custo em créditos por comando (nome oficial do comando).
// Comandos de membro que não estão aqui gastam DEFAULT_COMMAND_CREDITS.
export const COMMAND_CREDITS = {
  // Downloads
  "tik-tok": 3,
  "tik-tok-audio": 2,
  "instagram": 3,
  "facebook": 3,
  "pinterest": 2,
  "x-twitter": 3,
  "play-video": 4,
  "play-audio": 3,
  "baixar": 3,
  "yt-search": 1,
  // Inteligência artificial
  "deepseek": 2,
  "gemini": 2,
  "gpt-5-mini": 3,
  "flux": 4,
  "ia-sticker": 5,
  "tts": 2,
  // Mídia, stickers e utilidades
  "sticker": 1,
  "rename": 1,
  "attp": 1,
  "ttp": 1,
  "brat": 1,
  "bratvid": 3,
  "to-mp3": 2,
  "togif": 2,
  "toimage": 1,
  "transcrever": 4,
  "removebg": 3,
  "gerar-link": 2,
};

// Custo de qualquer outro comando de membro não listado acima.
export const DEFAULT_COMMAND_CREDITS = 1;

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
export const YTDLP_TIMEOUT_MS = 5 * 60 * 1000;
// Cookies (formato Netscape) para o YouTube aceitar a sessão em IP de datacenter.
export const YTDLP_COOKIES_PATH = process.env.YTDLP_COOKIES_PATH || "";
export const YTDLP_PROXY = process.env.YTDLP_PROXY || "";
// Runtime JavaScript para os desafios do YouTube (Node 22+). Vazio desativa.
export const YTDLP_JS_RUNTIME = process.env.YTDLP_JS_RUNTIME ?? "node";
export const YTDLP_IMPERSONATE = process.env.YTDLP_IMPERSONATE || "";
export const YTDLP_EXTRACTOR_ARGS = process.env.YTDLP_EXTRACTOR_ARGS || "";

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
