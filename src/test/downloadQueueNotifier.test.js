/**
 * A fila de downloads avisa quem espera — e o aviso tem de chegar ao chat.
 *
 * Regressão do defeito: os fluxos de menu (anime, megacine, áudio/vídeo) são
 * despachados pelo middleware, e não pelo `dynamicCommand` — o único sítio que
 * abria o contexto da fila. O download era serializado na mesma, mas o
 * `sendReply` ficava fora do contexto, pelo que "você é o 2.º da fila" e
 * "chegou a sua vez" nunca saíam. O utilizador esperava em silêncio.
 *
 * O teste chama `onMessagesUpsert` a sério, com o binário do yt-dlp trocado por
 * um falso que só dorme: assim o primeiro download segura a única vaga e o
 * segundo tem mesmo de esperar na fila.
 *
 * Dois chats, e não dois pedidos no mesmo chat, porque a sessão do Megacine é
 * largada no início do download: o segundo pedido do mesmo utilizador não
 * chegaria à fila. Dois utilizadores distintos é o cenário que o dono relatou.
 *
 * @author Dev Gui
 */
import assert from "node:assert/strict";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test, mock } from "node:test";

// O binário falso tem de existir antes de qualquer import ler `src/config.js`.
const fakeDir = path.join(process.cwd(), "assets", "temp", "queue-fake-ytdlp");
const fakeBinary = path.join(fakeDir, "yt-dlp-fake");

const fakeSource = `#!/usr/bin/env node
import fs from "node:fs";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("2026.01.01");
  process.exit(0);
}

// Pedido de metadados (usado para estimar o custo por duração): responde JSON
// em vez de escrever ficheiro. Sem este ramo o falso tratava os argumentos como
// um caminho de saída e deixava um ficheiro com o nome da flag no diretório.
if (args.includes("--dump-single-json")) {
  console.log(JSON.stringify({ title: "Teste", duration: 60, filesize: 1024 }));
  process.exit(0);
}

// Um download "demora": é o que segura a vaga e faz o segundo pedido esperar.
setTimeout(() => {
  const template = args[args.indexOf("-o") + 1] || "out.%(ext)s";
  const filePath = template.replace("%(ext)s", args.includes("-x") ? "mp3" : "mp4");
  fs.writeFileSync(filePath, Buffer.alloc(32, 97));
  console.log(filePath);
  process.exit(0);
}, 400);
`;

process.env.YTDLP_PATH = fakeBinary;
process.env.DOWNLOAD_CONCURRENCY = "1";
// Curto para o segundo pedido não esperar 5 min no caso de falha.
process.env.DOWNLOAD_QUEUE_TIMEOUT_MS = "15000";

await mkdir(fakeDir, { recursive: true });
await writeFile(fakeBinary, fakeSource);
await chmod(fakeBinary, 0o755);

const { onMessagesUpsert } = await import("../middlewares/onMesssagesUpsert.js");
const { resetDownloadQueue } = await import("../services/downloadQueue.js");
const { resetMegacineSessions, handleMegacineReply, startMegacineFlow } =
  await import("../utils/megacineMenu.js");
const { extractDataFromMessage } = await import("../utils/index.js");
const { OWNER_LID } = await import("../config.js");

// O dono nunca é cobrado, o que tira os créditos da equação: o teste é sobre a
// fila, não sobre a carteira. Dois chats = dois utilizadores.
const CHAT_A = "fila-a@g.us";
const CHAT_B = "fila-b@g.us";

const BOTAO_SERIE = `<a href="#" id="assistirplaybutton" class="play-btn">Assistir Agora</a>`;
const HTML_BUSCA = `<article class="card"><a href="https://www.megacine.online/series/the-boys"><h3 class="card-title">The Boys</h3></a></article>`;
// Duas temporadas: sem a segunda o fluxo salta a lista e arranca o download
// logo, e o teste nunca chegaria a ter a sessão no passo "episodios".
const HTML_SERIE = `
<div class="episodes-modern-list episodes-modern-season-content active" data-season="1"><a href="https://www.megacine.online/series/the-boys/temporada-01/episodio-01"></a></div>
<div class="episodes-modern-list episodes-modern-season-content" data-season="2"><a href="https://www.megacine.online/series/the-boys/temporada-02/episodio-01"></a></div>
`;
const HTML_EPISODIO = `<script>var urlConfig = { base: "https://forks-series.madfirebox.shop", slug: "the-boys", tipo: "series", temporada: 1, episodio: 1 };</script>`;

function stubRede() {
  return mock.method(globalThis, "fetch", async (url) => {
    const alvo = String(url);
    const responder = (corpo) => ({ ok: true, status: 200, text: async () => corpo });

    if (alvo.includes("/search/")) return responder(HTML_BUSCA);
    if (/\/temporada-\d+\/episodio-\d+/.test(alvo)) return responder(HTML_EPISODIO);
    if (alvo.endsWith("/series/the-boys")) return responder(BOTAO_SERIE + HTML_SERIE);
    if (alvo.includes(".m3u8")) return responder("#EXTM3U\n#EXTINF:10,\nseg.ts\n");

    return { ok: false, status: 404, text: async () => "404" };
  });
}

const socketFalso = {
  sendMessage: async () => ({ key: { id: "m" } }),
  groupMetadata: async () => ({ owner: OWNER_LID, participants: [{ id: OWNER_LID }] }),
  sendPresenceUpdate: async () => {},
};

/** Abre a sessão do Megacine num chat e pára no passo dos episódios. */
async function abrirAteEpisodios(chatId, replies) {
  const sendReply = async (t) => replies.push(String(t));

  await startMegacineFlow({
    socket: socketFalso,
    chatId,
    ownerLid: OWNER_LID,
    ownerName: "Teste",
    sendReply,
    nome: "the boys",
    textOnly: true,
  });
  await handleMegacineReply({
    socket: socketFalso,
    chatId,
    senderLid: OWNER_LID,
    text: "mgc:an:0",
    sendReply,
  });
  await handleMegacineReply({
    socket: socketFalso,
    chatId,
    senderLid: OWNER_LID,
    text: "mgc:sea:0",
    sendReply,
  });
}

/** Mensagem de texto, como o Baileys a entrega. */
function mensagem(chatId, texto, id) {
  return {
    key: { remoteJid: chatId, fromMe: false, id, participant: OWNER_LID },
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: "Teste",
  };
}

/** Corre uma mensagem pelo middleware a sério, recolhendo o que vai para o chat. */
async function enviarPeloMiddleware(chatId, texto, replies, id) {
  const socket = {
    ...socketFalso,
    sendMessage: async (jid, conteudo) => {
      if (conteudo?.text) replies.push(String(conteudo.text));
      return { key: { id: "m" } };
    },
  };

  const webMessage = mensagem(chatId, texto, id);
  // Sem isto o teste podia passar por o handler nem ter sido chamado.
  assert.equal(extractDataFromMessage(webMessage).fullMessage, texto);

  await onMessagesUpsert({
    socket,
    messages: [webMessage],
    startProcess: Date.now(),
  });
}

test.beforeEach(() => {
  resetDownloadQueue();
  resetMegacineSessions();
});

test.afterEach(() => mock.restoreAll());

after(() => rm(fakeDir, { recursive: true, force: true }));

test("o aviso de fila chega ao chat de quem espera", async () => {
  stubRede();

  const repliesA = [];
  const repliesB = [];

  await abrirAteEpisodios(CHAT_A, repliesA);
  await abrirAteEpisodios(CHAT_B, repliesB);

  // Os dois pedidos entram em simultâneo pelo middleware: o primeiro ocupa a
  // única vaga e o segundo tem de esperar na fila.
  const primeiro = enviarPeloMiddleware(CHAT_A, "mgc:ep:0", repliesA, "d1");
  const segundo = enviarPeloMiddleware(CHAT_B, "mgc:ep:0", repliesB, "d2");

  await Promise.allSettled([primeiro, segundo]);

  const textoB = repliesB.join("\n");
  assert.match(
    textoB,
    /fila/i,
    "quem espera tem de ser avisado de que está na fila, e o aviso tem de sair do middleware",
  );
  assert.match(
    textoB,
    /Chegou a sua vez|Baixando/i,
    "o download tem de arrancar, não ficar preso",
  );
  assert.ok(
    repliesA.some((t) => /Baixando/i.test(t)),
    "o primeiro download arranca sem esperar",
  );
});
