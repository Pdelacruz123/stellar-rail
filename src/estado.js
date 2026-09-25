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
  // { anonimo, sesion, rol, id, nombre, empresa, demo, emisor, activo, horizon, invitaciones? }
  yo: null,
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

export const conSesion = () => Boolean(estado.yo && !estado.yo.anonimo);

export async function recargar() {
  const lista = conSesion() ? QUE_VE[estado.yo.rol] ?? [] : [];
  const resultados = await Promise.all(lista.map((k) => api[k]()));
  lista.forEach((k, i) => { estado[k] = resultados[i][k]; });
}

export async function refrescarYo() {
  estado.yo = await api.sesion();
}

/** Tras entrar o salir: el perfil nuevo y sus datos, sin restos del anterior. */
export async function ponerPerfil(perfil) {
  estado.yo = perfil;
  estado.beneficiarios = [];
  estado.comercios = [];
  estado.programas = [];
  estado.eventos = [];
  estado.error = null;
  await recargar();
}

export async function arrancar() {
  estado.cargando = true;
  estado.error = null;
  try {
    await refrescarYo();
    await recargar();
  } catch (e) {
    estado.error = e.message;
  } finally {
    estado.cargando = false;
  }
}

/**
 * Ejecuta una accion, recarga y deja el error a mano si falla. Si la sesion
 * se cerro (por ejemplo, desde otro dispositivo), vuelve a la portada.
 */
export async function accion(fn) {
  estado.error = null;
  try {
    const r = await fn();
    await recargar();
    return r;
  } catch (e) {
    if (e.datos?.sinSesion) await ponerPerfil(await api.sesion());
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

/**
 * Dice un texto en voz alta.
 *
 * Para quien lee con dificultad, oir "pagaste 18 soles con 50" es mas claro
 * que leerlo. Y en la caja, el bodeguero no tiene que mirar el celular para
 * saber que le pagaron: como las bocinas que avisan los pagos por QR.
 */
export function hablar(texto) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  const frase = new SpeechSynthesisUtterance(texto);
  frase.lang = 'es-PE';
  frase.rate = 0.95;
  const voz = window.speechSynthesis.getVoices().find((v) => v.lang?.startsWith('es'));
  if (voz) frase.voice = voz;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(frase);
  return true;
}

/** "18.50" -> "18 soles con 50 céntimos", para decirlo en voz alta. */
export function enPalabras(monto) {
  const c = Math.round(Number(monto) * 100);
  const soles = Math.floor(c / 100);
  const centimos = c % 100;
  return `${soles} ${soles === 1 ? 'sol' : 'soles'}${centimos ? ` con ${centimos} céntimos` : ''}`;
}

/** Acepta "18,50" y "18.50". Devuelve el texto listo para la API, o null. */
export function montoValido(texto) {
  const t = String(texto ?? '').trim().replace(',', '.');
  return /^\d{1,9}(\.\d{1,2})?$/.test(t) && Number(t) > 0 ? t : null;
}
