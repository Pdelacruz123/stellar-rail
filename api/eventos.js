/**
 * GET /api/eventos
 *
 * Historial del espacio, solo para la empresa: cada accion con su hash y su
 * enlace al explorador publico. Incluye las transacciones que la red
 * rechazo, que tambien quedan en el ledger y son la prueba central.
 */
import {
  exigir, identidad, json, manejar, riel,
} from '../lib/http.js';
import * as db from '../lib/db.js';

export default manejar({
  async GET(req, res) {
    const yo = await identidad(req, res);
    if (!exigir(yo, res, 'empresa')) return undefined;
    const r = riel();
    const filas = await db.eventosDe(yo.sesion, 100);
    json(res, 200, {
      eventos: filas.map((e) => ({ ...e, explorador: r.explorador(e.hash) })),
    });
  },
});
