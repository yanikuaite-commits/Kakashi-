/**
 * Testes para o serviço de dashboard (métricas do painel).
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_SAMPLES,
  SAMPLE_WINDOW_MS,
  backupStatus,
  databaseStatus,
  diskUsagePercent,
  formatBytes,
  formatUptime,
  ramUsagePercent,
  recordSystemSample,
  systemSamples,
  systemStatus,
} from "../services/dashboard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const samplesPath = path.resolve(__dirname, "..", "..", "database", "system-samples.json");
let backup;

beforeEach(() => {
  backup = fs.existsSync(samplesPath) ? fs.readFileSync(samplesPath, "utf8") : undefined;
  fs.writeFileSync(samplesPath, "[]");
});

afterEach(() => {
  if (backup !== undefined) fs.writeFileSync(samplesPath, backup);
  else if (fs.existsSync(samplesPath)) fs.unlinkSync(samplesPath);
});

describe("formatBytes", () => {
  it("formata bytes, KB, MB e GB", () => {
    assert.strictEqual(formatBytes(512), "512 B");
    assert.strictEqual(formatBytes(1024), "1.0 KB");
    assert.strictEqual(formatBytes(1024 * 1024), "1.0 MB");
    assert.strictEqual(formatBytes(1024 * 1024 * 1024), "1.0 GB");
  });

  it("devolve n/d para valores inválidos", () => {
    assert.strictEqual(formatBytes("abc"), "n/d");
    assert.strictEqual(formatBytes(-1), "n/d");
  });
});

describe("formatUptime", () => {
  it("mostra minutos, horas e dias", () => {
    assert.strictEqual(formatUptime(90), "1min");
    assert.strictEqual(formatUptime(3660), "1h 1min");
    assert.strictEqual(formatUptime(90000), "1d 1h 0min");
  });

  it("nunca devolve negativo", () => {
    assert.strictEqual(formatUptime(-5), "0min");
  });
});

describe("ramUsagePercent", () => {
  it("devolve uma percentagem entre 0 e 100", () => {
    const pct = ramUsagePercent();
    assert.ok(pct >= 0 && pct <= 100);
  });
});

describe("diskUsagePercent", () => {
  it("devolve uma percentagem ou null, nunca lança", () => {
    const pct = diskUsagePercent();
    assert.ok(pct === null || (pct >= 0 && pct <= 100));
  });

  it("devolve null para um diretório inexistente", () => {
    assert.strictEqual(diskUsagePercent("/caminho/que/nao/existe/xyz"), null);
  });
});

describe("systemStatus", () => {
  it("traz versão, node, uptime e núcleos", () => {
    const status = systemStatus();

    assert.strictEqual(status.status, "online");
    assert.ok(status.versao);
    assert.strictEqual(status.node, process.version);
    assert.ok(status.nucleos >= 1);
    assert.ok(status.uptimeSegundos >= 0);
  });
});

describe("databaseStatus", () => {
  it("conta os ficheiros JSON do diretório", () => {
    const banco = databaseStatus();
    assert.ok(banco.ficheiros.length > 0);
    assert.ok(banco.totalBytes > 0);
  });

  it("devolve estrutura vazia para um diretório inexistente", () => {
    const banco = databaseStatus("/caminho/que/nao/existe/xyz");
    assert.deepStrictEqual(banco.ficheiros, []);
    assert.strictEqual(banco.totalBytes, 0);
  });

  it("marca como ilegível um JSON partido", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "painel-db-"));
    fs.writeFileSync(path.join(tempDir, "bom.json"), '{"a":1}');
    fs.writeFileSync(path.join(tempDir, "mau.json"), "{truncado");

    const banco = databaseStatus(tempDir);
    assert.deepStrictEqual(banco.ilegiveis, ["mau.json"]);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("backupStatus", () => {
  it("devolve o estado mesmo sem backups feitos", () => {
    const estado = backupStatus();
    assert.ok("ultimo" in estado);
    assert.ok("ok" in estado);
    assert.strictEqual(typeof estado.arquivosLocais, "number");
  });
});

describe("recordSystemSample / systemSamples", () => {
  it("regista uma amostra com RAM e horário", () => {
    recordSystemSample();

    const amostras = systemSamples();
    assert.strictEqual(amostras.length, 1);
    assert.ok(amostras[0].at);
    assert.ok(amostras[0].ramPct >= 0);
  });

  it("descarta amostras fora da janela de 24h", () => {
    const antiga = new Date(Date.now() - SAMPLE_WINDOW_MS - 60000).toISOString();
    fs.writeFileSync(
      samplesPath,
      JSON.stringify([{ at: antiga, ramPct: 10, cpuPct: 5, diskPct: 20 }]),
    );

    assert.deepStrictEqual(systemSamples(), []);
  });

  it("não guarda mais que o limite de amostras", () => {
    const muitas = Array.from({ length: MAX_SAMPLES + 50 }, (_, i) => ({
      at: new Date(Date.now() - i * 1000).toISOString(),
      ramPct: 50,
      cpuPct: 10,
      diskPct: 30,
    }));
    fs.writeFileSync(samplesPath, JSON.stringify(muitas));

    recordSystemSample();

    assert.ok(systemSamples().length <= MAX_SAMPLES + 1);
  });
});
