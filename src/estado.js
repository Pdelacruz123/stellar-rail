/**
 * Estado compartido por las vistas.
 *
 * No hay saldos aqui. El saldo vive en Stellar y se lee de Horizon cada vez
 * que hace falta: si lo guardaramos, tendriamos una segunda verdad que puede
 * discrepar de la red.
 */
import { reactive } from 'vue';
import { api } from './api.js';

export const estado = reactive({
  cargando: true,
  yo: null,            // { sesion, rol, id, emisor, activo, horizon, invitaciones? }
  beneficiarios: [],
  comercios: [],
  programas: [],
  eventos: [],
  error: null,
});

/** Lo que cada perfil puede ver. La API lo hace cumplir; esto evita pedir de mas. */
const QUE_VE = {
  empresa: ['beneficiarios', 'comercios', 'programas', 'eventos'],
  beneficiario: ['beneficiarios', 'comercios', 'programas'],
  comercio: ['comercios'],
};

export async function recargar() {
  const lista = QUE_VE[estado.yo?.rol] ?? [];
  const resultados = await Promise.all(lista.map((k) => api[k]()));
  lista.forEach((k, i) => { estado[k] = resultados[i][k]; });
}

export async function refrescarYo() {
  estado.yo = await api.sesion();
}

export async function arrancar() {
  estado.cargando = true;
  estado.error = null;
  try {
    // Un enlace de invitacion: #/unirse/<token>
    const invitacion = /^#\/unirse\/(.+)$/.exec(window.location.hash);
    if (invitacion) {
      estado.yo = await api.unirse(decodeURIComponent(invitacion[1]));
      // Se reemplaza el enlace: si se recarga la pagina, no se vuelve a canjear.
      window.location.replace(`#/${estado.yo.rol}`);
    } else {
      await refrescarYo();
    }
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

/** El programa vigente, si hay uno. Solo puede haber uno a la vez. */
export const programaVigente = () =>
  [...estado.programas].reverse().find((p) => p.estado === 'vigente') ?? null;

export const soles = (n) => `S/ ${Number(n).toFixed(2)}`;

/**
 * 2026-10-24 -> 24/10/2026. Se recorta el texto en vez de usar Date: una
 * fecha a medianoche en UTC, mostrada con la hora de Peru, retrocede un dia.
 */
export function fecha(valor) {
  const [a, m, d] = String(valor ?? '').slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : '';
}
export const corto = (h) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/** Acepta "18,50" y "18.50". Devuelve el texto listo para la API, o null. */
export function montoValido(texto) {
  const t = String(texto ?? '').trim().replace(',', '.');
  return /^\d{1,9}(\.\d{1,2})?$/.test(t) && Number(t) > 0 ? t : null;
}
