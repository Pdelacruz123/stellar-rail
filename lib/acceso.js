/**
 * Comprobar un PIN o una contrasena, y crear accesos.
 *
 * Lo usan el login y los pagos que piden PIN. El contador de intentos es el
 * mismo para todo: equivocarse al entrar y equivocarse al pagar suman igual,
 * asi que nadie puede probar PIN por un camino cuando el otro ya lo bloqueo.
 */

import * as db from './db.js';
import {
  BLOQUEO_MINUTOS, INTENTOS_MAXIMOS, cifrar, contrasenaValida, normalizarCelular,
  normalizarCorreo, pinValido, verificar,
} from './credenciales.js';

const bloqueado = (u) => u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date();

// Acotado al bloqueo: el reloj de la base y el del servidor no coinciden al
// segundo, y sin tope diria "espera 16 minutos" justo despues de bloquear.
function minutosRestantes(u) {
  const m = Math.ceil((new Date(u.bloqueado_hasta) - Date.now()) / 60000);
  return Math.min(BLOQUEO_MINUTOS, Math.max(1, m));
}

/**
 * @returns {Promise<{ok: true} | {ok: false, estado: number, error: string}>}
 */
export async function comprobarSecreto(usuario, secreto) {
  if (bloqueado(usuario)) {
    return {
      ok: false,
      estado: 423,
      error: `Por seguridad, espera ${minutosRestantes(usuario)} minutos antes de volver a intentarlo.`,
    };
  }
  if (await verificar(secreto, usuario.hash, usuario.sal)) {
    if (usuario.intentos) await db.limpiarIntentos(usuario.id);
    return { ok: true };
  }
  const tras = await db.intentoFallido(usuario.id, INTENTOS_MAXIMOS, BLOQUEO_MINUTOS);
  if (bloqueado(tras)) {
    return {
      ok: false,
      estado: 423,
      error: `Te equivocaste ${INTENTOS_MAXIMOS} veces. Por seguridad, espera ${BLOQUEO_MINUTOS} minutos.`,
    };
  }
  const quedan = INTENTOS_MAXIMOS - tras.intentos;
  return {
    ok: false,
    estado: 401,
    error: `No coincide. Te ${quedan === 1 ? 'queda 1 intento' : `quedan ${quedan} intentos`}.`,
  };
}

/**
 * Crea el acceso de un trabajador o una tienda: celular + PIN.
 * Lanza TypeError con un mensaje legible si algo no es valido.
 */
export async function crearAccesoConPin({ sesion, rol, refId, celular, pin }) {
  const c = normalizarCelular(celular);
  if (!c) throw new TypeError('Escribe un celular de 9 números que empiece con 9.');
  if (!pinValido(pin)) {
    throw new TypeError('El PIN son 4 números. No uses 1234 ni el mismo número repetido.');
  }
  const { hash, sal } = await cifrar(pin);
  return db.crearUsuario({ sesion, rol, refId, identificador: c, hash, sal });
}

/** Crea el acceso de una empresa: correo + contrasena. */
export async function crearAccesoConContrasena({ sesion, correo, contrasena }) {
  const c = normalizarCorreo(correo);
  if (!c) throw new TypeError('Escribe un correo válido.');
  if (!contrasenaValida(contrasena)) throw new TypeError('La contraseña debe tener al menos 8 caracteres.');
  const { hash, sal } = await cifrar(contrasena);
  return db.crearUsuario({ sesion, rol: 'empresa', refId: null, identificador: c, hash, sal });
}

/** El usuario que corresponde a lo que escribio la persona: celular o correo. */
export async function buscarUsuario(identificador) {
  const texto = String(identificador ?? '');
  const clave = texto.includes('@') ? normalizarCorreo(texto) : normalizarCelular(texto);
  return clave ? db.usuarioPorIdentificador(clave) : null;
}
