/**
 * Rubros de gasto y tipos de programa.
 *
 * Lo comparten el servidor y la interfaz: un solo catalogo, una sola verdad.
 *
 * LO QUE LA RED NO VE. Stellar sabe quien le paga a quien y cuanto, pero no
 * que se compro. La canasta solo la ve el comercio. Como en las tarjetas de
 * alimentos, se restringe por tipo de comercio: cada tienda tiene un rubro
 * fijo, asignado al afiliarla, que viaja en el memo de cada pago y queda en
 * el libro publico. Que en caja se cobren solo productos permitidos es
 * responsabilidad de la tienda; si incumple, la sancion (desafiliarla) si la
 * hace cumplir la red.
 *
 * Que un programa acepte o no un rubro lo comprueba la APLICACION, no la red.
 * Hacerlo cumplir en la cadena exige un contrato Soroban: es el siguiente paso.
 */

export const RUBROS = Object.freeze({
  alimentos: 'Alimentos y abarrotes',
  farmacia: 'Farmacia',
  transporte: 'Transporte',
  electro: 'Electrodomésticos',
  otros: 'Otros',
});

/**
 * Tipos de programa. Como las tarjetas de beneficios de verdad:
 *
 * - La prestacion alimentaria de la Ley 28051 es para la "adquisicion
 *   exclusiva de alimentos": la empresa NO puede decidir que se gaste en otra
 *   cosa. Es RECARGABLE: la empresa la recarga cada mes y lo que no se usa se
 *   acumula, hasta la fecha de cierre que fija la empresa.
 * - Un bono o incentivo se entrega UNA vez, la empresa elige los rubros y
 *   vence en su fecha.
 *
 * En los dos, lo que no se uso hasta el cierre se anula en la red: la
 * empresa recupera su respaldo en soles, que deja de estar comprometido.
 */
export const TIPOS = Object.freeze({
  alimentaria: {
    nombre: 'Prestación alimentaria (Ley 28051)',
    rubros: ['alimentos'],
    fijo: true,
    recargable: true,
  },
  bono: {
    nombre: 'Bono o incentivo',
    rubros: null,
    fijo: false,
    recargable: false,
  },
});

export const esRubro = (r) => Object.hasOwn(RUBROS, r);

/**
 * El periodo de una entrega. Un programa recargable se entrega una vez por
 * mes ("2026-09", mes de Lima); uno de una sola entrega, una vez ('').
 */
export function periodoDe(tipo, cuando = new Date()) {
  if (!TIPOS[tipo]?.recargable) return '';
  return cuando.toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).slice(0, 7);
}
export const esTipo = (t) => Object.hasOwn(TIPOS, t);

/** Texto del memo. Un memo de texto admite 28 bytes: "rubro:electro" usa 13. */
export const memoDeRubro = (r) => `rubro:${r}`;

/**
 * Rubros que admite un programa de un tipo dado. Para la prestacion
 * alimentaria los fija la ley; para un bono, los elige la empresa.
 *
 * @param {string} tipo
 * @param {string[]} [elegidos]
 * @returns {string[]}
 */
export function rubrosDe(tipo, elegidos = []) {
  if (!esTipo(tipo)) throw new TypeError(`Tipo de programa desconocido: ${tipo}.`);
  if (TIPOS[tipo].fijo) return [...TIPOS[tipo].rubros];
  const validos = [...new Set(elegidos)].filter(esRubro);
  if (!validos.length) throw new TypeError('Elige al menos un rubro para el programa.');
  return validos;
}
