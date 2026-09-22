/**
 * POST /api/pagos  { beneficiarioId, codigo | comercioId, monto }
 *
 * El beneficiario paga a un comercio, escaneando su QR o tecleando el codigo
 * de 6 digitos que la bodega muestra en caja.
 *
 * ESTE ENDPOINT NO COMPRUEBA SI EL COMERCIO ESTA AFILIADO. Es a proposito.
 * Manda el pago y traduce lo que responda la red: si el comercio no esta
 * autorizado devuelve `op_not_authorized`, y ese rechazo es la demostracion
 * central del proyecto. Comprobarlo antes lo convertiria en una regla
 * nuestra, que es justo lo contrario de lo que proponemos.
 *
 * Por eso un rechazo responde 200 y no un error: no es un fallo, es el
 * resultado. La interfaz lo muestra con su hash y su enlace al explorador.
 */
import { anotar, cuerpo, json, manejar, riel, sesionDe } from '../lib/http.js';
import { derivarCuenta } from '../lib/cuentas.js';
import * as db from '../lib/db.js';

export default manejar({
  async POST(req, res) {
    const sesion = await sesionDe(req, res);
    const datos = await cuerpo(req);
    const r = riel();

    const quien = await db.beneficiario(sesion, datos.beneficiarioId);
    if (!quien) return json(res, 404, { error: 'Ese beneficiario no existe.' });

    const destino = datos.codigo
      ? await db.comercioPorCodigo(sesion, String(datos.codigo).trim())
      : await db.comercio(sesion, datos.comercioId);
    if (!destino) {
      return json(res, 404, { error: 'No encontramos ese comercio. Revisa el codigo.' });
    }

    const cuenta = derivarCuenta({ sesion, rol: 'beneficiario', id: quien.id });
    const tx = await r.pagar(cuenta, destino.cuenta_publica, datos.monto);
    const evento = await anotar(sesion, 'pagar', tx, r);

    return json(res, 200, {
      pagado: tx.ok,
      comercio: { id: destino.id, nombre: destino.nombre },
      transaccion: evento,
    });
  },
});
