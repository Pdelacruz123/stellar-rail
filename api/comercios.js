/**
 * /api/comercios
 *
 *   GET                                         la empresa ve a todos; un
 *                                               comercio, solo a si mismo; un
 *                                               trabajador, los del espacio
 *   POST { nombre, distrito, telefono, rubro }  registrarse o darlo de alta
 *   POST { accion:'verificar', id, aprobar }    la empresa afilia o rechaza
 *
 * El registro pide el nombre y nada mas es obligatorio. Muchas bodegas de
 * Lima no tienen RUC o estan en el RUS: exigirlo dejaria fuera al usuario
 * que decimos atender.
 */
import {
  anotar, cuerpo, exigir, identidad, json, manejar, ponerRol, riel,
} from '../lib/http.js';
import { codigoCorto, derivarCuenta } from '../lib/cuentas.js';
import { esRubro } from '../lib/rubros.js';
import * as db from '../lib/db.js';

export default manejar({
  async GET(req, res) {
    const yo = await identidad(req, res);
    if (yo.rol === 'empresa') {
      return json(res, 200, { comercios: await db.comerciosDe(yo.sesion) });
    }
    if (yo.rol === 'comercio') {
      const propio = yo.id === null ? null : await db.comercio(yo.sesion, yo.id);
      return json(res, 200, { comercios: propio ? [propio] : [] });
    }
    if (yo.rol === 'beneficiario') {
      // El trabajador ve todos los comercios de su empresa, afiliados o no.
      // A proposito: la aplicacion no le impide intentar pagar en uno no
      // afiliado. Quien lo impide es la red, y eso es lo que se demuestra.
      const todos = await db.comerciosDe(yo.sesion);
      return json(res, 200, {
        comercios: todos.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          distrito: c.distrito,
          rubro: c.rubro,
          codigo_corto: c.codigo_corto,
          afiliado: c.estado === 'verificado',
        })),
      });
    }
    return json(res, 403, { error: 'Esta acción no corresponde a tu perfil.' });
  },

  async POST(req, res) {
    const yo = await identidad(req, res);
    const datos = await cuerpo(req);
    const r = riel();

    if (datos.accion === 'verificar') {
      if (!exigir(yo, res, 'empresa')) return undefined;
      const fila = await db.comercio(yo.sesion, datos.id);
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
      const evento = await anotar(yo.sesion, 'autorizar', tx, r);
      if (!tx.ok) return json(res, 502, { error: tx.mensaje, transaccion: evento });
      const verificado = await db.guardarVerificacion('comercios', fila.id, 'verificado', tx.hash);
      return json(res, 200, { comercio: verificado, transaccion: evento });
    }

    if (!exigir(yo, res, 'empresa', 'comercio')) return undefined;
    if (yo.rol === 'comercio' && yo.id !== null) {
      return json(res, 409, { error: 'Tu negocio ya está registrado.' });
    }

    const nombre = String(datos.nombre ?? '').trim();
    if (!nombre) return json(res, 400, { error: 'Falta el nombre del negocio.' });
    const rubro = datos.rubro ?? 'alimentos';
    if (!esRubro(rubro)) return json(res, 400, { error: 'Ese rubro no existe.' });

    const id = await db.siguienteId('comercios');
    const cuenta = derivarCuenta({ sesion: yo.sesion, rol: 'comercio', id });

    const tx = await r.crearCuentaPatrocinada(cuenta);
    const evento = await anotar(yo.sesion, 'alta-comercio', tx, r);
    if (!tx.ok) return json(res, 502, { error: 'No se pudo crear la cuenta.', transaccion: evento });

    const fila = await db.crearComercio({
      id,
      sesion: yo.sesion,
      nombre,
      distrito: String(datos.distrito ?? '').trim() || null,
      telefono: String(datos.telefono ?? '').trim() || null,
      rubro,
      cuentaPublica: cuenta.publicKey(),
      codigoCorto: codigoCorto({ sesion: yo.sesion, id }),
    });

    if (yo.rol === 'comercio') ponerRol(req, res, yo.sesion, 'comercio', fila.id);
    return json(res, 201, { comercio: fila, transaccion: evento });
  },
});
