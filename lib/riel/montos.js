/**
 * Manejo de montos.
 *
 * Regla dura: los montos se tratan SIEMPRE como texto, nunca como number.
 * En JavaScript `0.1 + 0.2` da `0.30000000000000004`. Stellar usa punto fijo
 * de 7 decimales, asi que un redondeo silencioso aqui se convierte en un
 * saldo equivocado en la red, que ya no se puede corregir.
 *
 * Para comparar o sumar se pasa a stroops (BigInt), que es la unidad entera
 * real de Stellar: 1 unidad del activo = 10.000.000 stroops.
 */

/** Decimales que admite cualquier activo de Stellar. */
export const DECIMALES = 7;

/** Stroops que tiene una unidad del activo. */
export const STROOPS_POR_UNIDAD = 10_000_000n;

// Hasta 11 digitos enteros y 7 decimales. El maximo real de Stellar es
// 922.337.203.685,4775807; nuestros montos son de tres cifras.
const PATRON = /^\d{1,11}(\.\d{1,7})?$/;

/**
 * Valida un monto y lo devuelve como texto normalizado, listo para el SDK.
 *
 * @param {string|number} valor
 * @param {{ permitirCero?: boolean }} [opciones]
 * @returns {string}
 * @throws {TypeError} si no es un monto valido
 */
export function normalizarMonto(valor, { permitirCero = false } = {}) {
  if (valor === null || valor === undefined) {
    throw new TypeError('Falta el monto.');
  }

  // Un number llega ya redondeado por JavaScript, pero aceptarlo evita
  // friccion en los formularios. Lo pasamos a texto sin notacion cientifica.
  const texto = typeof valor === 'number'
    ? (Number.isFinite(valor) ? valor.toFixed(DECIMALES) : 'NaN')
    : String(valor).trim();

  if (!PATRON.test(texto)) {
    throw new TypeError(
      `Monto invalido: ${JSON.stringify(String(valor))}. `
      + `Se espera un numero positivo con hasta ${DECIMALES} decimales, por ejemplo "18.50".`,
    );
  }

  const stroops = aStroops(texto);
  if (stroops === 0n && !permitirCero) {
    throw new TypeError('El monto debe ser mayor que cero.');
  }

  return texto;
}

/**
 * Convierte un monto en texto a stroops, para comparar o sumar sin decimales.
 *
 * @param {string} monto
 * @returns {bigint}
 */
export function aStroops(monto) {
  const [entera, decimal = ''] = String(monto).trim().split('.');
  const relleno = decimal.padEnd(DECIMALES, '0').slice(0, DECIMALES);
  return BigInt(entera) * STROOPS_POR_UNIDAD + BigInt(relleno || '0');
}

/**
 * Convierte stroops de vuelta a un monto en texto.
 *
 * @param {bigint} stroops
 * @returns {string}
 */
export function desdeStroops(stroops) {
  const negativo = stroops < 0n;
  const abs = negativo ? -stroops : stroops;
  const entera = abs / STROOPS_POR_UNIDAD;
  const decimal = (abs % STROOPS_POR_UNIDAD).toString().padStart(DECIMALES, '0');
  return `${negativo ? '-' : ''}${entera}.${decimal}`;
}

/**
 * ¿El monto es mayor que cero? Util antes de un clawback: anular cero
 * hace fallar la operacion.
 *
 * @param {string} monto
 * @returns {boolean}
 */
export function esPositivo(monto) {
  try {
    return aStroops(monto) > 0n;
  } catch {
    return false;
  }
}
