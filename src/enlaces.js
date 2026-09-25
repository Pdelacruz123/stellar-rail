/**
 * Los enlaces que viajan en los QR de StellarRail, y como leerlos.
 *
 * Todos son enlaces web normales. Asi funcionan de dos maneras:
 *  - con el boton "Pagar con QR" de la propia aplicacion, como en Yape;
 *  - con la camara del celular, que abre el enlace en el navegador.
 */

export const enlaceFijo = (codigo) => `${window.location.origin}/#/pagar/${codigo}`;
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
 * Que trae un QR escaneado. Acepta el enlace completo o solo el codigo de
 * 6 numeros.
 *
 * @returns {{tipo:'fijo', codigo:string} | {tipo:'cobro', token:string}
 *   | {tipo:'tarjeta', numero:string} | {tipo:'invitacion'} | null}
 */
export function leerQr(texto) {
  const t = String(texto ?? '').trim();
  const tarjeta = leerTarjeta(t);
  if (tarjeta) return { tipo: 'tarjeta', numero: tarjeta };
  const cobro = /#\/cobro\/([\w.-]+)/.exec(t);
  if (cobro) return { tipo: 'cobro', token: cobro[1] };
  const fijo = /#\/pagar\/(\d{6})(?!\d)/.exec(t);
  if (fijo) return { tipo: 'fijo', codigo: fijo[1] };
  const solo = t.replace(/\s/g, '');
  if (/^\d{6}$/.test(solo)) return { tipo: 'fijo', codigo: solo };
  if (/#\/unirse\//.test(t)) return { tipo: 'invitacion' };
  return null;
}

/**
 * Los datos de un cobro con monto, para mostrarlos ANTES de pagar.
 *
 * Aqui no se comprueba nada: el cobro va firmado y la firma la comprueba el
 * servidor al pagar. Si alguien lo altera, el pago se rechaza.
 */
export function verCobro(token) {
  const [id, centimos, rubro, exp36] = String(token ?? '').split('.');
  const c = Number(centimos);
  if (!Number.isInteger(c) || !id || !rubro || !exp36) return null;
  return {
    comercioId: Number(id),
    monto: `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`,
    rubro,
    expira: parseInt(exp36, 36) * 1000,
  };
}

/** 155597 -> "155 597": mas facil de leer en voz alta y de copiar. */
export const agrupar = (codigo) => String(codigo ?? '').replace(/^(\d{3})(\d{3})$/, '$1 $2');
