/**
 * Fila de downloads.
 *
 * O problema: quando dois usuários pedem um download ao mesmo tempo, os dois
 * correm em paralelo e dividem a banda, ficando ambos lentos. Aqui os downloads
 * correm no máximo `DOWNLOAD_CONCURRENCY` de cada vez; o resto espera na fila.
 *
 * Além de esperar, cada download sabe a sua posição, o que permite avisar o
 * usuário ("você é o 2.º da fila") em vez de o deixar no silêncio.
 *
 * Desistência: um pedido que espera mais de `DOWNLOAD_QUEUE_TIMEOUT_MS` sai da
 * fila com `QueueTimeoutError`, em vez de esperar para sempre. O tempo conta
 * só a espera, não a execução — um download que já começou não é interrompido.
 *
 * O dono do bot (quem administra) tem prioridade: entra à frente da fila, para
 * um ajuste urgente não ficar atrás de downloads de membros.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  DOWNLOAD_CONCURRENCY,
  DOWNLOAD_QUEUE_TIMEOUT_MS,
} from "../config.js";
import { queuedMessage, downloadTurnMessage } from "./download-message.js";
import { infoLog } from "../utils/logger.js";

/**
 * Aviso ao usuário sem passar `sendReply` por todas as camadas de download.
 *
 * Mesmo padrão do contexto de créditos: o dispatcher abre o contexto com o
 * `sendReply` do chat e a fila usa-o quando precisa de avisar. Fora de um
 * contexto (testes, dono) o aviso é simplesmente ignorado.
 */
const notifier = new AsyncLocalStorage();

export function withDownloadNotifier(sendReply, callback, { priority = false } = {}) {
  if (typeof sendReply !== "function") return callback();

  return notifier.run({ sendReply, priority }, callback);
}

/** Erro lançado quando o pedido espera demasiado na fila. */
export class QueueTimeoutError extends Error {
  constructor(ms = DOWNLOAD_QUEUE_TIMEOUT_MS) {
    super(
      `A fila de downloads está cheia. Tente novamente daqui a pouco (esperei ${Math.round(ms / 1000)}s).`,
    );
    this.name = "QueueTimeoutError";
  }
}

const queue = [];
let running = 0;
let sequence = 0;

/** Quantos downloads estão a correr neste momento. */
export function runningDownloads() {
  return running;
}

/** Quantos pedidos esperam na fila (não conta os que correm). */
export function queuedDownloads() {
  return queue.length;
}

/**
 * Posição de um pedido na fila, contando a partir de 1.
 * 0 significa que não está na fila (já começou ou desistiu).
 */
export function queuePosition(id) {
  const indice = queue.findIndex((item) => item.id === id);

  return indice === -1 ? 0 : indice + 1;
}

/** Tira o próximo da fila: os prioritários primeiro, depois por ordem de chegada. */
function takeNext() {
  if (!queue.length) return null;

  let escolhido = 0;
  for (let i = 1; i < queue.length; i += 1) {
    if (queue[i].priority && !queue[escolhido].priority) {
      escolhido = i;
      break;
    }
  }

  const [item] = queue.splice(escolhido, 1);
  return item;
}

function pump() {
  while (running < Math.max(1, DOWNLOAD_CONCURRENCY) && queue.length) {
    const item = takeNext();
    if (!item) return;

    clearTimeout(item.timer);
    item.timer = null;
    running += 1;

    // Os avisos usam o `avisar` capturado no momento do pedido, não o contexto
    // de quem está a correr agora: o `pump` de um download que acabou pertence
    // a outro usuário, e o aviso iria para o chat errado.
    Promise.resolve()
      .then(() => item.onStart?.())
      .catch(() => {});

    item
      .run()
      .then(
        (value) => item.resolve(value),
        (error) => item.reject(error),
      )
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

/**
 * Corre `task` respeitando o limite de concorrência.
 *
 * @template T
 * @param {() => Promise<T>} task
 * @param {{ priority?: boolean, onStart?: () => void, onWait?: (posicao: number) => void, timeoutMs?: number }} [options]
 * @returns {Promise<T>}
 */
export function withDownloadSlot(
  task,
  { priority, onStart, onWait, timeoutMs = DOWNLOAD_QUEUE_TIMEOUT_MS } = {},
) {
  // Captura o aviso já aqui: é o único momento em que o contexto do pedido
  // (o chat de quem pediu) está garantido.
  const contexto = notifier.getStore() || {};
  const sendReply = contexto.sendReply;
  const avisar = (mensagem) => {
    if (!sendReply) return;
    Promise.resolve(sendReply(mensagem)).catch(() => {});
  };
  const prioritario = priority ?? contexto.priority ?? false;

  const iniciar = () => {
    onStart?.();
    avisar(downloadTurnMessage());
  };

  // Caminho rápido: há vaga e ninguém à espera. Evita o trabalho da fila.
  if (running < Math.max(1, DOWNLOAD_CONCURRENCY) && queue.length === 0) {
    running += 1;
    return Promise.resolve()
      .then(() => iniciar())
      .catch(() => {})
      .then(() => task())
      .finally(() => {
        running -= 1;
        pump();
      });
  }

  const id = (sequence += 1);

  return new Promise((resolve, reject) => {
    const item = { id, run: task, resolve, reject, priority: prioritario, timer: null };

    item.onStart = iniciar;
    item.timer = setTimeout(() => {
      const indice = queue.findIndex((entry) => entry.id === id);
      if (indice !== -1) {
        queue.splice(indice, 1);
      }
      reject(new QueueTimeoutError(timeoutMs));
    }, timeoutMs);
    item.timer.unref?.();

    queue.push(item);

    const posicao = queuePosition(id);
    infoLog(`[fila] download entrou na posição ${posicao}.`);
    onWait?.(posicao);
    avisar(queuedMessage({ position: posicao }));

    pump();
  });
}

/** Só para os testes: esvazia a fila e zera os contadores. */
export function resetDownloadQueue() {
  for (const item of queue.splice(0)) {
    clearTimeout(item.timer);
    item.reject(new Error("Fila reiniciada."));
  }
  running = 0;
}
