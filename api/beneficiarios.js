/**
 * /api/beneficiarios
 *
 *   GET                                         la empresa ve a todos, con su
 *                                               celular y su tarjeta; un
 *                                               trabajador, solo a si mismo
 *   POST { invitacion, nombre, celular, pin }   registrarse con una invitacion
 *   POST { nombre, celular, pin }               la empresa lo da de alta en RR. HH.
 *   POST { accion:'verificar', id, aprobar }    aprobar o rechazar
 *   POST { accion:'baja', id }                  congelar y anular su saldo
 *   POST { accion:'restablecer', id }           enlace para que ponga un PIN nuevo
 *   POST { accion:'tarjeta', id }               imprimirle una tarjeta (anula la anterior)
 *   POST { accion:'anularTarjeta', id }         anular su tarjeta
 *
 * Las acciones van en el cuerpo y no en la ruta porque Vercel convierte cada
 * archivo de `api/` en una funcion, y el plan gratuito admite 12.
 */
import {
  anotar, cuerpo, exigir, exigirSesion, iniciarSesion, json, leerIdentidad,
  leerInvitacion, manejar, riel, tokenDeRestablecer,
} from '../lib/http.js';
import { altaConAcceso } from '../lib/altas.js';
import { numeroDeTarjeta } from '../lib/credenciales.js';
import * as db from '../lib/db.js';

/** Solo lo que un trabajador necesita saber de si mismo. */
const propio = (b) => b && ({
  id: b.id, nombre: b.nombre, estado: b.estado, cuenta_publica: b.cuenta_publica,
});

export default manejar({
  async GET(req, res) {
    const yo = await exigirSesion(req, res);
    if (!yo) return undefined;
    if (yo.rol === 'empresa') {
      return json(res, 200, { beneficiarios: await db.beneficiariosConAcceso(yo.sesion) });
    }
    if (yo.rol === 'beneficiario') {
      const fila = await db.beneficiario(yo.sesion, yo.id);
      return json(res, 200, { beneficiarios: fila ? [propio(fila)] : [] });
    }
    return json(res, 403, { error: 'Esta acción no corresponde a tu perfil.' });
  },

  async POST(req, res) {
    const datos = await cuerpo(req);
    const r = riel();

    // --- Registrarse con una invitacion: todavia no hay sesion.
    if (datos.invitacion) {
      const inv = leerInvitacion(datos.invitacion);
      if (!inv || inv.rol !== 'beneficiario') {
        return json(res, 400, { error: 'Esta invitación no es válida.' });
      }
      if (!await db.sesion(inv.sesion)) return json(res, 404, { error: 'Esta invitación ya no existe.' });
      const alta = await altaConAcceso(r, inv.sesion, 'beneficiario', datos);
      if (!alta.ok) return json(res, 502, { error: 'No se pudo crear tu cuenta. Inténtalo otra vez.', transaccion: alta.evento });
      iniciarSesion(req, res, alta.usuario);
      return json(res, 201, { beneficiario: propio(alta.fila), transaccion: alta.evento });
    }

    const yo = await leerIdentidad(req);
    if (!yo) return json(res, 401, { error: 'Tu sesión terminó. Vuelve a entrar.', sinSesion: true });
    if (!exigir(yo, res, 'empresa')) return undefined;

    // --- Alta en Recursos Humanos: la persona escribe su PIN en el equipo
    // de la empresa. Nadie mas lo conoce.
    if (!datos.accion) {
      const alta = await altaConAcceso(r, yo.sesion, 'beneficiario', datos);
      if (!alta.ok) return json(res, 502, { error: 'No se pudo crear la cuenta.', transaccion: alta.evento });
      return json(res, 201, { beneficiario: alta.fila, transaccion: alta.evento });
    }

    const fila = await db.beneficiario(yo.sesion, datos.id);
    if (!fila) return json(res, 404, { error: 'Ese trabajador no existe.' });

    switch (datos.accion) {
      case 'verificar': {
        if (fila.estado !== 'pendiente') return json(res, 409, { error: `Ya estaba ${fila.estado}.` });

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

      case 'baja': {
        if (fila.estado === 'baja') return json(res, 409, { error: 'Ya estaba dado de baja.' });
        let evento = null;
        if (fila.estado === 'verificado') {
          // Congelar y anular en UNA transaccion, como al vencer. El saldo se
          // lee de la red: si cambia entre la lectura y el envio, la
          // transaccion falla entera y no deja nada a medias.
          const { saldo } = await r.consultarSaldo(fila.cuenta_publica);
          const tx = await r.vencer(fila.cuenta_publica, saldo);
          evento = await anotar(yo.sesion, 'baja', tx, r);
          if (!tx.ok) return json(res, 502, { error: tx.mensaje, transaccion: evento });
        }
        // Pendiente o rechazado: nunca estuvo autorizado, no hay nada que anular.
        const baja = await db.marcarBaja(yo.sesion, fila.id);
        await db.anularTarjetas(yo.sesion, fila.id);
        const usuario = await db.usuarioDe(yo.sesion, 'beneficiario', fila.id);
        if (usuario) await db.subirVersion(usuario.id);
        return json(res, 200, { beneficiario: baja, transaccion: evento });
      }

      case 'restablecer': {
        const usuario = await db.usuarioDe(yo.sesion, 'beneficiario', fila.id);
        if (!usuario) return json(res, 409, { error: 'Esta persona todavía no tiene acceso.' });
        return json(res, 200, { token: tokenDeRestablecer(usuario), nombre: fila.nombre });
      }

      case 'tarjeta': {
        if (fila.estado === 'baja' || fila.estado === 'rechazado') {
          return json(res, 409, { error: 'No se puede dar una tarjeta a alguien dado de baja o rechazado.' });
        }
        for (let intento = 0; intento < 5; intento += 1) {
          try {
            const t = await db.emitirTarjeta(yo.sesion, fila.id, numeroDeTarjeta());
            return json(res, 201, { tarjeta: t.numero, nombre: fila.nombre });
          } catch (e) {
            if (e?.code !== '23505') throw e;
          }
        }
        throw new Error('No se pudo generar un número de tarjeta único.');
      }

      case 'anularTarjeta':
        await db.anularTarjetas(yo.sesion, fila.id);
        return json(res, 200, { anulada: true });

      default:
        return json(res, 400, { error: 'Acción desconocida.' });
    }
  },
});
