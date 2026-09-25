/**
 * Reglas que comparten el servidor y la interfaz. Sin dependencias de Node,
 * para que el navegador los pueda importar: la pantalla muestra el mismo
 * numero que el servidor hace cumplir.
 */

/** Con smartphone, por encima de este monto se pide el PIN al pagar. */
export const UMBRAL_PIN = 50;

/** Tope diario de los pagos con tarjeta + PIN, en soles. */
export const TOPE_DIARIO_TARJETA = 100;

/** La regla del PIN, dicha para quien lo elige. */
export const REGLA_PIN = 'Son 4 números. No uses 1234, 4321 ni el mismo número repetido.';

/**
 * 4 digitos, y no de los que se adivinan al primer intento. Se rechazan muy
 * pocos a proposito: cada regla extra es una traba para quien menos se
 * maneja con la tecnologia. La pantalla la comprueba mientras se escribe; el
 * servidor la vuelve a comprobar.
 */
export function pinValido(pin) {
  const p = String(pin ?? '');
  if (!/^\d{4}$/.test(p)) return false;
  if (/^(\d)\1{3}$/.test(p)) return false; // 0000, 1111...
  return !['1234', '4321'].includes(p);
}

/**
 * Que decirle a quien esta eligiendo un PIN, o '' si todavia no hay nada que
 * decir. Solo habla cuando ya escribio los 4 numeros.
 */
export function problemaDelPin(pin, repetido) {
  const p = String(pin ?? '');
  if (p.length === 4 && !pinValido(p)) return 'Ese PIN es muy fácil de adivinar. Elige otro.';
  const r = String(repetido ?? '');
  if (r.length === 4 && r !== p) return 'Los dos PIN no son iguales.';
  return '';
}
