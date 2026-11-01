/**
 * Espelho contínuo da sessão do WhatsApp (Baileys) no destino remoto.
 *
 * Por que existe: a sessão vive em `assets/auth/baileys/` (milhares de ficheiros
 * JSON pequenos). Num host de disco efémero ela desaparece a cada deploy, e o
 * bot obriga a re-parear o número. Guardá-la no remoto faz o bot arrancar já
 * autenticado.
 *
 * A sessão são as CHAVES PRIVADAS do número: quem tiver o blob fala pelo
 * WhatsApp do bot. Por isso ela é guardada na base de dados privada (nunca num
 * repositório) e o token do destino deve ser tratado como uma credencial de
 * acesso ao próprio número.
 *
 * É guardada por intervalo, não a cada escrita: o Baileys reescreve estes
 * ficheiros constantemente (um por mensagem, em grupos ativos) e espelhar cada
 * alteração martelaria o destino. O `flush` no encerramento garante que a última
 * alteração não se perde.
 *
 * O pacote é um JSON com o nome e o conteúdo de cada ficheiro, comprimido com
 * gzip e codificado em base64 (6.5 MB de ficheiros → ~160 KB de texto), porque
 * a coluna guarda texto.
 *
 * @author Dev Yanik
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import {
  AUTH_DIR,
  SESSION_STATE_NAME,
  SESSION_SYNC_INTERVAL_MINUTES,
} from "../config.js";
import { errorLog, infoLog } from "../utils/logger.js";
import { getActiveDriver } from "./remoteStore.js";

let syncing = null;

/** A sessão tem ficheiros para guardar? */
export function hasSessionFiles() {
  try {
    return fs.readdirSync(AUTH_DIR).length > 0;
  } catch {
    return false;
  }
}

/**
 * Empacota a sessão num texto pronto a guardar.
 *
 * Lê todos os ficheiros para um único JSON e comprime. O `Buffer` em base64 é o
 * que a coluna de texto aceita.
 *
 * @returns {{data: string, files: number, bytes: number}|null}
 */
export function packSession() {
  try {
    const names = fs.readdirSync(AUTH_DIR);
    const conteudo = {};

    for (const name of names) {
      const fullPath = path.join(AUTH_DIR, name);

      if (fs.statSync(fullPath).isFile()) {
        conteudo[name] = fs.readFileSync(fullPath, "utf8");
      }
    }

    if (!Object.keys(conteudo).length) {
      return null;
    }

    const json = JSON.stringify(conteudo);
    const gz = zlib.gzipSync(Buffer.from(json));

    return {
      data: gz.toString("base64"),
      files: Object.keys(conteudo).length,
      bytes: json.length,
    };
  } catch (error) {
    errorLog(`[session] não foi possível empacotar: ${error.message}`);

    return null;
  }
}

/**
 * Guarda a sessão no destino remoto.
 *
 * Nunca lança: uma falha de rede não pode impedir o bot de arrancar nem de
 * encerrar. O resultado é só informativo.
 *
 * @returns {Promise<boolean>}
 */
export async function saveSession() {
  const driver = getActiveDriver();

  if (!driver) {
    return false;
  }

  const pacote = packSession();

  if (!pacote) {
    return false;
  }

  try {
    await driver.writeMany([
      {
        name: SESSION_STATE_NAME,
        data: {
          packed: pacote.data,
          files: pacote.files,
          savedAt: new Date().toISOString(),
        },
      },
    ]);

    infoLog(
      `[session] ${pacote.files} ficheiro(s) guardados no ${driver.name}`,
    );

    return true;
  } catch (error) {
    errorLog(`[session] gravação falhou: ${error.message}`);

    return false;
  }
}

/**
 * Restaura a sessão a partir do valor guardado.
 *
 * A pasta é limpa antes de escrever: um ficheiro a mais (de uma sessão
 * anterior, já inválido) faria o Baileys carregar chaves contraditórias.
 *
 * @param {{packed?: string, files?: number}} value
 * @returns {boolean} `true` quando a sessão foi restaurada
 */
export function restoreSession(value) {
  try {
    if (!value?.packed) {
      return false;
    }

    const json = zlib.gunzipSync(Buffer.from(value.packed, "base64")).toString();
    const conteudo = JSON.parse(json);
    const names = Object.keys(conteudo);

    if (!names.length) {
      return false;
    }

    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });

    for (const name of names) {
      fs.writeFileSync(path.join(AUTH_DIR, name), conteudo[name], "utf8");
    }

    infoLog(`[session] ${names.length} ficheiro(s) restaurados`);

    return true;
  } catch (error) {
    errorLog(`[session] restauro falhou: ${error.message}`);

    return false;
  }
}

/**
 * Espelha a sessão agora, sem sobrepor execuções.
 *
 * @returns {Promise<boolean>}
 */
export async function syncSession() {
  if (syncing) {
    return syncing;
  }

  syncing = saveSession().finally(() => {
    syncing = null;
  });

  return syncing;
}

/**
 * Agenda o espelho periódico da sessão.
 *
 * Falhas são engolidas: este ciclo nunca pode derrubar o bot nem interromper a
 * ligação do WhatsApp. `runSync` é injetável para os testes correrem o
 * agendamento sem escrever no destino.
 *
 * @param {{runSync?: typeof syncSession}} [options]
 * @returns {NodeJS.Timeout|null} o temporizador, ou `null` se não houver destino
 */
export function startSessionSync({ runSync = syncSession } = {}) {
  if (!getActiveDriver()) {
    return null;
  }

  const intervalMs = SESSION_SYNC_INTERVAL_MINUTES * 60 * 1000;

  const timer = setInterval(() => {
    runSync().catch(() => {});
  }, intervalMs);

  timer.unref?.();

  return timer;
}
