/**
 * Seletor do destino durável da persistência.
 *
 * Existe porque o bot pode guardar o estado no MongoDB (Atlas) ou no Turso
 * (libSQL) — os dois resolvem o mesmo problema (o disco do host é efémero e
 * apagava créditos e assinaturas a cada deploy), mas têm custos de configuração
 * diferentes. Com um seletor, acrescentar um destino é criar um ficheiro com a
 * interface abaixo e registá-lo aqui; o `database.js` não sabe qual está ativo.
 *
 * Interface que cada driver implementa:
 *   name          string
 *   isEnabled()   boolean                  — está configurado?
 *   isConnected() boolean
 *   connect()     Promise<Client|null>     — nunca lança
 *   readAll()     Promise<Array<{name, data}>>
 *   writeMany(entries) Promise<void>       — lança em falha
 *   close()       Promise<void>
 */

import * as mongo from "./mongo.js";
import * as turso from "./turso.js";

/**
 * Ordem de preferência. O Turso vem primeiro por ser menos peças a configurar
 * (não tem lista de IPs); o Mongo entra quando só ele está configurado.
 */
const drivers = [turso, mongo];

/** Driver ativo, ou `null` quando nenhum está configurado. */
export function getActiveDriver() {
  return drivers.find((driver) => driver.isEnabled()) || null;
}

/** Há algum destino durável configurado? */
export function isRemoteEnabled() {
  return getActiveDriver() !== null;
}

export function isRemoteConnected() {
  const driver = getActiveDriver();

  return Boolean(driver && driver.isConnected());
}

/**
 * Apaga o estado do destino ativo, poupando entradas quando pedido.
 *
 * @param {{keep?: string[]}} [options]
 * @returns {Promise<number>}
 */
export async function clearState({ keep = [] } = {}) {
  const driver = getActiveDriver();

  if (!driver) {
    throw new Error("nenhum destino configurado");
  }

  await driver.connect();

  return driver.clearState({ keep });
}

/** Fecha a ligação do driver ativo (usado no shutdown). */
export async function close() {
  const driver = getActiveDriver();

  if (driver) {
    await driver.close();
  }
}
