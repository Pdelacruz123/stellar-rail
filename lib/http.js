/**
 * Ayudantes compartidos por los endpoints de `api/`.
 *
 * Vive fuera de `api/` a proposito: Vercel convierte en funcion CADA archivo
 * de esa carpeta, y el plan gratuito admite 12 por despliegue. Los ayudantes
 * aqui no cuentan.
 *
 * Todo lo que sale al cliente esta en castellano y sin jerga: el mismo texto
 * puede acabar en la pantalla de una bodega.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { crearRiel } from './riel/index.js';
import * as db from './db.js';
import { claveAdminValida, nuevaSesion } from './cuentas.js';

const COOKIE_SESION = 'rail_sesion';
const COOKIE_ADMIN = 'rail_admin';
const DIAS = 60 * 60 * 24 * 30;

/** Responde en JSON. */
export function json(res, estado, cuerpo) {
  res.statusCode = estado;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Nada de esto se puede cachear: son datos de una sesion concreta.
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

/**
 * Devuelve la sesion del visitante, creandola si hace falta.
 *
 * Cada visitante recibe sus propias cuentas. La URL es publica y el jurado la
 * abre cuando quiera: con un solo mundo compartido, el visitante anterior
 * podria haber vencido el programa y dejar la demo muerta.
 */
export async function sesionDe(req, res) {
  const actual = leerCookies(req)[COOKIE_SESION];
  if (actual && await db.existeSesion(actual)) return actual;
  const nueva = nuevaSesion();
  await db.crearSesion(nueva);
  ponerCookie(res, COOKIE_SESION, nueva, req);
  return nueva;
}

/** Token del panel del emisor. No se puede falsificar sin MASTER_SEED. */
function tokenAdmin() {
  const semilla = process.env.MASTER_SEED;
  if (!semilla) throw new Error('Falta MASTER_SEED.');
  return createHmac('sha256', semilla).update('panel-del-emisor').digest('hex');
}

/** Abre sesion en el panel del emisor si la clave es correcta. */
export function entrarComoAdmin(req, res, clave) {
  if (!claveAdminValida(clave)) return false;
  ponerCookie(res, COOKIE_ADMIN, tokenAdmin(), req);
  return true;
}

export function esAdmin(req) {
  const recibido = leerCookies(req)[COOKIE_ADMIN] ?? '';
  const esperado = tokenAdmin();
  if (recibido.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
}

/** Corta la peticion si quien la hace no es el emisor. */
export function exigirAdmin(req, res) {
  if (esAdmin(req)) return true;
  json(res, 401, { error: 'Esta accion es solo para el emisor. Entra con la clave del panel.' });
  return false;
}

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
 * @param {Record<string, (req, res, ctx) => Promise<void>>} metodos
 */
export function manejar(metodos) {
  return async function handler(req, res) {
    try {
      const fn = metodos[req.method];
      if (!fn) {
        res.setHeader('Allow', Object.keys(metodos).join(', '));
        return json(res, 405, { error: `Metodo ${req.method} no admitido aqui.` });
      }
      return await fn(req, res);
    } catch (e) {
      // Las validaciones del riel lanzan TypeError: son culpa de la peticion,
      // no del servidor, y su mensaje ya esta escrito para leerse.
      if (e instanceof TypeError) return json(res, 400, { error: e.message });
      // El detalle va al log de Vercel, no a la pantalla del usuario.
      console.error('[rail]', e);
      return json(res, 500, { error: 'Algo fallo en el servidor. Intentalo de nuevo.' });
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
