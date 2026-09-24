/**
 * Rubros de gasto y tipos de programa.
 *
 * Lo comparten el servidor y la interfaz: un solo catalogo, una sola verdad.
 *
 * LO QUE LA RED NO VE. Stellar sabe quien le paga a quien y cuanto, pero no
 * que se compro. La canasta solo la ve el comercio. Por eso el rubro lo
 * DECLARA el comercio en cada cobro, y esa declaracion viaja en el memo de la
 * transaccion: queda en el libro publico. Si un comercio cobra una tele como
 * "alimentos", la mentira queda registrada, y la sancion (desafiliarlo) si la
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
 * Tipos de programa.
 *
 * La prestacion alimentaria de la Ley 28051 es para la "adquisicion exclusiva
 * de alimentos": la empresa NO puede decidir que se gaste en otra cosa. Un
 * bono o incentivo no tiene esa restriccion, y ahi si decide la empresa.
 */
export const TIPOS = Object.freeze({
  alimentaria: {
    nombre: 'Prestación alimentaria (Ley 28051)',
    rubros: ['alimentos'],
    fijo: true,
  },
  bono: {
    nombre: 'Bono o incentivo',
    rubros: null,
    fijo: false,
  },
});

export const esRubro = (r) => Object.hasOwn(RUBROS, r);
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
