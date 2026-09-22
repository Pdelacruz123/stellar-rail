/**
 * /api/comercios
 *
 *   GET                                     lista los de esta sesion
 *   POST { nombre, distrito, telefono }     registra uno nuevo
 *   POST { accion:'verificar', id, aprobar }    el emisor afilia o rechaza
 *
 * El registro pide tres campos y ninguno obligatorio salvo el nombre. Muchas
 * bodegas de Lima no tienen RUC o estan en el RUS: exigirlo dejaria fuera al
 * usuario que decimos atender.
 */
import { anotar, cuerpo, exigirAdmin, json, manejar, riel, sesionDe } from '../lib/http.js';
import { codigoCorto, derivarCuenta } from '../lib/cuentas.js';
import * as db from '../lib/db.js';

export default manejar({
  async GET(req, res) {
    const sesion = await sesionDe(req, res);
    json(res, 200, { comercios: await db.comerciosDe(sesion) });
  },

  async POST(req, res) {
    const sesion = await sesionDe(req, res);
    const datos = await cuerpo(req);
    const r = riel();

    if (datos.accion === 'verificar') {
      if (!exigirAdmin(req, res)) return undefined;
      const fila = await db.comercio(sesion, datos.id);
      if (!fila) return json(res, 404, { error: 'Ese comercio no existe.' });
      if (fila.estado !== 'pendiente') {
        return json(res, 409, { error: `Ya estaba ${fila.estado}.` });
      }

      if (!datos.aprobar) {
        const rechazado = await db.guardarVerificacion('comercios', fila.id, 'rechazado');
        return json(res, 200, { comercio: rechazado });
      }

      // Afiliar un comercio no es un campo en una tabla: es esta transaccion,
      // publica y comprobable por cualquiera con el hash.
      const tx = await r.autorizar(fila.cuenta_publica);
      const evento = await anotar(sesion, 'autorizar', tx, r);
      if (!tx.ok) return json(res, 502, { error: tx.mensaje, transaccion: evento });
      const verificado = await db.guardarVerificacion('comercios', fila.id, 'verificado', tx.hash);
      return json(res, 200, { comercio: verificado, transaccion: evento });
    }

    const nombre = String(datos.nombre ?? '').trim();
    if (!nombre) return json(res, 400, { error: 'Falta el nombre del comercio.' });

    const id = await db.siguienteId('comercios');
    const cuenta = derivarCuenta({ sesion, rol: 'comercio', id });

    const tx = await r.crearCuentaPatrocinada(cuenta);
    const evento = await anotar(sesion, 'alta-comercio', tx, r);
    if (!tx.ok) return json(res, 502, { error: 'No se pudo crear la cuenta.', transaccion: evento });

    const fila = await db.crearComercio({
      id,
      sesion,
      nombre,
      distrito: String(datos.distrito ?? '').trim() || null,
      telefono: String(datos.telefono ?? '').trim() || null,
      cuentaPublica: cuenta.publicKey(),
      codigoCorto: codigoCorto({ sesion, id }),
    });
    return json(res, 201, { comercio: fila, transaccion: evento });
  },
});
