/**
 * Lo que viaja en los QR de StellarRail, y como leerlo.
 *
 * El QR de cobro de la tienda es un enlace web normal (#/cobro/<token>): se
 * lee con el boton "Escanear QR" de la aplicacion o con la camara de
 * cualquier celular, que lo abre en el navegador.
 */

export const enlaceCobro = (token) => `${window.location.origin}/#/cobro/${token}`;
export const enlaceRestablecer = (token) => `${window.location.origin}/#/restablecer/${token}`;

/**
 * Que trae un QR escaneado.
 *
 * @returns {{tipo:'cobro', token:string} | null}
 */
export function leerQr(texto) {
  const cobro = /#\/cobro\/([\w.-]+)/.exec(String(texto ?? '').trim());
  return cobro ? { tipo: 'cobro', token: cobro[1] } : null;
}

/** 155597 -> "155 597": mas facil de leer en voz alta y de escribir. */
export const agrupar = (codigo) => String(codigo ?? '').replace(/^(\d{3})(\d{3})$/, '$1 $2');
