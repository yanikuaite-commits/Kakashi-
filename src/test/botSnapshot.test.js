/**
 * Testes do instantâneo do estado do bot para a IA do dono.
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  botCounts,
  botSnapshotText,
  ownerSnapshotContext,
  resolveOwnerContext,
} from "../services/botSnapshot.js";
import { DATABASE_DIR } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const whitelistPath = path.join(DATABASE_DIR, "private-whitelist.json");
const blacklistPath = path.join(DATABASE_DIR, "blacklist.json");
const mutedPath = path.join(DATABASE_DIR, "muted.json");
let backups;

const arquivos = [whitelistPath, blacklistPath, mutedPath];

beforeEach(() => {
  backups = arquivos.map((f) =>
    fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null,
  );
  fs.writeFileSync(whitelistPath, JSON.stringify(["a@lid", "b@lid", "c@lid"]));
  fs.writeFileSync(mutedPath, JSON.stringify({ "1@g.us": ["x@lid", "y@lid"] }));
  fs.writeFileSync(blacklistPath, "{}");
});

afterEach(() => {
  arquivos.forEach((f, i) => {
    if (backups[i] !== null) fs.writeFileSync(f, backups[i]);
    else if (fs.existsSync(f)) fs.unlinkSync(f);
  });
});

describe("botCounts", () => {
  it("conta a whitelist e os silenciados a partir do disco", () => {
    const c = botCounts();

    assert.strictEqual(c.whitelist, 3);
    assert.strictEqual(c.silenciados, 2);
    assert.strictEqual(typeof c.banidos, "number");
    assert.strictEqual(typeof c.saldoTotal, "number");
  });
});

describe("botSnapshotText", () => {
  it("mostra os números reais no bloco de estado", () => {
    const texto = botSnapshotText({ grupos: 4 });

    assert.match(texto, /ESTADO ATUAL DO BOT/);
    assert.match(texto, /whitelist privada: 3/);
    assert.match(texto, /silenciados: 2/);
    assert.match(texto, /grupos onde o bot está: 4/);
  });

  it("omite a linha dos grupos quando não há contagem do socket", () => {
    const texto = botSnapshotText();

    assert.ok(!texto.includes("grupos onde o bot está"));
  });

  it("inclui o grupo atual quando é indicado", () => {
    const texto = botSnapshotText({
      grupoAtual: { nome: "Kakashi FC", participantes: 42 },
    });

    assert.match(texto, /grupo atual: "Kakashi FC", 42 participante/);
  });

  it("nunca inclui valores de chaves de API", () => {
    const texto = botSnapshotText();

    assert.match(texto, /chaves de API configuradas: \d+ de \d+/);
    assert.ok(!/gsk_/.test(texto));
  });
});

describe("ownerSnapshotContext", () => {
  it("devolve null para quem não é dono", () => {
    assert.strictEqual(ownerSnapshotContext(false), null);
  });

  it("devolve o bloco para o dono", () => {
    assert.match(ownerSnapshotContext(true), /ESTADO ATUAL DO BOT/);
  });
});

describe("resolveOwnerContext", () => {
  it("não gasta chamadas ao socket para um membro comum", async () => {
    let chamado = false;
    const socket = {
      groupFetchAllParticipating: async () => {
        chamado = true;
        return {};
      },
    };

    const ctx = await resolveOwnerContext({ isOwner: false, socket });

    assert.strictEqual(ctx, null);
    assert.strictEqual(chamado, false);
  });

  it("conta os grupos do socket e o grupo atual para o dono", async () => {
    const ctx = await resolveOwnerContext({
      isOwner: true,
      isGroup: true,
      remoteJid: "1@g.us",
      socket: {
        groupFetchAllParticipating: async () => ({ "1@g.us": {}, "2@g.us": {} }),
      },
      getGroupName: async () => "Grupo Teste",
      getGroupParticipants: async () => [{}, {}, {}],
    });

    assert.match(ctx, /grupos onde o bot está: 2/);
    assert.match(ctx, /grupo atual: "Grupo Teste", 3 participante/);
  });

  it("sobrevive a um socket que falha", async () => {
    const ctx = await resolveOwnerContext({
      isOwner: true,
      socket: {
        groupFetchAllParticipating: async () => {
          throw new Error("sem rede");
        },
      },
    });

    assert.match(ctx, /ESTADO ATUAL DO BOT/);
    assert.ok(!ctx.includes("grupos onde o bot está"));
  });
});
