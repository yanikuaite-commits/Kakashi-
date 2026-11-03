/**
 * Testes do anúncio das falas no arranque dos downloads.
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import { after, describe, it } from "node:test";
import { announceDownload, withKakashiVoice } from "../services/kakashiVoice.js";
import { downloadAudio, downloadVideo } from "../services/downloader.js";

// Aponta a API de fallback para uma porta local fechada: a ligação é recusada
// de imediato, por isso os testes não fazem rede real nem esperam pelo timeout
// da API pública. O anúncio sai antes do download, por isso um download que
// falha serve para o verificar.
const API_ORIGINAL = process.env.GENDOWNLOAD_API_URL;
process.env.GENDOWNLOAD_API_URL = "http://127.0.0.1:9/extract";

after(() => {
  if (API_ORIGINAL === undefined) delete process.env.GENDOWNLOAD_API_URL;
  else process.env.GENDOWNLOAD_API_URL = API_ORIGINAL;
});

const URL_MORTA = "https://exemplo.invalido/media";

describe("announceDownload", () => {
  it("fora de um contexto não envia nada e não rebenta", async () => {
    assert.strictEqual(await announceDownload("video"), false);
  });

  it("envia a fala do vídeo dentro do contexto", async () => {
    const enviados = [];

    const saiu = await withKakashiVoice(async (p) => enviados.push(p), () =>
      announceDownload("video"),
    );

    assert.strictEqual(saiu, true);
    assert.strictEqual(enviados.length, 1);
    assert.match(enviados[0], /kakashi-baixar-video\.mp3$/);
  });

  it("envia a fala da música dentro do contexto", async () => {
    const enviados = [];

    await withKakashiVoice(async (p) => enviados.push(p), () =>
      announceDownload("audio"),
    );

    assert.match(enviados[0], /kakashi-baixar-musica\.mp3$/);
  });

  it("ignora um tipo sem fala associada", async () => {
    const enviados = [];

    const saiu = await withKakashiVoice(async (p) => enviados.push(p), () =>
      announceDownload("sticker"),
    );

    assert.strictEqual(saiu, false);
    assert.deepStrictEqual(enviados, []);
  });

  it("um envio falhado não sobe: o anúncio não pode travar o download", async () => {
    const saiu = await withKakashiVoice(
      async () => {
        throw new Error("falha a enviar");
      },
      () => announceDownload("video"),
    );

    assert.strictEqual(saiu, false);
  });

  it("sem sendAudioFromFile o contexto é simplesmente ignorado", async () => {
    const saiu = await withKakashiVoice(undefined, () =>
      announceDownload("video"),
    );

    assert.strictEqual(saiu, false);
  });
});

describe("o downloader anuncia antes de baixar", () => {
  // O anúncio sai antes do download em si, por isso um download que falha
  // (URL inválida) serve para provar que a fala saiu. Sem rede real envolvida.
  it("downloadVideo anuncia o vídeo", async () => {
    const enviados = [];

    await withKakashiVoice(async (p) => enviados.push(p), async () => {
      await downloadVideo(URL_MORTA).catch(() => {});
    });

    assert.strictEqual(enviados.length, 1, "o vídeo devia ter anunciado");
    assert.match(enviados[0], /kakashi-baixar-video\.mp3$/);
  });

  it("downloadAudio anuncia a música", async () => {
    const enviados = [];

    await withKakashiVoice(async (p) => enviados.push(p), async () => {
      await downloadAudio(URL_MORTA).catch(() => {});
    });

    assert.strictEqual(enviados.length, 1, "a música devia ter anunciado");
    assert.match(enviados[0], /kakashi-baixar-musica\.mp3$/);
  });
});
