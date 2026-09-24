/**
 * Ayudantes compartidos por los endpoints de `api/`.
 *
 * Vive fuera de `api/` a proposito: Vercel convierte en funcion CADA archivo
 * de esa carpeta, y el plan gratuito admite 12 por despliegue.
 *
 * ACCESO SIN CONTRASENAS. Cada empresa tiene su propio espacio. Quien abre la
 * aplicacion sin traer un espacio crea uno y es la empresa. La empresa invita
 * a trabajadores y comercios con un enlace; cada invitado lo abre en su
 * celular y entra directo a su pantalla. Nadie escribe claves.
 *
 * El rol de cada dispositivo viaja en una cookie FIRMADA con MASTER_SEED y
 * atada al espacio. Conocer el identificador de un espacio no da acceso a
 * nada: sin la firma, quien lo intente recibe un espacio nuevo y vacio.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { crearRiel } from './riel/index.js';
import * as db from './db.js';
import { nuevaSesion } from './cuentas.js';

const COOKIE_SESION = 'rail_sesion';
const COOKIE_ROL = 'rail_rol';
const DIAS = 60 * 60 * 24 * 30;

export const ROLES = Object.freeze(['empresa', 'beneficiario', 'comercio']);
/** Roles a los que se puede invitar. A la empresa no se la invita: se crea. */
const INVITABLES = ['beneficiario', 'comercio'];

// ---------------------------------------------------------------------------
// HTTP basico
// ---------------------------------------------------------------------------

/** Responde en JSON. */
export function json(res, estado, cuerpo) {
  res.statusCode = estado;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Nada de esto se puede cachear: son datos de un espacio concreto.
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

function ponerCookie(res, nombre, valor, req) {
  // Secure rompe el desarrollo local en http, asi que solo se pone donde hay https.
  const https = req.headers?.['x-forwarded-proto'] === 'https' || Boolean(process.env.VERCEL);
  const partes = [
    `${nombre}=${encodeURIComponent(valor)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${DIAS}`,
    https ? 'Secure' : null,
  ].filter(Boolean);
  const previas = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(previas ? [].concat(previas) : []), partes.join('; ')]);
}

// ---------------------------------------------------------------------------
// Firmas
// ---------------------------------------------------------------------------

function firmar(texto) {
  const semilla = process.env.MASTER_SEED;
  if (!semilla) throw new Error('Falta MASTER_SEED.');
  return createHmac('sha256', semilla).update(texto).digest('base64url').slice(0, 32);
}

function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Rol del dispositivo
// ---------------------------------------------------------------------------

/**
 * El valor de la cookie de rol: `empresa`, `beneficiario` (invitado que aun
 * no se registro) o `beneficiario:5` (ya registrado), seguido de su firma.
 */
function valorDeRol(rol, id) {
  return id === null || id === undefined ? rol : `${rol}:${id}`;
}

function cookieDeRol(sesion, rol, id) {
  const valor = valorDeRol(rol, id);
  return `${valor}.${firmar(`rol|${sesion}|${valor}`)}`;
}

function leerRol(sesion, crudo) {
  if (!crudo) return null;
  const i = crudo.lastIndexOf('.');
  if (i < 0) return null;
  const valor = crudo.slice(0, i);
  if (!iguales(crudo.slice(i + 1), firmar(`rol|${sesion}|${valor}`))) return null;
  const [rol, id] = valor.split(':');
  if (!ROLES.includes(rol)) return null;
  return { rol, id: id === undefined ? null : Number(id) };
}

export function ponerRol(req, res, sesion, rol, id = null) {
  ponerCookie(res, COOKIE_ROL, cookieDeRol(sesion, rol, id), req);
}

/** Quien hace la peticion, sin crear nada. `null` si no trae un rol valido. */
export async function leerIdentidad(req) {
  const galletas = leerCookies(req);
  const sesion = galletas[COOKIE_SESION];
  if (!sesion) return null;
  const rol = leerRol(sesion, galletas[COOKIE_ROL]);
  if (!rol) return null;
  if (!await db.existeSesion(sesion)) return null;
  return { sesion, ...rol };
}

/**
 * Quien hace la peticion. Si no trae un espacio con un rol firmado, se le
 * crea un espacio nuevo y es su empresa.
 *
 * Asi el jurado, o cualquiera, abre la URL y ya puede recorrer todo, sin
 * contrasenas. Y como cada espacio esta aislado, ser "la empresa" de un
 * espacio no da poder sobre ningun otro.
 */
export async function identidad(req, res) {
  const actual = await leerIdentidad(req);
  if (actual) return actual;
  const sesion = nuevaSesion();
  await db.crearSesion(sesion);
  ponerCookie(res, COOKIE_SESION, sesion, req);
  ponerRol(req, res, sesion, 'empresa');
  return { sesion, rol: 'empresa', id: null };
}

/** Corta la peticion si el rol no es uno de los permitidos. */
export function exigir(yo, res, ...roles) {
  if (yo.rol && roles.includes(yo.rol)) return true;
  json(res, 403, { error: 'Esta acción no corresponde a tu perfil.' });
  return false;
}

// ---------------------------------------------------------------------------
// Invitaciones
// ---------------------------------------------------------------------------

/**
 * Enlace de invitacion de un espacio para un rol. Es estable: el mismo
 * enlace sirve para invitar a todos los trabajadores, o a todos los
 * comercios, y se puede compartir por WhatsApp o imprimir como QR.
 *
 * Invitar no aprueba a nadie. Quien entra con el enlace queda pendiente,
 * y la empresa tiene que verificarlo; al aprobarlo se ejecuta la
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

/**
 * Hace entrar a un dispositivo en un espacio con el rol de la invitacion.
 * Si ya estaba ahi con ese mismo rol, no se toca: volver a abrir el enlace
 * no tiene que obligar a registrarse otra vez.
 */
export async function unirse(req, res, token) {
  const inv = leerInvitacion(token);
  if (!inv) return { error: 'Esta invitación no es válida.', estado: 400 };
  if (!await db.existeSesion(inv.sesion)) {
    return { error: 'Esta invitación ya no existe.', estado: 404 };
  }
  const actual = await leerIdentidad(req);
  if (actual && actual.sesion === inv.sesion && actual.rol === inv.rol) {
    return { yo: actual };
  }
  ponerCookie(res, COOKIE_SESION, inv.sesion, req);
  ponerRol(req, res, inv.sesion, inv.rol);
  return { yo: { sesion: inv.sesion, rol: inv.rol, id: null } };
}

// ---------------------------------------------------------------------------
// Riel y manejo de errores
// ---------------------------------------------------------------------------

/**
 * El riel para esta peticion, con el candado del emisor puesto.
 *
 * El candado solo envuelve los envios cuyo origen es el emisor: una cuenta
 * consume una sola secuencia por ledger y el emisor firma casi todo. Los
 * pagos de los beneficiarios no pasan por ahi.
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
      // El detalle va al log del servidor, no a la pantalla del usuario.
      console.error('[rail]', e);
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
