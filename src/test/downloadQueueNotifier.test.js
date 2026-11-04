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
 * @author Dev Yanik
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
process.env.SAIMO_CATALOG_BASE = "https://catalogo.saimo.test";

await mkdir(fakeDir, { recursive: true });
await writeFile(fakeBinary, fakeSource);
await chmod(fakeBinary, 0o755);

const { onMessagesUpsert } = await import("../middlewares/onMesssagesUpsert.js");
const { resetDownloadQueue } = await import("../services/downloadQueue.js");
const { resetMegacineSessions, handleMegacineReply, startMegacineFlow } =
  await import("../utils/megacineMenu.js");
const { limparCacheSaimo } = await import("../services/saimo.js");
const { extractDataFromMessage } = await import("../utils/index.js");
const { OWNER_LID } = await import("../config.js");

// O dono nunca é cobrado, o que tira os créditos da equação: o teste é sobre a
// fila, não sobre a carteira. Dois chats = dois utilizadores.
const CHAT_A = "fila-a@g.us";
const CHAT_B = "fila-b@g.us";

// Catálogo do saimo (TAB). "The Boys" tem DUAS temporadas: sem a segunda o
// fluxo saltaria a lista e arrancaria o download logo, e o teste nunca chegaria
// a ter a sessão no passo "episodios".
const BUSCA = [
  "The Boys\ts\tT\t2019",
  "The Boys Apresenta: Diabólicos\ts\tT\t2022",
].join("\n");

const SERIES_T = [
  "The Boys\t2019\t0\t2",
  "The Boys Apresenta: Diabólicos\t2022\t1\t1",
].join("\n");

const EPISODIOS_THE_BOYS = [
  "@The Boys\t2019",
  "1\t1\tdub\thttp://cdn.saimo.test/the-boys-s01e01.mp4",
  "1\t2\tdub\thttp://cdn.saimo.test/the-boys-s01e02.mp4",
  "2\t1\tdub\thttp://cdn.saimo.test/the-boys-s02e01.mp4",
].join("\n");

function stubRede() {
  return mock.method(globalThis, "fetch", async (url) => {
    const alvo = String(url);
    const responder = (corpo) => ({ ok: true, status: 200, text: async () => corpo });

    if (alvo.endsWith("/busca.txt")) return responder(BUSCA);
    if (alvo.endsWith("/series-T.txt")) return responder(SERIES_T);
    if (alvo.endsWith("/series-T-0.txt")) return responder(EPISODIOS_THE_BOYS);
    if (alvo.includes("cdn.saimo.test")) return responder("x");

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
  limparCacheSaimo();
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
