/**
 * /api/comercios
 *
 *   GET                                          la empresa ve a todas, con su
 *                                                celular; una tienda, solo a si
 *                                                misma; un trabajador, las del
 *                                                espacio
 *   POST { invitacion, nombre, rubro, distrito,  registrarse con una invitacion
 *          celular, pin }
 *   POST { nombre, rubro, distrito, celular, pin }  la empresa la da de alta
 *   POST { accion:'verificar', id, aprobar }     afiliar o rechazar
 *   POST { accion:'restablecer', id }            enlace para un PIN nuevo
 *   POST { accion:'cobrar', monto }              la tienda genera un QR con
 *                                                monto, firmado, que caduca, y
 *                                                su codigo de 6 numeros
 *
 * El registro pide el nombre y nada mas del negocio. Muchas bodegas de Lima
 * no tienen RUC o estan en el RUS: exigirlo dejaria fuera al usuario que
 * decimos atender.
 */
import {
  anotar, cuerpo, exigir, exigirSesion, iniciarSesion, json, leerIdentidad,
  leerInvitacion, manejar, riel, tokenDeRestablecer,
} from '../lib/http.js';
import { randomInt } from 'node:crypto';
import { altaConAcceso } from '../lib/altas.js';
import { crearCobro } from '../lib/cobros.js';
import { esRubro } from '../lib/rubros.js';
import * as db from '../lib/db.js';

function comprobarRubro(datos) {
  const rubro = datos.rubro ?? 'alimentos';
  if (!esRubro(rubro)) throw new TypeError('Ese rubro no existe.');
  return { ...datos, rubro };
}

export default manejar({
  async GET(req, res) {
    const yo = await exigirSesion(req, res);
    if (!yo) return undefined;
    if (yo.rol === 'empresa') {
      return json(res, 200, { comercios: await db.comerciosConAcceso(yo.sesion) });
    }
    if (yo.rol === 'comercio') {
      const fila = await db.comercio(yo.sesion, yo.id);
      return json(res, 200, { comercios: fila ? [fila] : [] });
    }
    if (yo.rol === 'beneficiario') {
      // El trabajador ve todas las tiendas de su empresa, afiliadas o no.
      // A proposito: la aplicacion no le impide intentar pagar en una no
      // afiliada. Quien lo impide es la red, y eso es lo que se demuestra.
      const todos = await db.comerciosDe(yo.sesion);
      return json(res, 200, {
        comercios: todos.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          distrito: c.distrito,
          rubro: c.rubro,
          afiliado: c.estado === 'verificado',
        })),
      });
    }
    return json(res, 403, { error: 'Esta acción no corresponde a tu perfil.' });
  },

  async POST(req, res) {
    const datos = await cuerpo(req);
    const r = riel();

    // --- Registrarse con una invitacion: todavia no hay sesion.
    if (datos.invitacion) {
      const inv = leerInvitacion(datos.invitacion);
      if (!inv || inv.rol !== 'comercio') return json(res, 400, { error: 'Esta invitación no es válida.' });
      if (!await db.sesion(inv.sesion)) return json(res, 404, { error: 'Esta invitación ya no existe.' });
      const alta = await altaConAcceso(r, inv.sesion, 'comercio', comprobarRubro(datos));
      if (!alta.ok) return json(res, 502, { error: 'No se pudo crear tu cuenta. Inténtalo otra vez.', transaccion: alta.evento });
      iniciarSesion(req, res, alta.usuario);
      return json(res, 201, { comercio: alta.fila, transaccion: alta.evento });
    }

    const yo = await leerIdentidad(req);
    if (!yo) return json(res, 401, { error: 'Tu sesión terminó. Vuelve a entrar.', sinSesion: true });

    // --- Cobrar con monto: el QR dinamico. El rubro lo declara la tienda en
    // cada venta; va firmado, asi que el cliente no puede cambiarlo.
    if (datos.accion === 'cobrar') {
      if (!exigir(yo, res, 'comercio')) return undefined;
      const fila = await db.comercio(yo.sesion, yo.id);
      if (!fila) return json(res, 404, { error: 'Tu tienda no existe.' });
      // El rubro es el de la tienda, fijado al afiliarla: no lo declara en
      // cada venta. Que venda solo lo permitido es responsabilidad del
      // cajero, como con cualquier tarjeta de alimentos.
      const cobro = crearCobro({
        sesion: yo.sesion,
        comercioId: fila.id,
        monto: datos.monto,
        rubro: fila.rubro,
      });
      // Codigo de respaldo de 6 numeros, para quien no puede escanear el QR.
      let codigo = null;
      for (let intento = 0; intento < 12 && !codigo; intento += 1) {
        const candidato = String(randomInt(0, 1_000_000)).padStart(6, '0');
        if (await db.guardarCodigoCobro(yo.sesion, candidato, cobro.token, cobro.expira)) codigo = candidato;
      }
      if (!codigo) throw new Error('No se pudo generar el código del cobro.');
      return json(res, 201, { cobro: { ...cobro, codigo, comercio: { id: fila.id, nombre: fila.nombre } } });
    }

    if (!exigir(yo, res, 'empresa')) return undefined;

    // --- Alta por la empresa: la persona escribe su PIN en ese equipo.
    if (!datos.accion) {
      const alta = await altaConAcceso(r, yo.sesion, 'comercio', comprobarRubro(datos));
      if (!alta.ok) return json(res, 502, { error: 'No se pudo crear la cuenta.', transaccion: alta.evento });
      return json(res, 201, { comercio: alta.fila, transaccion: alta.evento });
    }

    const fila = await db.comercio(yo.sesion, datos.id);
    if (!fila) return json(res, 404, { error: 'Esa tienda no existe.' });

    switch (datos.accion) {
      case 'verificar': {
        if (fila.estado !== 'pendiente') return json(res, 409, { error: `Ya estaba ${fila.estado}.` });
        if (!datos.aprobar) {
          const rechazado = await db.guardarVerificacion('comercios', fila.id, 'rechazado');
          return json(res, 200, { comercio: rechazado });
        }
        // Afiliar una tienda no es un campo en una tabla: es esta transaccion,
        // publica y comprobable por cualquiera con el hash.
        const tx = await r.autorizar(fila.cuenta_publica);
        const evento = await anotar(yo.sesion, 'autorizar', tx, r);
        if (!tx.ok) return json(res, 502, { error: tx.mensaje, transaccion: evento });
        const verificado = await db.guardarVerificacion('comercios', fila.id, 'verificado', tx.hash);
        return json(res, 200, { comercio: verificado, transaccion: evento });
      }

      case 'restablecer': {
        const usuario = await db.usuarioDe(yo.sesion, 'comercio', fila.id);
        if (!usuario) return json(res, 409, { error: 'Esta tienda todavía no tiene acceso.' });
        return json(res, 200, { token: tokenDeRestablecer(usuario), nombre: fila.nombre });
      }

      default:
        return json(res, 400, { error: 'Acción desconocida.' });
    }
  },
});
