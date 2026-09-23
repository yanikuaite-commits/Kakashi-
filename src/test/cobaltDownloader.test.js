import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { after, before, test } from "node:test";
import { downloadWithCobalt } from "../utils/cobaltDownloader.js";
import { handleDownload } from "../commands/download.js";
import { downloadAudio, downloadVideo, downloadByCommand, setPendingResolution, handlePendingResolution } from "../services/downloader.js";
import command from "../commands/member/downloads/download.js";
import { findCommandImport, formatCommand } from "../utils/index.js";

let server;
let baseUrl;
const previousApiUrl = process.env.COBALT_API_URL;
const requests = [];

before(async () => {
  server = createServer(async (request, response) => {
    if (request.url === "/api") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      requests.push({ input, headers: request.headers });
      response.setHeader("Content-Type", "application/json");
      if (input.url.endsWith("/http-error")) {
        response.writeHead(400);
        response.end(JSON.stringify({ status: "error", error: { message: "Link indisponível" } }));
      } else if (input.url.endsWith("/api-error")) {
        response.end(JSON.stringify({ status: "error", error: { code: "api.content.unsupported" } }));
      } else if (input.url.endsWith("/picker")) {
        response.end(JSON.stringify({ status: "picker", picker: [] }));
      } else {
        const media = input.url.endsWith("/large") ? "large" : input.url.endsWith("/image") ? "image" : input.downloadMode === "audio" ? "audio" : "video";
        response.end(JSON.stringify({ status: "redirect", url: `${baseUrl}/${media}` }));
      }
    } else if (request.url === "/large") {
      response.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": 101 * 1024 * 1024 });
      response.end();
    } else if (request.url === "/image") {
      response.writeHead(200, { "Content-Type": "image/jpeg" });
      response.end("image-content");
    } else {
      response.writeHead(200, { "Content-Type": request.url === "/audio" ? "audio/mpeg" : "video/mp4" });
      response.end("media-content");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.COBALT_API_URL = `${baseUrl}/api`;
});

after(async () => {
  if (previousApiUrl === undefined) delete process.env.COBALT_API_URL;
  else process.env.COBALT_API_URL = previousApiUrl;
  server.close();
  await once(server, "close");
});

test("Cobalt envia URL em JSON e retorna o arquivo de vídeo", async () => {
  const result = await downloadWithCobalt(`${baseUrl}/source`);
  assert.equal(await readFile(result.filePath, "utf8"), "media-content");
  assert.equal(result.mimetype, "video/mp4");
  assert.deepEqual(requests.at(-1).input, { url: `${baseUrl}/source` });
  assert.equal(requests.at(-1).headers.accept, "application/json");
  assert.match(requests.at(-1).headers["content-type"], /application\/json/);
  await rm(result.filePath);
});

test("aliases com ! usam o registro de comandos de membro", async () => {
  for (const alias of ["!baixar", "!download"]) {
    const result = await findCommandImport(formatCommand(alias));
    assert.equal(result.type, "member");
    assert.equal(result.command.name, "baixar");
  }
});

test("reaproveita menu de resolução e conversão para áudio", async () => {
  const video = await downloadVideo(`${baseUrl}/source`, 480);
  assert.equal(requests.at(-1).input.videoQuality, "480");
  const audio = await downloadAudio(`${baseUrl}/source`);
  assert.equal(requests.at(-1).input.downloadMode, "audio");
  assert.equal(audio.mimetype, "audio/mpeg");
  assert.equal(audio.fileName, "musica.mp3");
  await rm(video.filePath);
  await rm(audio.filePath);
});

test("play resolve um termo antes do Cobalt e mantém links diretos", async () => {
  const terms = [];
  const search = async (term, limit) => {
    terms.push([term, limit]);
    return [{ url: `${baseUrl}/source`, title: "Primeiro vídeo", artist: "Canal", thumbnail: null }];
  };
  const video = await downloadByCommand("play-video", "MC Hariel", search);
  assert.deepEqual(terms, [["MC Hariel", 1]]);
  assert.equal(requests.at(-1).input.url, `${baseUrl}/source`);

  const audio = await downloadByCommand("play-audio", "MC Hariel", search);
  assert.equal(requests.at(-1).input.downloadMode, "audio");
  assert.equal(audio.title, "Primeiro vídeo");
  assert.equal(audio.artist, "Canal");

  const direct = await downloadByCommand("play-video", `${baseUrl}/source`, search);
  assert.equal(terms.length, 2);
  await Promise.all([video, audio, direct].map((result) => rm(result.filePath)));
  await assert.rejects(downloadByCommand("play-video", "sem resultado", async () => []), /Nenhum vídeo encontrado/);
});

test("comando mantém envio e apaga arquivo após sucesso ou falha", async () => {
  const messages = [];
  const sock = { sendMessage: async (_jid, data) => {
    messages.push(data);
    if (data.video) assert.equal(await readFile(data.video.url, "utf8"), "media-content");
  } };
  const message = { key: { remoteJid: "group@g.us" } };
  await command.handle({ socket: sock, webMessage: message, fullArgs: `${baseUrl}/source` });
  assert.equal(messages[0].caption, "Vídeo baixado via Cobalt");
  await assert.rejects(stat(messages[0].video.url), { code: "ENOENT" });

  await handleDownload({ sendMessage: async (_jid, data) => {
    if (data.video) throw new Error("Falha WhatsApp");
    messages.push(data);
  } }, message, [`${baseUrl}/source`]);
  assert.match(messages.at(-1).text, /Falha WhatsApp/);
  assert.equal((await readdir(dirname(messages[0].video.url))).length, 0);
});

test("erro HTTP, erro Cobalt e picker geram mensagens úteis", async () => {
  await assert.rejects(downloadWithCobalt(`${baseUrl}/http-error`), /Link indisponível/);
  await assert.rejects(downloadWithCobalt(`${baseUrl}/api-error`), /api.content.unsupported/);
  await assert.rejects(downloadWithCobalt(`${baseUrl}/picker`), /Não foi possível baixar/);
  await assert.rejects(downloadWithCobalt("not-a-url"), /URL válida/);
  await assert.rejects(downloadWithCobalt(`${baseUrl}/large`), /100 MB/);
  await assert.rejects(downloadWithCobalt(`${baseUrl}/image`), /mídia compatível/);
});

test("menu pendente remove arquivo mesmo se envio falhar", async () => {
  setPendingResolution("chat", `${baseUrl}/source`);
  let pendingPath;
  const replies = [];
  const handled = await handlePendingResolution({
    chatId: "chat",
    text: "3",
    sendReply: async (text) => { replies.push(text); },
    sendVideoFromFile: async (filePath) => {
      pendingPath = filePath;
      throw new Error("Falha no envio");
    },
  });
  assert.equal(handled, true);
  assert.match(replies.at(-1), /Falha no envio/);
  await assert.rejects(stat(pendingPath), { code: "ENOENT" });
});
