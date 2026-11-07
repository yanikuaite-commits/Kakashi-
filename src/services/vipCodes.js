/**
 * Serviço de códigos VIP (aluguel de grupos).
 * 
 * @author Dev Yanik
 */
import { readJSON, writeJSON } from "../utils/database.js";
import { randomBytes } from "node:crypto";

const VIP_CODES_FILE = "vip-codes";
const VIP_GROUPS_FILE = "vip-groups";

export function readVipCodes() {
  return readJSON(VIP_CODES_FILE, {});
}

export function saveVipCodes(codes) {
  writeJSON(VIP_CODES_FILE, codes, {});
}

export function readVipGroups() {
  return readJSON(VIP_GROUPS_FILE, {});
}

export function saveVipGroups(groups) {
  writeJSON(VIP_GROUPS_FILE, groups, {});
}

/**
 * Gera um código VIP único para um plano.
 */
export function generateVipCode({ plano, dias, buyerLid }) {
  const codes = readVipCodes();
  const code = `VIP-${randomBytes(3).toString("hex").toUpperCase()}-${dias}D`;
  
  codes[code] = {
    plano,
    dias,
    buyerLid,
    createdAt: new Date().toISOString(),
    used: false,
    usedBy: null,
    usedInGroup: null,
    expiresAt: null // O código em si NÃO expira até ser usado
  };

  saveVipCodes(codes);
  return code;
}

/**
 * Valida e resgata um código VIP num grupo.
 */
export function redeemVipCode(code, groupJid, userLid) {
  const codes = readVipCodes();
  const entry = codes[code];

  if (!entry) {
    return { ok: false, error: "Código inválido ou inexistente." };
  }

  if (entry.used) {
    return { ok: false, error: "Este código já foi utilizado!" };
  }

  // Marca como usado
  entry.used = true;
  entry.usedBy = userLid;
  entry.usedInGroup = groupJid;
  saveVipCodes(codes);

  // Ativa o VIP no grupo
  const vipGroups = readVipGroups();
  const expiresAt = Date.now() + entry.dias * 24 * 60 * 60 * 1000;

  vipGroups[groupJid] = {
    plano: entry.plano,
    dias: entry.dias,
    activatedAt: Date.now(),
    expiresAt,
    activatedBy: userLid,
  };

  saveVipGroups(vipGroups);

  return { ok: true, dias: entry.dias, plano: entry.plano, expiresAt };
}

/**
 * Verifica se um grupo tem VIP ativo.
 */
export function isGroupVip(groupJid) {
  const vipGroups = readVipGroups();
  const group = vipGroups[groupJid];

  if (!group) return false;

  if (Date.now() > group.expiresAt) {
    delete vipGroups[groupJid];
    saveVipGroups(vipGroups);
    return false;
  }

  return true;
}
