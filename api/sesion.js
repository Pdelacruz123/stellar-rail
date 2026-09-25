/**
 * /api/sesion
 *
 *   GET                                          quien soy (o nadie)
 *   POST { accion:'entrar', identificador, secreto }       celular + PIN, o correo + contrasena
 *   POST { accion:'salir' }                                cerrar esta sesion
 *   POST { accion:'cerrarTodas' }                          cerrarla en todos los dispositivos
 *   POST { accion:'registrarEmpresa', nombre, correo, contrasena }
 *   POST { accion:'invitacion', token }                    de que empresa es una invitacion
 *   POST { accion:'verRestablecer', token }                para quien es un enlace de PIN nuevo
 *   POST { accion:'restablecer', token, pin }              poner el PIN nuevo
 */
import {
  cerrarSesion, cuerpo, exigirSesion, iniciarSesion, json, leerIdentidad,
  leerInvitacion, leerRestablecer, manejar, riel, tokenDeInvitacion,
} from '../lib/http.js';
import { buscarUsuario, comprobarSecreto, crearAccesoConContrasena } from '../lib/acceso.js';
import { cifrar, pinValido } from '../lib/credenciales.js';
import { nuevaSesion } from '../lib/cuentas.js';
import * as db from '../lib/db.js';

const yoDe = (u) => ({
  sesion: u.sesion_id, rol: u.rol, id: u.ref_id, usuarioId: u.id, identificador: u.identificador,
});

/** El nombre de la persona o la tienda, para saludarla. */
async function nombreDe(yo) {
  if (yo.rol === 'beneficiario' && yo.id) return (await db.beneficiario(yo.sesion, yo.id))?.nombre;
  if (yo.rol === 'comercio' && yo.id) return (await db.comercio(yo.sesion, yo.id))?.nombre;
  return null;
}

async function perfil(yo) {
  const r = riel();
  const base = { emisor: r.emisor, activo: r.assetCode, horizon: r.horizonUrl };
  if (!yo) return { ...base, anonimo: true };
  const espacio = await db.sesion(yo.sesion);
  const salida = {
    ...base,
    anonimo: false,
    sesion: yo.sesion,
    rol: yo.rol,
    id: yo.id,
    identificador: yo.identificador,
    nombre: await nombreDe(yo),
    empresa: espacio?.nombre ?? null,
    demo: Boolean(espacio?.es_demo),
  };
  if (yo.rol === 'empresa') {
    salida.invitaciones = {
      beneficiario: tokenDeInvitacion(yo.sesion, 'beneficiario'),
      comercio: tokenDeInvitacion(yo.sesion, 'comercio'),
    };
  }
  return salida;
}

export default manejar({
  async GET(req, res) {
    json(res, 200, await perfil(await leerIdentidad(req)));
  },

  async POST(req, res) {
    const datos = await cuerpo(req);

    switch (datos.accion) {
      case 'entrar': {
        const usuario = await buscarUsuario(datos.identificador);
        if (!usuario) return json(res, 401, { error: 'No encontramos una cuenta con esos datos.' });
        const c = await comprobarSecreto(usuario, datos.secreto);
        if (!c.ok) return json(res, c.estado, { error: c.error });
        iniciarSesion(req, res, usuario);
        return json(res, 200, await perfil(yoDe(usuario)));
      }

      case 'salir':
        cerrarSesion(req, res);
        return json(res, 200, await perfil(null));

      case 'cerrarTodas': {
        const yo = await exigirSesion(req, res);
        if (!yo) return undefined;
        await db.subirVersion(yo.usuarioId);
        cerrarSesion(req, res);
        return json(res, 200, await perfil(null));
      }

      case 'registrarEmpresa': {
        const nombre = String(datos.nombre ?? '').trim();
        if (!nombre) return json(res, 400, { error: 'Escribe el nombre de la empresa.' });
        const sesion = nuevaSesion();
        await db.crearSesion(sesion, { nombre });
        let usuario;
        try {
          usuario = await crearAccesoConContrasena({ sesion, correo: datos.correo, contrasena: datos.contrasena });
        } catch (e) {
          await db.db()`DELETE FROM sesiones WHERE id = ${sesion}`;
          throw e;
        }
        iniciarSesion(req, res, usuario);
        return json(res, 201, await perfil(yoDe(usuario)));
      }

      case 'invitacion': {
        const inv = leerInvitacion(datos.token);
        if (!inv) return json(res, 400, { error: 'Esta invitación no es válida.' });
        const espacio = await db.sesion(inv.sesion);
        if (!espacio) return json(res, 404, { error: 'Esta invitación ya no existe.' });
        return json(res, 200, { rol: inv.rol, empresa: espacio.nombre ?? 'tu empresa' });
      }

      case 'verRestablecer':
      case 'restablecer': {
        const t = leerRestablecer(datos.token);
        const usuario = t && await db.usuarioPorId(t.usuarioId);
        // Si la version cambio, el enlace ya se uso o se cerro la sesion.
        if (!usuario || usuario.version !== t.version || usuario.rol === 'empresa') {
          return json(res, 400, { error: 'Este enlace ya no sirve. Pide uno nuevo a tu empresa.' });
        }
        if (datos.accion === 'verRestablecer') {
          return json(res, 200, { rol: usuario.rol, nombre: await nombreDe(yoDe(usuario)) });
        }
        if (!pinValido(datos.pin)) {
          return json(res, 400, { error: 'El PIN son 4 números. No uses 1234 ni el mismo número repetido.' });
        }
        // Guarda el PIN y NO inicia sesion: el enlace puede abrirse en un
        // equipo donde otra persona tiene su cuenta abierta (Recursos Humanos,
        // por ejemplo). La persona entra despues con su celular y su PIN nuevo.
        const { hash, sal } = await cifrar(datos.pin);
        await db.cambiarSecreto(usuario.id, hash, sal);
        return json(res, 200, { ok: true, rol: usuario.rol, nombre: await nombreDe(yoDe(usuario)) });
      }

      default:
        return json(res, 400, { error: 'Acción desconocida.' });
    }
  },
});
