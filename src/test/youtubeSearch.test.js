import assert from "node:assert/strict";
import { test } from "node:test";
import { searchYouTube } from "../services/youtube-search.js";
import { formatYouTubeResult, sendYouTubeResults } from "../commands/member/search/yt-search.js";

const videos = Array.from({ length: 7 }, (_, index) => ({
  type: "video",
  id: `sample0000${index}`,
  title: `Vídeo ${index + 1}`,
  length: { simpleText: `3:0${index}` },
  thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/sample0000${index}/1.jpg` }] },
  channelTitle: "Canal",
}));

test("filtra canais, vídeos inválidos e retorna no máximo cinco resultados", async () => {
  const calls = [];
  const searcher = {
    GetListByKeyword: async (...args) => {
      calls.push(args);
      return { items: [{ type: "channel", id: "canal" }, ...videos, { type: "video", id: "inválido" }] };
    },
  };

  const results = await searchYouTube("  MC Hariel  ", 5, searcher);
  assert.deepEqual(calls[0], ["MC Hariel", false, 10, [{ type: "video" }]]);
  assert.equal(results.length, 5);
  assert.deepEqual(results[0], {
    title: "Vídeo 1",
    url: "https://www.youtube.com/watch?v=sample00000",
    duration: "3:00",
    thumbnail: "https://i.ytimg.com/vi/sample00000/1.jpg",
    artist: "Canal",
  });
  assert.match(formatYouTubeResult(results[0], 0), /RESULTADO 1.*\n━━━━━━━━━━━━━━━━━━\n📌 \*Vídeo 1\*\n⏱️ 3:00\n🔗 https:\/\/www.youtube.com\/watch\?v=sample00000/);
});

test("cada resultado envia foto e texto separados e continua sem foto", async () => {
  const results = await searchYouTube("teste", 3, {
    GetListByKeyword: async () => ({ items: videos }),
  });
  const sent = [];
  await sendYouTubeResults(results, {
    prefix: "!",
    sendImageFromURL: async (url, caption, mentions, quoted) => {
      sent.push({ image: url, caption, mentions, quoted });
      if (url.includes("sample00001")) throw new Error("thumbnail indisponível");
    },
    sendReply: async (text) => sent.push({ text }),
  });

  assert.equal(sent.length, 6);
  assert.equal(sent[0].image, results[0].thumbnail);
  assert.equal(sent[0].quoted, false);
  assert.match(sent[1].text, /RESULTADO 1/);
  assert.match(sent[3].text, /RESULTADO 2/);
  assert.match(sent[5].text, /RESULTADO 3/);
  assert.match(sent[5].text, /!play-audio ou !play-video/);
});

test("consulta vazia, pesquisa sem resultados e falha remota têm resposta definida", async () => {
  await assert.rejects(searchYouTube(" "), /termo/);
  assert.deepEqual(await searchYouTube("inexistente", 5, {
    GetListByKeyword: async () => ({ items: [] }),
  }), []);
  await assert.rejects(searchYouTube("teste", 5, {
    GetListByKeyword: async () => { throw new Error("rede"); },
  }), /Não foi possível pesquisar no YouTube agora/);
});
