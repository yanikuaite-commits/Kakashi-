import assert from "node:assert/strict";
import { test } from "node:test";

// A configuração é lida no import, então este arquivo roda em processo próprio
// (o runner do node:test isola cada arquivo) para testar o desligamento.
process.env.YTDLP_ENABLED = "false";
process.env.YTDLP_PATH = "/caminho/inexistente/yt-dlp";

const { downloadWithYtDlp, isYtDlpAvailable } = await import("../services/ytdlp.js");

test("YTDLP_ENABLED=false desliga o yt-dlp (o downloader usa a API)", async () => {
  assert.equal(await isYtDlpAvailable(), false);

  await assert.rejects(
    downloadWithYtDlp("https://exemplo.test/video", { height: 720 }),
    /não está disponível/,
  );
});
