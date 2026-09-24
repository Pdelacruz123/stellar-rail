/**
 * Cobros con monto: el QR dinamico.
 *
 * La bodega escribe cuanto cobra y le muestra un QR al cliente. El cliente lo
 * escanea y solo tiene que confirmar: no escribe nada. Para alguien que no se
 * maneja bien con el celular, es la diferencia entre poder pagar o no.
 *
 * El cobro viaja en el propio enlace del QR, FIRMADO por el servidor con
 * MASTER_SEED. Asi:
 *
 * - El cliente no puede cambiar el monto ni el rubro: alterar cualquier cosa
 *   invalida la firma.
 * - El rubro lo declara la bodega en cada venta. Una bodega que vende comida
 *   y televisores puede cobrar una tele como "electrodomesticos", y como la
 *   declaracion va firmada y termina en el memo de la transaccion, queda
 *   publica y no se puede maquillar despues.
 * - Caduca a los 10 minutos: un QR de cobro no se puede reutilizar mas tarde.
 * - Se paga una sola vez: el servidor anota su firma al cobrarlo.
 *
 * No hace falta guardar el cobro en la base de datos antes de pagarlo: todo
 * lo necesario va en el enlace, y la firma garantiza que es autentico.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { esRubro } from './rubros.js';

/** Cuanto vale un QR de cobro antes de caducar. */
export const VIGENCIA_SEGUNDOS = 10 * 60;

/** Tope de un cobro, en centimos: S/ 100 000. Evita errores de tecleo absurdos. */
const MAXIMO_CENTIMOS = 10_000_000;

function firmar(texto) {
  const semilla = process.env.MASTER_SEED;
  if (!semilla) throw new Error('Falta MASTER_SEED.');
  return createHmac('sha256', semilla).update(texto).digest('base64url').slice(0, 22);
}

function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * "18.50" o "18,50" -> 1850. Se trabaja en centimos enteros: en el enlace no
 * viajan decimales, y no hay redondeos de coma flotante.
 *
 * @returns {number|null}
 */
export function aCentimos(monto) {
  const t = String(monto ?? '').trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  const [entero, decimal = ''] = t.split('.');
  const c = Number(entero) * 100 + Number(decimal.padEnd(2, '0'));
  return c > 0 && c <= MAXIMO_CENTIMOS ? c : null;
}

/** 1850 -> "18.50", el formato que espera la red. */
export function desdeCentimos(c) {
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

const carga = (sesion, comercioId, centimos, rubro, expira) =>
  `cobro|${sesion}|${comercioId}|${centimos}|${rubro}|${expira}`;

/**
 * Crea el cobro. Devuelve el token que va en el enlace del QR.
 *
 * El espacio de la empresa no viaja en el token, pero SI entra en la firma:
 * un cobro de otra empresa no se puede pagar aqui.
 */
export function crearCobro({ sesion, comercioId, monto, rubro, ahora = Date.now() }) {
  const centimos = aCentimos(monto);
  if (centimos === null) throw new TypeError('Escribe un monto válido, por ejemplo 18,50.');
  if (!esRubro(rubro)) throw new TypeError(`Rubro desconocido: ${rubro}.`);
  const id = Number(comercioId);
  if (!Number.isInteger(id) || id <= 0) throw new TypeError('Comercio inválido.');

  const expira = Math.floor(ahora / 1000) + VIGENCIA_SEGUNDOS;
  const firma = firmar(carga(sesion, id, centimos, rubro, expira));
  return {
    token: `${id}.${centimos}.${rubro}.${expira.toString(36)}.${firma}`,
    monto: desdeCentimos(centimos),
    rubro,
    expira: new Date(expira * 1000).toISOString(),
    // Para la cuenta atras. El celular cuenta desde que recibe el cobro, sin
    // comparar su reloj con el del servidor: si el del celular va adelantado,
    // daria el cobro por vencido cuando todavia vale.
    vigencia: VIGENCIA_SEGUNDOS,
  };
}

/**
 * Comprueba un cobro. Devuelve sus datos, o `{ error }` con un mensaje que
 * se le puede mostrar a la persona tal cual.
 */
export function leerCobro(sesion, token, ahora = Date.now()) {
  const partes = String(token ?? '').split('.');
  if (partes.length !== 5) return { error: 'Este código de cobro no es válido.' };
  const [idTexto, centTexto, rubro, exp36, firma] = partes;
  const comercioId = Number(idTexto);
  const centimos = Number(centTexto);
  const expira = parseInt(exp36, 36);
  if (!Number.isInteger(comercioId) || !Number.isInteger(centimos) || !Number.isInteger(expira)
    || !esRubro(rubro)) {
    return { error: 'Este código de cobro no es válido.' };
  }
  if (!iguales(firma, firmar(carga(sesion, comercioId, centimos, rubro, expira)))) {
    return { error: 'Este código de cobro no es válido.' };
  }
  if (Math.floor(ahora / 1000) > expira) {
    return { error: 'Este cobro ya venció. Pide a la tienda que genere otro.' };
  }
  return { comercioId, monto: desdeCentimos(centimos), rubro, expira, firma };
}
