/**
 * /api/beneficiarios
 *
 *   GET                                    lista los de esta sesion
 *   POST { nombre }                        registra uno nuevo
 *   POST { accion:'verificar', id, aprobar }   el emisor aprueba o rechaza
 *
 * Las acciones van en el cuerpo y no en la ruta porque Vercel convierte cada
 * archivo de `api/` en una funcion, y el plan gratuito admite 12.
 */
import { anotar, cuerpo, exigirAdmin, json, manejar, riel, sesionDe } from '../lib/http.js';
import { derivarCuenta } from '../lib/cuentas.js';
import * as db from '../lib/db.js';

export default manejar({
  async GET(req, res) {
    const sesion = await sesionDe(req, res);
    json(res, 200, { beneficiarios: await db.beneficiariosDe(sesion) });
  },

  async POST(req, res) {
    const sesion = await sesionDe(req, res);
    const datos = await cuerpo(req);
    const r = riel();

    if (datos.accion === 'verificar') {
      if (!exigirAdmin(req, res)) return undefined;
      const fila = await db.beneficiario(sesion, datos.id);
      if (!fila) return json(res, 404, { error: 'Ese beneficiario no existe.' });
      if (fila.estado !== 'pendiente') {
        return json(res, 409, { error: `Ya estaba ${fila.estado}.` });
      }

      // Rechazar no necesita tocar la red: la cuenta simplemente nunca se
      // autoriza, y sin autorizacion el protocolo no le deja tener el vale.
      if (!datos.aprobar) {
        const rechazado = await db.guardarVerificacion('beneficiarios', fila.id, 'rechazado');
        return json(res, 200, { beneficiario: rechazado });
      }

      // Aprobar SI toca la red: esta transaccion es la verificacion.
      const tx = await r.autorizar(fila.cuenta_publica);
      const evento = await anotar(sesion, 'autorizar', tx, r);
      if (!tx.ok) return json(res, 502, { error: tx.mensaje, transaccion: evento });
      const verificado = await db.guardarVerificacion('beneficiarios', fila.id, 'verificado', tx.hash);
      return json(res, 200, { beneficiario: verificado, transaccion: evento });
    }

    const nombre = String(datos.nombre ?? '').trim();
    if (!nombre) return json(res, 400, { error: 'Falta el nombre.' });

    // El id se reserva antes de insertar: la cuenta se deriva de el.
    const id = await db.siguienteId('beneficiarios');
    const cuenta = derivarCuenta({ sesion, rol: 'beneficiario', id });

    const tx = await r.crearCuentaPatrocinada(cuenta);
    const evento = await anotar(sesion, 'alta-beneficiario', tx, r);
    if (!tx.ok) return json(res, 502, { error: 'No se pudo crear la cuenta.', transaccion: evento });

    const fila = await db.crearBeneficiario({
      id, sesion, nombre, cuentaPublica: cuenta.publicKey(),
    });
    return json(res, 201, { beneficiario: fila, transaccion: evento });
  },
});
