/**
 * GET /api/eventos
 *
 * Historial de esta sesion: cada accion con su hash y su enlace al
 * explorador publico. Incluye las transacciones que la red rechazo, que
 * tambien quedan en el ledger y son la prueba central del proyecto.
 */
import { json, manejar, riel, sesionDe } from '../lib/http.js';
import * as db from '../lib/db.js';

export default manejar({
  async GET(req, res) {
    const sesion = await sesionDe(req, res);
    const r = riel();
    const filas = await db.eventosDe(sesion, 100);
    json(res, 200, {
      eventos: filas.map((e) => ({
        ...e,
        explorador: r.explorador(e.hash),
      })),
    });
  },
});
