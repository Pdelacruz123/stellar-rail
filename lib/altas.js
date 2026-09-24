/**
 * Dar de alta trabajadores y tiendas: su cuenta en la red y su fila en la base.
 *
 * Todas las cuentas de una alta se crean en UNA transaccion, con las reservas
 * a cargo del emisor: caben 25 por transaccion. Un registro crea una sola; la
 * demostracion crea cinco de golpe, en un solo ledger.
 *
 * Las cuentas nacen con su trustline SIN autorizar: estan pendientes. La
 * empresa las verifica, y aprobarlas es la autorizacion en la red.
 */

import { codigoCorto, derivarCuenta } from './cuentas.js';
import * as db from './db.js';
import { anotar } from './http.js';
import { crearAccesoConPin } from './acceso.js';
import { normalizarCelular, pinValido } from './credenciales.js';

/**
 * @param {ReturnType<import('./http.js').riel>} r
 * @param {string} sesion
 * @param {{ beneficiarios?: {nombre:string}[], comercios?: {nombre:string, rubro?:string, distrito?:string}[] }} altas
 * @returns {Promise<{ok:boolean, evento:object, beneficiarios?:object[], comercios?:object[]}>}
 */
export async function altaEnLote(r, sesion, { beneficiarios = [], comercios = [] }) {
  // El id se reserva antes de insertar: la cuenta se deriva de el.
  const planB = [];
  for (const b of beneficiarios) {
    const id = await db.siguienteId('beneficiarios');
    planB.push({ ...b, id, cuenta: derivarCuenta({ sesion, rol: 'beneficiario', id }) });
  }
  const planC = [];
  for (const c of comercios) {
    const id = await db.siguienteId('comercios');
    planC.push({ ...c, id, cuenta: derivarCuenta({ sesion, rol: 'comercio', id }) });
  }

  const tx = await r.crearCuentasPatrocinadas([...planB, ...planC].map((x) => x.cuenta));
  const evento = await anotar(sesion, 'alta', tx, r);
  if (!tx.ok) return { ok: false, evento };

  const filasB = [];
  for (const b of planB) {
    filasB.push(await db.crearBeneficiario({
      id: b.id, sesion, nombre: b.nombre, cuentaPublica: b.cuenta.publicKey(),
    }));
  }
  const filasC = [];
  for (const c of planC) {
    filasC.push(await db.crearComercio({
      id: c.id,
      sesion,
      nombre: c.nombre,
      distrito: c.distrito || null,
      telefono: null,
      rubro: c.rubro ?? 'alimentos',
      cuentaPublica: c.cuenta.publicKey(),
      codigoCorto: codigoCorto({ sesion, id: c.id }),
    }));
  }
  return { ok: true, evento, beneficiarios: filasB, comercios: filasC };
}

/**
 * Alta de UNA persona con su acceso (celular + PIN): el registro con una
 * invitacion, o la empresa dando de alta a alguien en Recursos Humanos.
 *
 * Todo lo que puede fallar por los datos se comprueba ANTES de crear la
 * cuenta en la red: un celular repetido no debe gastar reservas del emisor.
 *
 * @param {'beneficiario'|'comercio'} rol
 * @returns {Promise<{ok:boolean, evento:object, fila?:object, usuario?:object}>}
 */
export async function altaConAcceso(r, sesion, rol, { nombre, celular, pin, rubro, distrito }) {
  const limpio = String(nombre ?? '').trim();
  if (!limpio) throw new TypeError(rol === 'comercio' ? 'Escribe el nombre del negocio.' : 'Escribe tu nombre.');
  const cel = normalizarCelular(celular);
  if (!cel) throw new TypeError('Escribe un celular de 9 números que empiece con 9.');
  if (!pinValido(pin)) throw new TypeError('El PIN son 4 números. No uses 1234 ni el mismo número repetido.');
  if (await db.usuarioPorIdentificador(cel)) throw new TypeError('Ese celular ya está registrado.');

  const alta = await altaEnLote(r, sesion, rol === 'comercio'
    ? { comercios: [{ nombre: limpio, rubro, distrito: String(distrito ?? '').trim() }] }
    : { beneficiarios: [{ nombre: limpio }] });
  if (!alta.ok) return { ok: false, evento: alta.evento };

  const fila = rol === 'comercio' ? alta.comercios[0] : alta.beneficiarios[0];
  const usuario = await crearAccesoConPin({ sesion, rol, refId: fila.id, celular: cel, pin });
  return { ok: true, evento: alta.evento, fila, usuario };
}
