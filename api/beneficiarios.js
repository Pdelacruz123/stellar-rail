/**
 * /api/beneficiarios
 *
 *   GET                                        la empresa ve a todos; un
 *                                              trabajador, solo a si mismo
 *   POST { nombre }                            registrarse (con invitacion)
 *                                              o darlo de alta (la empresa)
 *   POST { accion:'verificar', id, aprobar }   la empresa aprueba o rechaza
 *
 * Las acciones van en el cuerpo y no en la ruta porque Vercel convierte cada
 * archivo de `api/` en una funcion, y el plan gratuito admite 12.
 */
import {
  anotar, cuerpo, exigir, identidad, json, manejar, ponerRol, riel,
} from '../lib/http.js';
import { derivarCuenta } from '../lib/cuentas.js';
import * as db from '../lib/db.js';

export default manejar({
  async GET(req, res) {
    const yo = await identidad(req, res);
    if (yo.rol === 'empresa') {
      return json(res, 200, { beneficiarios: await db.beneficiariosDe(yo.sesion) });
    }
    if (yo.rol === 'beneficiario') {
      const propio = yo.id === null ? null : await db.beneficiario(yo.sesion, yo.id);
      return json(res, 200, { beneficiarios: propio ? [propio] : [] });
    }
    return json(res, 403, { error: 'Esta acción no corresponde a tu perfil.' });
  },

  async POST(req, res) {
    const yo = await identidad(req, res);
    const datos = await cuerpo(req);
    const r = riel();

    if (datos.accion === 'verificar') {
      if (!exigir(yo, res, 'empresa')) return undefined;
      const fila = await db.beneficiario(yo.sesion, datos.id);
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
      const evento = await anotar(yo.sesion, 'autorizar', tx, r);
      if (!tx.ok) return json(res, 502, { error: tx.mensaje, transaccion: evento });
      const verificado = await db.guardarVerificacion('beneficiarios', fila.id, 'verificado', tx.hash);
      return json(res, 200, { beneficiario: verificado, transaccion: evento });
    }

    if (!exigir(yo, res, 'empresa', 'beneficiario')) return undefined;
    if (yo.rol === 'beneficiario' && yo.id !== null) {
      return json(res, 409, { error: 'Ya estás registrado.' });
    }

    const nombre = String(datos.nombre ?? '').trim();
    if (!nombre) return json(res, 400, { error: 'Falta el nombre.' });

    // El id se reserva antes de insertar: la cuenta se deriva de el.
    const id = await db.siguienteId('beneficiarios');
    const cuenta = derivarCuenta({ sesion: yo.sesion, rol: 'beneficiario', id });

    const tx = await r.crearCuentaPatrocinada(cuenta);
    const evento = await anotar(yo.sesion, 'alta-beneficiario', tx, r);
    if (!tx.ok) return json(res, 502, { error: 'No se pudo crear la cuenta.', transaccion: evento });

    const fila = await db.crearBeneficiario({
      id, sesion: yo.sesion, nombre, cuentaPublica: cuenta.publicKey(),
    });

    // Si se registro con una invitacion, este celular pasa a ser el suyo.
    if (yo.rol === 'beneficiario') ponerRol(req, res, yo.sesion, 'beneficiario', fila.id);
    return json(res, 201, { beneficiario: fila, transaccion: evento });
  },
});
