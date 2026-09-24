/**
 * Derivacion de las cuentas de demo.
 *
 * El backend firma por las cuentas de los beneficiarios y comercios: es la
 * decision de custodia del MVP, declarada en el README. Don Julio no va a
 * guardar una frase de recuperacion para cobrar S/ 18.
 *
 * Eso plantea donde guardar esas claves. La respuesta es: en ningun sitio.
 * Se derivan de una unica variable de servidor, `MASTER_SEED`:
 *
 *     clave = HMAC-SHA256(MASTER_SEED, "<sesion>:<rol>:<id>")
 *
 * Consecuencias:
 *
 * - La base de datos NO guarda ninguna clave secreta. Solo la clave publica,
 *   que es publica. Una filtracion de la base no compromete ninguna cuenta.
 * - Las sesiones por visitante salen gratis: cambiar el tramo de sesion da
 *   un juego de cuentas distinto, sin tocar nada mas.
 * - Es reproducible: la misma ruta da siempre la misma cuenta.
 *
 * Contrapartida, que conviene tener presente: `MASTER_SEED` es la llave de
 * todo. Si se pierde, las cuentas derivadas quedan inaccesibles; si se
 * filtra, se comprometen todas. En testnet no protege nada de valor, pero
 * el patron solo se sostiene asi en una demo: en produccion cada usuario
 * tendria su propia billetera.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

/** Roles que pueden tener una cuenta derivada. */
export const ROLES = /** @type {const} */ (['beneficiario', 'comercio']);

/** Caracteres admitidos en un identificador de sesion. */
const SESION_VALIDA = /^[a-z0-9]{8,64}$/;

/**
 * Lee la semilla maestra y comprueba que sea utilizable.
 *
 * @param {string} [semilla]
 * @returns {string}
 */
function exigirSemilla(semilla = process.env.MASTER_SEED) {
  if (!semilla) {
    throw new Error(
      'Falta MASTER_SEED. Es una variable SOLO de servidor: nunca con prefijo '
      + 'VITE_, porque Vite la publicaria en el navegador. '
      + 'Generar con: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (semilla.length < 32) {
    throw new Error(
      `MASTER_SEED tiene ${semilla.length} caracteres y de ella dependen todas las `
      + 'cuentas. Se esperan al menos 32; lo recomendado son 64 (32 bytes en hexadecimal).',
    );
  }
  return semilla;
}

/**
 * Crea un identificador de sesion nuevo.
 *
 * Cada visitante de la demo recibe el suyo y con el sus propias cuentas, para
 * que dos personas no se pisen el recorrido: la URL es publica y el jurado la
 * abre cuando quiere. Si el visitante anterior vencio el programa, el
 * siguiente no deberia encontrarse la demo muerta.
 *
 * @returns {string}
 */
export function nuevaSesion() {
  return randomBytes(16).toString('hex');
}

/**
 * Deriva el par de claves de una cuenta.
 *
 * @param {object} cuenta
 * @param {string} cuenta.sesion  Identificador de la sesion de demo.
 * @param {'beneficiario'|'comercio'} cuenta.rol
 * @param {string|number} cuenta.id  Identificador dentro de la sesion.
 * @param {string} [semillaMaestra]  Por defecto, `process.env.MASTER_SEED`.
 * @returns {Keypair}
 */
export function derivarCuenta({ sesion, rol, id }, semillaMaestra) {
  const semilla = exigirSemilla(semillaMaestra);

  if (!SESION_VALIDA.test(String(sesion))) {
    throw new TypeError(
      `Sesion invalida: ${JSON.stringify(sesion)}. `
      + 'Se esperan de 8 a 64 caracteres entre a-z y 0-9.',
    );
  }
  if (!ROLES.includes(rol)) {
    throw new TypeError(`Rol invalido: ${JSON.stringify(rol)}. Se espera ${ROLES.join(' o ')}.`);
  }
  if (id === null || id === undefined || String(id) === '') {
    throw new TypeError('Falta el id de la cuenta.');
  }
  // Los dos puntos separan los tramos de la ruta. Si un tramo pudiera
  // contenerlos, dos cuentas distintas podrian derivar la misma clave.
  if (String(id).includes(':')) {
    throw new TypeError(`El id no puede contener ":": ${JSON.stringify(id)}.`);
  }

  const ruta = `${sesion}:${rol}:${id}`;
  const bytes = createHmac('sha256', semilla).update(ruta).digest();
  return Keypair.fromRawEd25519Seed(bytes);
}

/**
 * Solo la clave publica, para guardarla en la base de datos o mostrarla.
 *
 * @param {Parameters<typeof derivarCuenta>[0]} cuenta
 * @param {string} [semillaMaestra]
 * @returns {string}
 */
export function publicaDe(cuenta, semillaMaestra) {
  return derivarCuenta(cuenta, semillaMaestra).publicKey();
}

/**
 * Codigo corto de 6 digitos que el comercio muestra en caja.
 *
 * Existe porque el QR no siempre sirve: la camara falla, la pantalla se raya
 * y la bodega puede estar oscura. Se deriva igual que la cuenta, asi que es
 * estable sin necesidad de guardarlo, aunque tambien se guarda en la base
 * con una restriccion de unicidad para poder buscar por el.
 *
 * @param {{ sesion: string, id: string|number }} comercio
 * @param {string} [semillaMaestra]
 * @returns {string}
 */
export function codigoCorto({ sesion, id }, semillaMaestra) {
  const semilla = exigirSemilla(semillaMaestra);
  const bytes = createHmac('sha256', semilla).update(`${sesion}:codigo:${id}`).digest();
  return String(bytes.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}
