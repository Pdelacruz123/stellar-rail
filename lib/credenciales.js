/**
 * Credenciales: PIN, contrasenas, celulares y numeros de tarjeta.
 *
 * El acceso depende del riesgo de cada uno (ver docs de casos de uso):
 *  - la empresa entra con correo y contrasena;
 *  - trabajador y tienda, con su celular y un PIN de 4 digitos, que es lo
 *    que alguien que no se maneja bien con la tecnologia puede recordar.
 *
 * Nada se guarda en claro: se cifra con scrypt y una sal por usuario. Y el
 * PIN protege el ACCESO a la aplicacion, no la cuenta en la red: esa la
 * custodia el sistema y ninguna persona ve su clave.
 */

import {
  randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

/** Intentos fallidos antes de bloquear el acceso. */
export const INTENTOS_MAXIMOS = 5;
/** Minutos que dura el bloqueo. Se levanta solo. */
export const BLOQUEO_MINUTOS = 15;
export { UMBRAL_PIN, TOPE_DIARIO_TARJETA } from './reglas.js';

/**
 * "+51 999 888 777", "999-888-777" -> "999888777". Un celular peruano tiene
 * 9 digitos y empieza por 9.
 * @returns {string|null}
 */
export function normalizarCelular(valor) {
  const d = String(valor ?? '').replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '');
  return /^9\d{8}$/.test(d) ? d : null;
}

/** @returns {string|null} */
export function normalizarCorreo(valor) {
  const c = String(valor ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) && c.length <= 200 ? c : null;
}

/**
 * 4 digitos, y no de los que se adivinan al primer intento. Se rechazan muy
 * pocos a proposito: cada regla extra es una traba para quien menos se
 * maneja con la tecnologia.
 */
export function pinValido(pin) {
  const p = String(pin ?? '');
  if (!/^\d{4}$/.test(p)) return false;
  if (/^(\d)\1{3}$/.test(p)) return false; // 0000, 1111...
  return !['1234', '4321'].includes(p);
}

export const contrasenaValida = (c) => String(c ?? '').length >= 8 && String(c).length <= 200;

/** Cifra un PIN o una contrasena. */
export async function cifrar(secreto) {
  const sal = randomBytes(16).toString('hex');
  const hash = (await scrypt(String(secreto), sal, 32)).toString('hex');
  return { hash, sal };
}

/** Compara sin filtrar informacion por el tiempo que tarda. */
export async function verificar(secreto, hash, sal) {
  if (!hash || !sal) return false;
  const calculado = await scrypt(String(secreto ?? ''), sal, 32);
  const guardado = Buffer.from(hash, 'hex');
  return guardado.length === calculado.length && timingSafeEqual(guardado, calculado);
}

// ---------------------------------------------------------------------------
// Para la demostracion y las tarjetas
// ---------------------------------------------------------------------------

export function pinAlAzar() {
  let pin;
  do { pin = String(randomInt(0, 10000)).padStart(4, '0'); } while (!pinValido(pin));
  return pin;
}

export const celularAlAzar = () => `9${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

// Sin letras que se confunden al leerlas en voz alta o en una tarjeta
// impresa: ni 0/O, ni 1/I/L.
const LEGIBLES = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const legibles = (n) => Array.from({ length: n }, () => LEGIBLES[randomInt(0, LEGIBLES.length)]).join('');

export const contrasenaAlAzar = () => `Demo-${legibles(4)}-${legibles(4)}`;

/** Numero de tarjeta impreso: "SR-4K7P-9QXA". 31^8 combinaciones, y sin el PIN no paga. */
export const numeroDeTarjeta = () => `SR-${legibles(4)}-${legibles(4)}`;

/** "sr-4k7p 9qxa" -> "SR-4K7P-9QXA", como lo escriba la tienda. */
export function normalizarTarjeta(valor) {
  const t = String(valor ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = /^SR([0-9A-Z]{4})([0-9A-Z]{4})$/.exec(t);
  return m ? `SR-${m[1]}-${m[2]}` : null;
}
