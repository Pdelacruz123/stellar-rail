/**
 * Envio de transacciones a Stellar.
 *
 * Todo lo que el resto del riel necesita para hablar con la red esta aqui,
 * y resuelve tres problemas que ya nos costaron o nos van a costar:
 *
 * 1. EL HASH SE CALCULA ANTES DE ENVIAR. Cuando una transaccion falla,
 *    Horizon a veces no devuelve el hash. Y es evidencia: un pago rechazado
 *    por la red es lo que este proyecto quiere demostrar.
 *
 * 2. UN 504 NO SIGNIFICA QUE FALLO. Horizon corta a los ~30s, pero la
 *    transaccion puede entrar igual. Si lo damos por fallido y reintentamos,
 *    emitimos dos veces. Como tenemos el hash, preguntamos por el.
 *
 * 3. EL EMISOR ES UN CUELLO DE BOTELLA. Una cuenta consume una sola
 *    secuencia por ledger (~5s), y el emisor firma casi todo: autorizar,
 *    emitir, congelar, anular. Dos llamadas a la vez dan `tx_bad_seq`.
 *    Se reintenta con la secuencia fresca, y quien pueda pasar un candado
 *    de verdad (la API, con un advisory lock de Postgres) lo pasa.
 */

import { TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import { codigosDe, explicar } from './errores.js';

/** Comision maxima por operacion, en stroops. 200x la base, por si hay congestion. */
export const COMISION_MAXIMA = String(Number(BASE_FEE) * 200);

/** Segundos de validez de una transaccion. Pasado esto ya no puede entrar. */
const VENTANA = 60;

/** Reintentos ante `tx_bad_seq`. */
const REINTENTOS = 4;

/**
 * @typedef {object} Exito
 * @property {true} ok
 * @property {string} hash
 * @property {number} ledger
 * @property {string} etiqueta
 *
 * @typedef {object} Rechazo
 * @property {false} ok
 * @property {string} hash
 * @property {string} codigo
 * @property {{ transaction?: string, operations?: string[] }|null} codigos
 * @property {string} significado
 * @property {string} mensaje
 * @property {boolean} enElLedger
 * @property {string} etiqueta
 *
 * @typedef {Exito|Rechazo} Resultado
 */

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ¿El fallo es "no sabemos que paso" en vez de "la red dijo que no"?
 * Un 504 o un corte de red no son un rechazo: la transaccion sigue viva.
 */
function esIncierto(error) {
  const estado = error?.response?.status;
  return estado === 504 || estado === 503 || estado === undefined;
}

/**
 * Pregunta por un hash hasta que Horizon lo conozca o se acabe la ventana.
 * Solo tiene sentido mientras la transaccion pueda entrar: pasada su
 * ventana de validez, si no esta, ya no va a estar.
 *
 * @returns {Promise<Resultado|null>} null si sigue sin aparecer
 */
async function buscarPorHash(servidor, hash, etiqueta, segundos = VENTANA + 10) {
  const limite = Date.now() + segundos * 1000;
  while (Date.now() < limite) {
    await dormir(2000);
    try {
      const tx = await servidor.transactions().transaction(hash).call();
      if (tx.successful) {
        return { ok: true, hash, ledger: tx.ledger_attr ?? tx.ledger, etiqueta };
      }
      const codigos = { transaction: 'tx_failed', operations: [] };
      return { ok: false, hash, codigos, ...explicar(codigos), etiqueta };
    } catch (e) {
      if (e?.response?.status !== 404) throw e;
      // 404 = todavia no esta. Seguimos esperando.
    }
  }
  return null;
}

/**
 * Crea la funcion que envia operaciones a la red.
 *
 * @param {object} config
 * @param {import('@stellar/stellar-sdk').Horizon.Server} config.servidor
 * @param {string} config.networkPassphrase
 * @param {(tarea: () => Promise<any>) => Promise<any>} [config.candado]
 *   Envoltorio para serializar los envios. Por defecto no hace nada, que es
 *   lo correcto para el script local. La API pasa aqui un advisory lock de
 *   Postgres.
 * @param {string} [config.cuentaSerializada]
 *   La unica cuenta cuyos envios pasan por el candado: el emisor.
 */
export function crearEnviador({ servidor, networkPassphrase, candado, cuentaSerializada }) {
  const sinCandado = (tarea) => tarea();
  const conCandado = candado ?? sinCandado;

  /**
   * Construye, firma y envia una transaccion. Reintenta si choca con otra
   * transaccion de la misma cuenta.
   *
   * @param {object} envio
   * @param {string} envio.fuente        Clave publica de la cuenta origen.
   * @param {import('@stellar/stellar-sdk').Keypair[]} envio.firmantes
   * @param {import('@stellar/stellar-sdk').xdr.Operation[]} envio.operaciones
   * @param {string} envio.etiqueta      Para el log y para EVIDENCIAS.md.
   * @returns {Promise<Resultado>}
   */
  return async function enviar({ fuente, firmantes, operaciones, etiqueta }) {
    // El candado solo va donde hay contencion de verdad: la cuenta que firma
    // casi todo. Serializar tambien los pagos de los beneficiarios los
    // pondria a todos en una unica cola global, que es exactamente lo que
    // las sesiones por visitante existen para evitar. Cada beneficiario
    // tiene su propia cuenta y por tanto su propia secuencia.
    const ejecutar = fuente === cuentaSerializada ? conCandado : sinCandado;

    return ejecutar(async () => {
      let ultimo = null;

      for (let intento = 1; intento <= REINTENTOS; intento += 1) {
        // La secuencia se lee justo antes de construir. Si reintentamos,
        // se vuelve a leer: por eso se recarga la cuenta dentro del bucle.
        const cuenta = await servidor.loadAccount(fuente);

        const constructor = new TransactionBuilder(cuenta, {
          fee: COMISION_MAXIMA,
          networkPassphrase,
        });
        for (const operacion of operaciones) constructor.addOperation(operacion);
        const tx = constructor.setTimeout(VENTANA).build();
        tx.sign(...firmantes);

        // Antes de enviar, no despues: si falla puede no venir en la respuesta.
        // OJO: en el SDK 17 `tx.hash()` devuelve un Uint8Array, no un Buffer.
        // Llamar a .toString('hex') directamente ignora el argumento sin
        // avisar y devuelve "18,25,215,..." en vez del hash. Hay que envolverlo.
        const hash = Buffer.from(tx.hash()).toString('hex');

        try {
          const r = await servidor.submitTransaction(tx);
          return { ok: true, hash, ledger: r.ledger, etiqueta };
        } catch (error) {
          const codigos = codigosDe(error);

          if (!codigos && esIncierto(error)) {
            // No sabemos si entro. Preguntamos por el hash antes de
            // dar nada por perdido: reintentar a ciegas duplicaria la emision.
            const encontrada = await buscarPorHash(servidor, hash, etiqueta);
            if (encontrada) return encontrada;
            throw new Error(
              `Horizon no respondio y la transaccion "${etiqueta}" no aparecio. `
              + `Hash para revisar a mano: ${hash}`,
              { cause: error },
            );
          }

          if (!codigos) throw error;

          const explicacion = explicar(codigos);
          ultimo = { ok: false, hash, codigos, ...explicacion, etiqueta };

          // Choque de secuencia: no es un rechazo del producto, es
          // concurrencia. Se reintenta con la secuencia al dia.
          if (codigos.transaction === 'tx_bad_seq' && intento < REINTENTOS) {
            await dormir(600 * intento + Math.random() * 400);
            continue;
          }

          return ultimo;
        }
      }

      return /** @type {Rechazo} */ (ultimo);
    });
  };
}
