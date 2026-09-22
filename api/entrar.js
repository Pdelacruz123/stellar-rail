/**
 * POST /api/entrar  { clave }
 *
 * Puerta del panel del emisor. La URL es publica: sin esto, cualquiera
 * podria aprobar beneficiarios o vencer el programa y dejar la demo
 * inservible. La clave esta en el README para que el jurado pueda entrar.
 */
import { cuerpo, entrarComoAdmin, json, manejar } from '../lib/http.js';

export default manejar({
  async POST(req, res) {
    const { clave } = await cuerpo(req);
    if (!entrarComoAdmin(req, res, clave)) {
      return json(res, 401, { error: 'Clave incorrecta.' });
    }
    return json(res, 200, { admin: true });
  },
});
