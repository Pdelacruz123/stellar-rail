/**
 * GET /api/sesion
 *
 * Primera llamada de cualquier vista. Devuelve la sesion del visitante,
 * creandola si es su primera visita, y la configuracion publica que la
 * interfaz necesita para leer Horizon por su cuenta.
 */
import { esAdmin, json, manejar, riel, sesionDe } from '../lib/http.js';

export default manejar({
  async GET(req, res) {
    const sesion = await sesionDe(req, res);
    const r = riel();
    json(res, 200, {
      sesion,
      admin: esAdmin(req),
      emisor: r.emisor,
      activo: r.assetCode,
      horizon: r.horizonUrl,
    });
  },
});
