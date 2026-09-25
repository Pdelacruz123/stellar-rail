/**
 * Lo que viaja en los QR de StellarRail, y como leerlo.
 *
 * - El QR de cobro de la tienda es un enlace web normal (#/cobro/<token>):
 *   se lee con el boton "Pagar" de la aplicacion o con la camara de
 *   cualquier celular, que lo abre en el navegador.
 * - La tarjeta impresa de quien no tiene smartphone lleva su numero
 *   (SR-XXXX-XXXX), que la tienda escanea o escribe.
 */

export const enlaceCobro = (token) => `${window.location.origin}/#/cobro/${token}`;
export const enlaceRestablecer = (token) => `${window.location.origin}/#/restablecer/${token}`;

/**
 * "sr-4k7p 9qxa" -> "SR-4K7P-9QXA": el numero de una tarjeta impresa, como
 * lo escriba la tienda o lo lea la camara. Es el mismo formato que
 * lib/credenciales.js, que no se importa aqui porque usa node:crypto.
 */
export function leerTarjeta(texto) {
  const t = String(texto ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = /^SR([0-9A-Z]{4})([0-9A-Z]{4})$/.exec(t);
  return m ? `SR-${m[1]}-${m[2]}` : null;
}

/**
 * Que trae un QR escaneado.
 *
 * @returns {{tipo:'cobro', token:string} | {tipo:'tarjeta', numero:string} | null}
 */
export function leerQr(texto) {
  const t = String(texto ?? '').trim();
  const tarjeta = leerTarjeta(t);
  if (tarjeta) return { tipo: 'tarjeta', numero: tarjeta };
  const cobro = /#\/cobro\/([\w.-]+)/.exec(t);
  if (cobro) return { tipo: 'cobro', token: cobro[1] };
  return null;
}

/** 155597 -> "155 597": mas facil de leer en voz alta y de escribir. */
export const agrupar = (codigo) => String(codigo ?? '').replace(/^(\d{3})(\d{3})$/, '$1 $2');
