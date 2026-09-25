/**
 * Limites que comparten el servidor y la interfaz. Sin dependencias de Node,
 * para que el navegador los pueda importar: la pantalla muestra el mismo
 * numero que el servidor hace cumplir.
 */

/** Con smartphone, por encima de este monto se pide el PIN al pagar. */
export const UMBRAL_PIN = 50;

/** Tope diario de los pagos con tarjeta + PIN, en soles. */
export const TOPE_DIARIO_TARJETA = 100;
