import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { after, before, test } from "node:test";
import { downloadWithGenDownload } from "../utils/genDownloader.js";
import { handleDownload } from "../commands/download.js";
import { downloadAudio, downloadVideo, downloadByCommand, resolveDownloadSource, setPendingDocOffer, handlePendingDocOffer } from "../services/downloader.js";
import command from "../commands/member/downloads/download.js";
import playVideo from "../commands/member/downloads/play-video.js";
import { findCommandImport, formatCommand } from "../utils/index.js";

let server;
let baseUrl;
const previousApiUrl = process.env.GENDOWNLOAD_API_URL;
const requests = [];
const mediaRequests = [];

before(async () => {
  server = createServer(async (request, response) => {
    if (request.url === "/api/extract") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      requests.push({ input, headers: request.headers });
      response.setHeader("Content-Type", "application/json");
      if (input.url.endsWith("/http-error")) {
        response.writeHead(400);
        response.end(JSON.stringify({ error: "Link indisponível" }));
        return;
      }
      if (input.url.endsWith("/api-error")) {
        response.end(JSON.stringify({ error: { message: "Vídeo privado" } }));
        return;
      }
      const formats = input.url.endsWith("/no-video") ? [] : [
        { label: "1080p", type: "video", ext: "mp4", url: `${baseUrl}/video?quality=1080` },
        { label: "480p", type: "video", ext: "mp4", url: `${baseUrl}/video?quality=480` },
        { label: "720p", type: "video", ext: "mp4", url: `${baseUrl}/video?quality=720` },
        { label: "Audio", type: "audio", ext: input.url.endsWith("/m4a") ? "m4a" : "mp3", url: `${baseUrl}/audio?format=${input.url.endsWith("/m4a") ? "m4a" : "mp3"}` },
      ];
      if (input.url.endsWith("/metadata-large")) formats[0].filesize = 101 * 1024 * 1024;
      if (input.url.endsWith("/metadata-all-large")) formats.forEach((format) => { format.filesize = 101 * 1024 * 1024; });
      if (input.url.endsWith("/large")) formats[0].url = `${baseUrl}/large`;
      if (input.url.endsWith("/image")) formats[0].url = `${baseUrl}/image`;
      response.end(JSON.stringify({ title: "Canção / Teste", author: "Canal", thumbnail: null, formats }));
      return;
    }

    mediaRequests.push(request.url);
    if (request.url === "/large") {
      response.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": 101 * 1024 * 1024 });
      response.end();
    } else if (request.url === "/image") {
      response.writeHead(200, { "Content-Type": "image/jpeg" });
      response.end("image-content");
    } else {
      response.writeHead(200, { "Content-Type": request.url?.startsWith("/audio") ? "application/octet-stream" : "video/mp4" });
      response.end("media-content");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.GENDOWNLOAD_API_URL = `${baseUrl}/api/extract`;
});

after(async () => {
  if (previousApiUrl === undefined) delete process.env.GENDOWNLOAD_API_URL;
  else process.env.GENDOWNLOAD_API_URL = previousApiUrl;
  server.close();
  await once(server, "close");
});

test("GenDownload recebe URL e salva o MP4 selecionado", async () => {
  const result = await downloadWithGenDownload(`${baseUrl}/source`);
  assert.equal(await readFile(result.filePath, "utf8"), "media-content");
  assert.equal(result.mimetype, "video/mp4");
  assert.equal(mediaRequests.at(-1), "/video?quality=1080");
  assert.deepEqual(requests.at(-1).input, { url: `${baseUrl}/source` });
  assert.equal(requests.at(-1).headers.accept, "application/json");
  assert.match(requests.at(-1).headers["content-type"], /application\/json/);
  await rm(result.filePath);
});

test("aliases com ! usam o comando de membro", async () => {
  for (const alias of ["!baixar", "!download"]) {
    const result = await findCommandImport(formatCommand(alias));
    assert.equal(result.type, "member");
    assert.equal(result.command.name, "baixar");
  }
});

test("menu seleciona resolução e áudio mantém extensão e MIME", async () => {
  const video = await downloadVideo(`${baseUrl}/source`, 480);
  assert.equal(mediaRequests.at(-1), "/video?quality=480");
  const audio = await downloadAudio(`${baseUrl}/source`);
  assert.equal(mediaRequests.at(-1), "/audio?format=mp3");
  assert.equal(audio.mimetype, "audio/mpeg");
  assert.match(audio.fileName, /\.mp3$/);
  const m4a = await downloadAudio(`${baseUrl}/m4a`);
  assert.equal(m4a.mimetype, "audio/mp4");
  assert.match(m4a.fileName, /\.m4a$/);
  await Promise.all([video, audio, m4a].map((result) => rm(result.filePath)));
});

test("play pesquisa antes do GenDownload mas aceita links diretos", async () => {
  const terms = [];
  const search = async (term, limit) => {
    terms.push([term, limit]);
    return [{ url: `${baseUrl}/source`, title: "Primeiro vídeo", artist: "Canal", thumbnail: null }];
  };
  const video = await downloadByCommand("play-video", "MC Hariel", search);
  assert.deepEqual(terms, [["MC Hariel", 1]]);
  assert.equal(requests.at(-1).input.url, `${baseUrl}/source`);

  const audio = await downloadByCommand("play-audio", "MC Hariel", search);
  assert.equal(mediaRequests.at(-1), "/audio?format=mp3");
  assert.equal(audio.title, "Primeiro vídeo");
  assert.equal(audio.artist, "Canal");

  const direct = await downloadByCommand("play-video", `${baseUrl}/source`, search);
  assert.equal(terms.length, 2);
  await Promise.all([video, audio, direct].map((result) => rm(result.filePath)));
  await assert.rejects(downloadByCommand("play-video", "sem resultado", async () => []), /Nenhum vídeo encontrado/);
});

test("play video pesquisa o primeiro resultado e abre o card de qualidade", async () => {
  const found = await resolveDownloadSource("play-video", "Minha pesquisa", async (term, limit) => {
    assert.equal(term, "Minha pesquisa");
    assert.equal(limit, 1);
    return [{ url: `${baseUrl}/source` }];
  });
  assert.equal(found.source, `${baseUrl}/source`);

  const sent = [];
  await playVideo.handle({
    socket: { sendMessage: async (_jid, content) => sent.push(content) },
    remoteJid: "play-video-test@g.us",
    userLid: "dono@lid",
    fullArgs: "https://www.youtube.com/watch?v=exemplo",
    sendReply: async () => {},
  });

  // O vídeo ainda não é baixado: primeiro vem o card interativo.
  const card = sent[0];
  assert.match(card.text, /┌─〔 📥 .*DOWNLOAD/);
  assert.match(card.text, /📌 \*Título:\* Vídeo/);
  assert.match(card.text, /🌐 \*Fonte:\* YouTube/);
  const buttons = card.interactiveButtons.map((button) => JSON.parse(button.buttonParamsJson));
  assert.equal(buttons[0].id, "vfmt:menu");
  assert.ok(
    buttons.some(({ copy_code }) => copy_code === "https://www.youtube.com/watch?v=exemplo"),
    "o card deve oferecer o link do vídeo",
  );
});

test("comando envia vídeo e apaga temporário mesmo com erro de envio", async () => {
  const messages = [];
  const sock = { sendMessage: async (_jid, data) => {
    messages.push(data);
    if (data.video) assert.equal(await readFile(data.video.url, "utf8"), "media-content");
  } };
  const message = { key: { remoteJid: "group@g.us" } };
  await command.handle({ socket: sock, webMessage: message, fullArgs: `${baseUrl}/source` });
  // Primeiro vem o aviso de download no molde único (com rodapé), depois o vídeo.
  assert.match(messages[0].text, /┌─〔 ⏳ .*CARREGANDO/);
  assert.ok(messages[0].text.endsWith("© Made by Yanik Uaite"));
  const videoMessage = messages.find((data) => data.video);
  assert.ok(videoMessage, "o comando deve enviar o vídeo baixado");
  assert.equal(mediaRequests.at(-1), "/video?quality=720");
  await assert.rejects(stat(videoMessage.video.url), { code: "ENOENT" });

  await handleDownload({ sendMessage: async (_jid, data) => {
    if (data.video) throw new Error("Falha WhatsApp");
    messages.push(data);
  } }, message, [`${baseUrl}/source`]);
  assert.match(messages.at(-1).text, /Falha WhatsApp/);
  assert.equal((await readdir(dirname(videoMessage.video.url))).length, 0);
});

test("erro da API, formato inválido e limite geram mensagens úteis", async () => {
  await assert.rejects(downloadWithGenDownload(`${baseUrl}/http-error`), /Link indisponível/);
  await assert.rejects(downloadWithGenDownload(`${baseUrl}/api-error`), /Vídeo privado/);
  await assert.rejects(downloadWithGenDownload(`${baseUrl}/no-video`), /Nenhum formato/);
  await assert.rejects(downloadWithGenDownload("not-a-url"), /URL válida/);
  const smaller = await downloadWithGenDownload(`${baseUrl}/metadata-large`);
  assert.equal(mediaRequests.at(-1), "/video?quality=720");
  await rm(smaller.filePath);
  await assert.rejects(downloadWithGenDownload(`${baseUrl}/metadata-all-large`), /100 MB/);
  await assert.rejects(downloadWithGenDownload(`${baseUrl}/large`), /100 MB/);
  await assert.rejects(downloadWithGenDownload(`${baseUrl}/image`), /mídia compatível/);
});

test("oferta de documento é respondida com 1 ou 2 e apaga o MP3", async (t) => {
  const { mkdtemp } = await import("node:fs/promises");
  const { writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "doc-offer-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const filePath = join(dir, "musica.mp3");
  await writeFile(filePath, "mp3-content");

  setPendingDocOffer("doc-chat", {
    filePath,
    fileName: "musica.mp3",
    title: "Título",
    artist: "Artista",
    thumbnail: null,
    mimetype: "audio/mpeg",
  });

  const documents = [];
  const replies = [];
  const handled = await handlePendingDocOffer({
    chatId: "doc-chat",
    text: "1",
    sendReply: async (text) => { replies.push(text); },
    sendAudioDocumentFromFile: async (path, fileName, title, artist, _thumb, asDocument, mimetype) => {
      documents.push({ path, fileName, title, artist, asDocument, mimetype });
    },
  });
  assert.equal(handled, true);
  assert.deepEqual(documents, [{
    path: filePath,
    fileName: "musica.mp3",
    title: "Título",
    artist: "Artista",
    asDocument: true,
    mimetype: "audio/mpeg",
  }]);
  await assert.rejects(stat(filePath), { code: "ENOENT" });

  // Recusa ("2") também consome a oferta e limpa o arquivo.
  await writeFile(filePath, "mp3-content");
  setPendingDocOffer("doc-chat-2", { filePath, mimetype: "audio/mpeg" });
  const refused = await handlePendingDocOffer({
    chatId: "doc-chat-2",
    text: "2",
    sendReply: async (text) => { replies.push(text); },
    sendAudioDocumentFromFile: async () => { throw new Error("não deveria enviar"); },
  });
  assert.equal(refused, true);
  await assert.rejects(stat(filePath), { code: "ENOENT" });

  // Texto qualquer não intercepta o fluxo dos comandos.
  const notHandled = await handlePendingDocOffer({
    chatId: "doc-chat-3",
    text: "olá",
    sendReply: async () => {},
    sendAudioDocumentFromFile: async () => {},
  });
  assert.equal(notHandled, false);
});
