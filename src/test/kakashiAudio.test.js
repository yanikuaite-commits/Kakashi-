/**
 * Testes das falas do Kakashi: catálogo, resolução por nome e comando.
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  KAKASHI_AUDIOS,
  caminhoDoAudio,
  encontrarAudio,
} from "../services/kakashiAudio.js";
import falasCommand from "../commands/member/funny/kakashi.js";

function makeCtx({ args = [] } = {}) {
  const audios = [];
  const replies = [];
  return {
    audios,
    replies,
    ctx: {
      args,
      sendReply: async (text) => replies.push(text),
      sendAudioFromFile: async (filePath) => audios.push(filePath),
      sendSuccessReact: async () => {},
    },
  };
}

describe("catálogo das falas", () => {
  it("cada fala aponta para um ficheiro que existe no disco", () => {
    for (const audio of KAKASHI_AUDIOS) {
      assert.ok(
        fs.existsSync(caminhoDoAudio(audio)),
        `ficheiro em falta: ${audio.arquivo}`,
      );
    }
  });

  it("não repete ids, ficheiros nem nomes", () => {
    const ids = KAKASHI_AUDIOS.map((audio) => audio.id);
    const arquivos = KAKASHI_AUDIOS.map((audio) => audio.arquivo);
    const nomes = KAKASHI_AUDIOS.flatMap((audio) => audio.nomes);

    assert.strictEqual(new Set(ids).size, ids.length, "id repetido");
    assert.strictEqual(new Set(arquivos).size, arquivos.length, "ficheiro repetido");
    assert.strictEqual(new Set(nomes).size, nomes.length, "nome repetido");
  });

  it("toda fala tem descrição e transcrição", () => {
    for (const audio of KAKASHI_AUDIOS) {
      assert.ok(audio.descricao, `${audio.id}: sem descrição`);
      assert.ok(audio.transcricao, `${audio.id}: sem transcrição`);
    }
  });
});

describe("encontrarAudio", () => {
  it("encontra pelo id", () => {
    assert.strictEqual(encontrarAudio("chidori")?.id, "chidori");
    assert.strictEqual(encontrarAudio("musica")?.id, "musica");
  });

  it("ignora acentos, maiúsculas e espaços", () => {
    assert.strictEqual(encontrarAudio("MÚSICA")?.id, "musica");
    assert.strictEqual(encontrarAudio("  Vídeo ")?.id, "video");
    assert.strictEqual(encontrarAudio("CHIDORI")?.id, "chidori");
  });

  it("devolve null para um nome que não existe", () => {
    assert.strictEqual(encontrarAudio("rasengan"), null);
    assert.strictEqual(encontrarAudio(""), null);
    assert.strictEqual(encontrarAudio(undefined), null);
  });
});

describe("comando falas", () => {
  it("envia a fala pedida", async () => {
    const { ctx, audios, replies } = makeCtx({ args: ["chidori"] });

    await falasCommand.handle(ctx);

    assert.strictEqual(audios.length, 1);
    assert.match(audios[0], /kakashi-chidori\.mp3$/);
    assert.deepStrictEqual(replies, []);
  });

  it("envia a fala de vídeo com o acento", async () => {
    const { ctx, audios } = makeCtx({ args: ["vídeo"] });

    await falasCommand.handle(ctx);

    assert.match(audios[0], /kakashi-baixar-video\.mp3$/);
  });

  it("sem argumento mostra a lista e não envia áudio", async () => {
    const { ctx, audios, replies } = makeCtx();

    await falasCommand.handle(ctx);

    assert.strictEqual(audios.length, 0);
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0], /FALAS DO KAKASHI/);
    assert.match(replies[0], /falas chidori/);
  });

  it("com um nome desconhecido mostra a lista e avisa", async () => {
    const { ctx, audios, replies } = makeCtx({ args: ["rasengan"] });

    await falasCommand.handle(ctx);

    assert.strictEqual(audios.length, 0);
    assert.match(replies[0], /Não conheço "rasengan"/);
  });
});
