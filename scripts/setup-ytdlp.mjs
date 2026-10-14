/**
 * Baixa o binário standalone do yt-dlp para `bin/yt-dlp`.
 *
 * Uso:
 *   npm run setup:ytdlp            # baixa (ou reaproveita) o binário
 *   npm run setup:ytdlp -- --force # força um novo download
 *
 * Quando usar:
 * - hosts Linux/macOS sem Docker (VPS, Render com build nativo, etc.).
 * - No Docker/Render a imagem já instala o yt-dlp (veja o Dockerfile).
 * - No Termux: prefira `pkg install yt-dlp` (o binário Linux não roda no
 *   Android) ou aponte YTDLP_PATH para o binário instalado.
 *
 * O script nunca falha o install: se o download não for possível, o bot
 * continua funcionando com o fallback da API GenDownload.
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const BIN_DIR = path.join(ROOT_DIR, "bin");
const isWindows = process.platform === "win32";
const binaryName = isWindows ? "yt-dlp.exe" : "yt-dlp";
const binaryPath = path.join(BIN_DIR, binaryName);
const force = process.argv.includes("--force");

const ASSETS = {
  "linux-x64": "yt-dlp_linux",
  "linux-arm64": "yt-dlp_linux_aarch64",
  "linux-arm": "yt-dlp_linux_armv7",
  "darwin-x64": "yt-dlp_macos",
  "darwin-arm64": "yt-dlp_macos",
  "win32-x64": "yt-dlp.exe",
};

function assetFor(platform, arch) {
  return ASSETS[`${platform}-${arch}`] || null;
}

function runBinary(binary, args) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 30 * 1000 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(String(stdout).trim());
    });
  });
}

async function version(binary) {
  return runBinary(binary, ["--version"]).catch(() => null);
}

async function main() {
  if (process.env.TERMUX_VERSION) {
    console.log(
      "Termux detectado: rode `pkg install yt-dlp` (o binário Linux não roda no Android).",
    );
    return;
  }

  if (!force) {
    const current = await version(binaryPath);

    if (current) {
      console.log(`yt-dlp já instalado em bin/${binaryName} (versão ${current}).`);
      return;
    }
  }

  const asset = assetFor(process.platform, process.arch);

  if (!asset) {
    console.log(
      `Plataforma sem binário oficial (${process.platform}/${process.arch}). ` +
        "Instale o yt-dlp manualmente e configure YTDLP_PATH.",
    );
    return;
  }

  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;

  console.log(`Baixando ${url} ...`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`download falhou (HTTP ${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const temporaryPath = `${binaryPath}.download`;

  await mkdir(BIN_DIR, { recursive: true });
  await writeFile(temporaryPath, buffer);
  await rename(temporaryPath, binaryPath);

  if (!isWindows) {
    await chmod(binaryPath, 0o755);
  }

  const installed = await version(binaryPath);

  if (!installed) {
    await rm(binaryPath, { force: true });
    throw new Error("o binário baixado não executou");
  }

  console.log(`yt-dlp instalado em bin/${binaryName} (versão ${installed}).`);
}

main().catch((error) => {
  console.warn(
    `Não foi possível instalar o yt-dlp automaticamente: ${error.message}.\n` +
      "O bot continua funcionando com a API GenDownload (fallback).",
  );
});
