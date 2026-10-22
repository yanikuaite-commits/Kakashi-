/**
 * Verificação E2E manual (não é teste de CI): percorre o fluxo real do bot
 * contra o AnimeHeaven — pesquisa, episódios, fontes e o download com o yt-dlp
 * usando EXACTAMENTE os mesmos argumentos que o `animeMenu.js` passa.
 *
 * Uso: ANIME_TEST_NETWORK=1 node scripts/verify-animeheaven.mjs
 *
 * Prova o que interessa ao utilizador: que o ficheiro sai em 720p nativo, dentro
 * do limite de envio e sem qualquer compressão.
 */
import { execFile } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { promisify } from "node:util";

import { ANIME_HEAVEN_MAX_HEIGHT, ANIME_MAX_DOWNLOAD_BYTES } from "../src/config.js";
import { episodes, search, sources } from "../src/services/animeheaven.js";
import { downloadWithYtDlp, isYtDlpAvailable } from "../src/services/ytdlp.js";

const execFileAsync = promisify(execFile);
const TERMO = process.env.ANIME_TEST_QUERY || "naruto";

function passo(texto) {
  console.log(`\n▶ ${texto}`);
}

/** Altura real do ficheiro, lida com o ffprobe do sistema. */
async function alturaDoVideo(filePath) {
  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";

  try {
    const { stdout } = await execFileAsync(ffprobe, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,codec_name",
      "-of",
      "csv=p=0",
      filePath,
    ]);

    return stdout.trim();
  } catch {
    return null;
  }
}

async function main() {
  if (!(await isYtDlpAvailable())) {
    console.error("✖ yt-dlp não está disponível; nada a verificar.");
    process.exit(1);
  }

  passo(`1. Pesquisa por "${TERMO}"`);
  const resultados = await search(TERMO);
  console.log(
    `   ${resultados.length} resultado(s): ${resultados.slice(0, 3).map((r) => r.title).join(", ")}`,
  );
  if (!resultados.length) throw new Error("sem resultados");

  passo("2. Episódios do primeiro resultado");
  const lista = await episodes(resultados[0].id, resultados[0].slug);
  console.log(`   ${lista.length} episódio(s); o primeiro é o ep. ${lista[0].number}`);

  passo("3. Link de MP4 direto");
  const fonte = await sources(lista[0], resultados[0].slug);
  console.log(`   ${fonte.url.split("?")[0]}`);
  console.log(`   rótulo=${fonte.quality} isM3U8=${fonte.isM3U8}`);

  passo("4. Download com os argumentos reais do animeMenu.js");
  console.log(
    `   altura=${ANIME_HEAVEN_MAX_HEIGHT}p maxBytes=${ANIME_MAX_DOWNLOAD_BYTES / 1024 / 1024}MB referer=gate.php`,
  );

  const resultado = await downloadWithYtDlp(fonte.url, {
    height: ANIME_HEAVEN_MAX_HEIGHT,
    maxBytes: ANIME_MAX_DOWNLOAD_BYTES,
    extraArgs: ["--referer", "https://animeheaven.me/gate.php"],
  });

  try {
    const streams = await alturaDoVideo(resultado.filePath);
    const { size } = await stat(resultado.filePath);
    const altura = Number(String(streams).split(",")[1]) || null;

    console.log(`\n   ficheiro  : ${resultado.filePath}`);
    console.log(`   tamanho   : ${(size / 1024 / 1024).toFixed(1)} MB`);
    console.log(`   duração   : ${resultado.durationString}`);
    console.log(`   streams   : ${streams ?? "(ffprobe indisponível)"}`);

    const dentro = size <= ANIME_MAX_DOWNLOAD_BYTES;
    const nativo = altura === null ? null : altura >= 700;

    console.log(`\n${dentro ? "✔" : "✖"} cabe no limite de envio`);
    console.log(
      nativo === null
        ? "• resolução não verificada (sem ffprobe)"
        : `${nativo ? "✔" : "✖"} entregue em 720p nativo, sem compressão`,
    );

    if (!dentro || nativo === false) process.exitCode = 1;
  } finally {
    await rm(resultado.filePath, { force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(`\n✖ falhou: ${error.message}`);
  process.exit(1);
});
