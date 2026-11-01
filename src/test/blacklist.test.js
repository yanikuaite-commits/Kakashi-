/**
 * Testes para o serviço de blacklist.
 *
 * @author Dev Yanik
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BAN_DURATIONS,
  banUser,
  getActiveBan,
  isBanned,
  listActiveBans,
  normalizeUserKey,
  unbanUser,
} from "../services/blacklist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const blacklistPath = path.resolve(__dirname, "..", "..", "database", "blacklist.json");
let backup;

beforeEach(() => {
  backup = fs.existsSync(blacklistPath)
    ? fs.readFileSync(blacklistPath, "utf8")
    : undefined;
  fs.writeFileSync(blacklistPath, "{}");
});

afterEach(() => {
  if (backup !== undefined) fs.writeFileSync(blacklistPath, backup);
  else if (fs.existsSync(blacklistPath)) fs.unlinkSync(blacklistPath);
});

describe("normalizeUserKey", () => {
  it("normaliza LID, dígitos e sufixo de aparelho para a mesma chave", () => {
    assert.strictEqual(normalizeUserKey("275381038891241@lid"), "275381038891241@lid");
    assert.strictEqual(normalizeUserKey("275381038891241"), "275381038891241@lid");
    assert.strictEqual(normalizeUserKey("275381038891241:12@lid"), "275381038891241@lid");
  });

  it("preserva o domínio explícito", () => {
    assert.strictEqual(
      normalizeUserKey("258841234567@s.whatsapp.net"),
      "258841234567@s.whatsapp.net",
    );
  });

  it("devolve vazio sem dígitos", () => {
    assert.strictEqual(normalizeUserKey(""), "");
    assert.strictEqual(normalizeUserKey("abc"), "");
  });
});

describe("banUser", () => {
  it("bane permanentemente quando não há duração", () => {
    const resultado = banUser("275381038891241@lid", { motivo: "spam" });

    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.expiresAt, null);
    assert.strictEqual(isBanned("275381038891241@lid"), true);
  });

  it("bane temporariamente com a duração pedida", () => {
    banUser("258841234567@lid", { duration: "7d", motivo: "flood" });

    const ban = getActiveBan("258841234567@lid");
    assert.ok(ban);
    assert.ok(ban.expiresAt);

    const restante = Date.parse(ban.expiresAt) - Date.now();
    // Margem para o tempo do teste; o importante é ser ~7 dias.
    assert.ok(restante <= BAN_DURATIONS["7d"]);
    assert.ok(restante > BAN_DURATIONS["7d"] - 60000);
  });

  it("recusa um alvo sem dígitos", () => {
    const resultado = banUser("abc");
    assert.strictEqual(resultado.ok, false);
    assert.ok(resultado.error);
  });

  it("guarda o motivo padrão quando nenhum é indicado", () => {
    banUser("275381038891241@lid");
    assert.strictEqual(getActiveBan("275381038891241@lid").motivo, "sem motivo indicado");
  });
});

describe("getActiveBan", () => {
  it("expulsa um ban já expirado e limpa o ficheiro", () => {
    banUser("275381038891241@lid", { duration: "1h" });

    const depois = Date.now() + BAN_DURATIONS["1h"] + 1000;
    assert.strictEqual(getActiveBan("275381038891241@lid", depois), null);
    assert.strictEqual(isBanned("275381038891241@lid"), false);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(blacklistPath, "utf8")), {});
  });

  it("devolve null para quem não está na lista", () => {
    assert.strictEqual(getActiveBan("999999999@lid"), null);
  });
});

describe("listActiveBans", () => {
  it("lista os ativos e descarta os expirados", () => {
    banUser("111111111@lid", { motivo: "a" });
    banUser("222222222@lid", { duration: "1h", motivo: "b" });

    const ativos = listActiveBans();
    assert.strictEqual(ativos.length, 2);

    const depois = Date.now() + BAN_DURATIONS["1h"] + 1000;
    const restantes = listActiveBans(depois);
    assert.strictEqual(restantes.length, 1);
    assert.strictEqual(restantes[0].key, "111111111@lid");
    assert.strictEqual(restantes[0].permanent, true);
  });
});

describe("unbanUser", () => {
  it("remove o ban e devolve true", () => {
    banUser("275381038891241@lid");
    assert.strictEqual(unbanUser("275381038891241@lid"), true);
    assert.strictEqual(isBanned("275381038891241@lid"), false);
  });

  it("devolve false quando não estava banido", () => {
    assert.strictEqual(unbanUser("275381038891241@lid"), false);
  });
});
