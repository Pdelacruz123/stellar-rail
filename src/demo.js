/**
 * Los datos de la ultima demostracion creada en este navegador: celulares,
 * PIN y credenciales de cada persona. Son cuentas de prueba, en la red de
 * pruebas, y se muestran en pantalla a proposito: no hay credenciales
 * escondidas en ningun archivo.
 *
 * Se guardan solo para no perderlos al recargar la pagina. Si el navegador
 * no deja guardar, la demostracion funciona igual mientras no se recargue.
 */
import { api } from './api.js';

const CLAVE = 'stellarrail-demo';
let enMemoria = null;

export function leerDemo() {
  if (enMemoria) return enMemoria;
  try {
    enMemoria = JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
  } catch {
    enMemoria = null;
  }
  return enMemoria;
}

export async function crearDemo() {
  const demo = await api.crearDemo();
  enMemoria = { ...demo, creadaEn: Date.now() };
  try { localStorage.setItem(CLAVE, JSON.stringify(enMemoria)); } catch { /* sin almacenamiento */ }
  return enMemoria;
}

export const persona = (demo, clave) => demo?.personas?.find((p) => p.clave === clave) ?? null;
