/**
 * Estado compartido por las tres vistas.
 *
 * No hay saldos aqui. El saldo vive en Stellar y se lee de Horizon cada vez
 * que hace falta: si lo guardaramos, tendriamos una segunda verdad que puede
 * discrepar de la red.
 */
import { reactive } from 'vue';
import { api } from './api.js';

export const estado = reactive({
  cargando: true,
  config: null,          // sesion, admin, emisor, activo, horizon
  beneficiarios: [],
  comercios: [],
  programas: [],
  eventos: [],
  error: null,
});

export async function cargarSesion() {
  estado.config = await api.sesion();
}

/** Recarga todo lo que la base de datos sabe. */
export async function recargar() {
  const [b, c, p, e] = await Promise.all([
    api.beneficiarios(), api.comercios(), api.programas(), api.eventos(),
  ]);
  estado.beneficiarios = b.beneficiarios;
  estado.comercios = c.comercios;
  estado.programas = p.programas;
  estado.eventos = e.eventos;
}

export async function arrancar() {
  estado.cargando = true;
  estado.error = null;
  try {
    await cargarSesion();
    await recargar();
  } catch (e) {
    estado.error = e.message;
  } finally {
    estado.cargando = false;
  }
}

/** Ejecuta una accion, recarga y deja el error a mano si falla. */
export async function accion(fn) {
  estado.error = null;
  try {
    const r = await fn();
    await recargar();
    return r;
  } catch (e) {
    estado.error = e.message;
    throw e;
  }
}

export const soles = (n) => `S/ ${Number(n).toFixed(2)}`;
export const corto = (h) => `${h.slice(0, 8)}…${h.slice(-6)}`;
