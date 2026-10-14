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
export const HF_TOKEN = process.env.HF_TOKEN || "";
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
export const GITHUB_REPOSITORY = "yanikuaite-commits/Kakashi-";
export const GITHUB_BRANCH = "main";
export const GITHUB_BACKUP_PATH = "backups/kakashi-database.tar.gz";
export const PAIRING_SECRET = "KakashiPairing2026";
export const PAIRING_NUMBER = "";

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
export const HF_MODELS = [
	"mistralai/Mistral-7B-Instruct-v0.3",
	"TinyLlama/TinyLlama-1.1B-Chat-v1.0",
	"microsoft/Phi-3-mini-4k-instruct",
];
