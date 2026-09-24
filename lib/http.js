/**
 * Ayudantes compartidos por los endpoints de `api/`.
 *
 * Vive fuera de `api/` a proposito: Vercel convierte en funcion CADA archivo
 * de esa carpeta, y el plan gratuito admite 12 por despliegue.
 *
 * SESIONES. Cada persona tiene un usuario (ver lib/credenciales.js). Al
 * entrar recibe una CREDENCIAL firmada con MASTER_SEED:
 *
 *     <espacio>.u:<usuario>:<version>.<firma>
 *
 * La credencial viaja en una cookie o, si la hay, en la cabecera
 * `x-stellarrail-credencial`. La cabecera permite algo que las cookies no:
 * tener varias sesiones distintas abiertas a la vez en la misma pestana. Es
 * lo que usa la vista de tres pantallas de la demostracion, donde la
 * empresa, la tienda y el trabajador conviven en una sola computadora.
 *
 * Subir la `version` del usuario invalida todas sus credenciales: asi se
 * cierran sus sesiones en todos los dispositivos.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { crearRiel } from './riel/index.js';
import * as db from './db.js';

const COOKIE = 'rail_credencial';
const CABECERA = 'x-stellarrail-credencial';
const DIAS = 60 * 60 * 24 * 30;

/** Roles a los que se puede invitar. A la empresa no se la invita: se registra. */
const INVITABLES = ['beneficiario', 'comercio'];

// ---------------------------------------------------------------------------
// HTTP basico
// ---------------------------------------------------------------------------

/** Responde en JSON. */
export function json(res, estado, cuerpo) {
  res.statusCode = estado;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Nada de esto se puede cachear: son datos de una persona concreta.
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(cuerpo));
}

/** Lee el cuerpo JSON. Vercel suele darlo ya interpretado; si no, se lee. */
export async function cuerpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const trozos = [];
  for await (const t of req) trozos.push(t);
  if (!trozos.length) return {};
  try { return JSON.parse(Buffer.concat(trozos).toString('utf8')); } catch { return {}; }
}

function leerCookies(req) {
  const crudo = req.headers?.cookie ?? '';
  return Object.fromEntries(crudo.split(';').map((p) => {
    const i = p.indexOf('=');
    return i < 0 ? [p.trim(), ''] : [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1).trim())];
  }).filter(([k]) => k));
}

function ponerCookie(res, req, valor, maxAge = DIAS) {
  // Secure rompe el desarrollo local en http, asi que solo se pone donde hay https.
  const https = req.headers?.['x-forwarded-proto'] === 'https' || Boolean(process.env.VERCEL);
  const partes = [
    `${COOKIE}=${encodeURIComponent(valor)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`,
    https ? 'Secure' : null,
  ].filter(Boolean);
  res.setHeader('Set-Cookie', partes.join('; '));
}

// ---------------------------------------------------------------------------
// Firmas
// ---------------------------------------------------------------------------

export function firmar(texto, largo = 32) {
  const semilla = process.env.MASTER_SEED;
  if (!semilla) throw new Error('Falta MASTER_SEED.');
  return createHmac('sha256', semilla).update(texto).digest('base64url').slice(0, largo);
}

export function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Credenciales y sesiones
// ---------------------------------------------------------------------------

/** La credencial de un usuario, tal como se guarda en la cookie o la cabecera. */
export function credencialDe(usuario) {
  const valor = `u:${usuario.id}:${usuario.version}`;
  return `${usuario.sesion_id}.${valor}.${firmar(`cred|${usuario.sesion_id}|${valor}`)}`;
}

/** Comprueba la firma de una credencial. No consulta la base de datos. */
export function leerCredencial(credencial) {
  const partes = String(credencial ?? '').split('.');
  if (partes.length !== 3) return null;
  const [sesion, valor, firma] = partes;
  if (!iguales(firma, firmar(`cred|${sesion}|${valor}`))) return null;
  const m = /^u:(\d+):(\d+)$/.exec(valor);
  return m ? { sesion, usuarioId: Number(m[1]), version: Number(m[2]) } : null;
}

/**
 * Quien hace la peticion, o null si nadie entro. La cabecera tiene
 * prioridad sobre la cookie: asi cada pantalla de la vista triple lleva su
 * propia sesion aunque compartan navegador.
 */
export async function leerIdentidad(req) {
  const credencial = req.headers?.[CABECERA] || leerCookies(req)[COOKIE];
  const c = leerCredencial(credencial);
  if (!c) return null;
  const u = await db.usuarioPorId(c.usuarioId);
  // Si la version cambio, la sesion se cerro en todos los dispositivos.
  if (!u || u.sesion_id !== c.sesion || u.version !== c.version) return null;
  return {
    sesion: u.sesion_id,
    rol: u.rol,
    id: u.ref_id,
    usuarioId: u.id,
    identificador: u.identificador,
  };
}

/** Como leerIdentidad, pero responde 401 si nadie entro. */
export async function exigirSesion(req, res) {
  const yo = await leerIdentidad(req);
  if (!yo) json(res, 401, { error: 'Tu sesión terminó. Vuelve a entrar.', sinSesion: true });
  return yo;
}

/** Deja la sesion iniciada en este navegador y devuelve la credencial. */
export function iniciarSesion(req, res, usuario) {
  const credencial = credencialDe(usuario);
  ponerCookie(res, req, credencial);
  return credencial;
}

export function cerrarSesion(req, res) {
  ponerCookie(res, req, '', 0);
}

/** Corta la peticion si el rol no es uno de los permitidos. */
export function exigir(yo, res, ...roles) {
  if (yo?.rol && roles.includes(yo.rol)) return true;
  json(res, 403, { error: 'Esta acción no corresponde a tu perfil.' });
  return false;
}

// ---------------------------------------------------------------------------
// Invitaciones
// ---------------------------------------------------------------------------

/**
 * Enlace de invitacion de un espacio para un rol. Es estable: el mismo
 * enlace sirve para invitar a todos los trabajadores, o a todas las tiendas.
 *
 * Invitar no aprueba a nadie. Quien se registra con el enlace queda
 * pendiente, y la empresa tiene que verificarlo; al aprobarlo se ejecuta la
 * autorizacion en la red.
 */
export function tokenDeInvitacion(sesion, rol) {
  if (!INVITABLES.includes(rol)) throw new TypeError(`No se puede invitar como ${rol}.`);
  return `${sesion}.${rol}.${firmar(`inv|${sesion}|${rol}`)}`;
}

export function leerInvitacion(token) {
  const [sesion, rol, firma, ...resto] = String(token ?? '').split('.');
  if (resto.length || !sesion || !firma || !INVITABLES.includes(rol)) return null;
  if (!iguales(firma, firmar(`inv|${sesion}|${rol}`))) return null;
  return { sesion, rol };
}

// ---------------------------------------------------------------------------
// Restablecer el PIN, sin SMS
// ---------------------------------------------------------------------------

const RESTABLECER_HORAS = 24;

/**
 * Enlace para que alguien que olvido su PIN ponga uno nuevo. La empresa se
 * lo comparte por WhatsApp o se lo muestra en Recursos Humanos: no hace
 * falta ningun SMS, que en su version gratuita solo llega al desarrollador.
 *
 * Sirve una sola vez: lleva la version del usuario, y cambiar el PIN la sube.
 */
export function tokenDeRestablecer(usuario, ahora = Date.now()) {
  const expira = Math.floor(ahora / 1000) + RESTABLECER_HORAS * 3600;
  const carga = `${usuario.id}.${usuario.version}.${expira.toString(36)}`;
  return `${carga}.${firmar(`reset|${carga}`)}`;
}

export function leerRestablecer(token, ahora = Date.now()) {
  const partes = String(token ?? '').split('.');
  if (partes.length !== 4) return null;
  const [id, version, exp36, firma] = partes;
  if (!iguales(firma, firmar(`reset|${id}.${version}.${exp36}`))) return null;
  if (Math.floor(ahora / 1000) > parseInt(exp36, 36)) return null;
  return { usuarioId: Number(id), version: Number(version) };
}

// ---------------------------------------------------------------------------
// Riel y manejo de errores
// ---------------------------------------------------------------------------

/**
 * El riel para esta peticion, con el candado del emisor puesto.
 *
 * El candado solo envuelve los envios cuyo origen es el emisor: una cuenta
 * consume una sola secuencia por ledger y el emisor firma casi todo. Los
 * pagos de los trabajadores no pasan por ahi.
 */
export function riel() {
  return crearRiel({ candado: db.conCandadoDelEmisor });
}

/**
 * Envuelve un manejador: interpreta el metodo, captura errores y evita que
 * un fallo del servidor se le muestre crudo a una persona.
 *
 * @param {Record<string, (req, res) => Promise<void>>} metodos
 */
export function manejar(metodos) {
  return async function handler(req, res) {
    try {
      const fn = metodos[req.method];
      if (!fn) {
        res.setHeader('Allow', Object.keys(metodos).join(', '));
        return json(res, 405, { error: `Método ${req.method} no admitido aquí.` });
      }
      return await fn(req, res);
    } catch (e) {
      // Las validaciones lanzan TypeError: son culpa de la peticion, no del
      // servidor, y su mensaje ya esta escrito para leerse.
      if (e instanceof TypeError) return json(res, 400, { error: e.message });
      // Celular o correo repetido.
      if (e?.code === '23505') return json(res, 409, { error: 'Ese celular o correo ya está registrado.' });
      // El detalle va al log del servidor, no a la pantalla del usuario.
      console.error('[stellarrail]', e);
      return json(res, 500, { error: 'Algo falló en el servidor. Inténtalo de nuevo.' });
    }
  };
}

/**
 * Anota el resultado de una transaccion y lo devuelve en la forma que espera
 * la interfaz: con el enlace al explorador, que es la prueba.
 */
export async function anotar(sesion, tipo, r, servidorRiel) {
  await db.anotarEvento(sesion, tipo, r);
  return {
    ok: r.ok,
    hash: r.hash,
    ledger: r.ledger ?? null,
    explorador: servidorRiel.explorador(r.hash),
    ...(r.ok ? {} : { codigo: r.codigo, mensaje: r.mensaje, enElLedger: r.enElLedger }),
  };
}
