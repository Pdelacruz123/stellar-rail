/**
 * POST /api/pagos
 *
 * Como un vale de alimentos real: la tienda escribe el monto y genera un
 * cobro (QR con su codigo de respaldo de 6 numeros), o cobra con la tarjeta
 * de quien no tiene smartphone.
 *
 * Desde el celular de la trabajadora:
 *   { accion:'ver', cobro | codigo }   ver el cobro: tienda, monto, si se puede
 *   { cobro | codigo, pin? }           pagarlo. Por encima de S/ 50 pide su PIN
 *
 * Desde el equipo de la tienda, para quien no tiene smartphone:
 *   { tarjeta, pin, monto }            la tienda escanea la tarjeta impresa y
 *                                      el trabajador marca su PIN. Siempre con
 *                                      PIN y con un tope de S/ 100 al dia.
 *
 * DOS CONTROLES DISTINTOS, y la respuesta dice cual actuo (`controlDe`):
 *
 * 1. Si la tienda esta afiliada lo decide LA RED. Este endpoint no lo
 *    comprueba, a proposito: manda el pago y traduce lo que responda. Si no
 *    esta autorizada vuelve `op_not_authorized`, con su hash comprobable.
 *
 * 2. Si el rubro esta cubierto lo decide LA APLICACION. La red no ve que se
 *    compra, asi que esta regla no puede hacerla cumplir la red sin un
 *    contrato Soroban. No se envia ninguna transaccion y no hay hash. Se dice
 *    asi, sin vestirlo de lo que no es.
 *
 * En ambos casos un pago no hecho responde 200: no es un fallo del sistema,
 * es el resultado.
 */
import {
  anotar, cuerpo, exigir, exigirSesion, json, manejar, riel,
} from '../lib/http.js';
import { comprobarSecreto } from '../lib/acceso.js';
import { derivarCuenta } from '../lib/cuentas.js';
import { leerCobro } from '../lib/cobros.js';
import { TOPE_DIARIO_TARJETA, UMBRAL_PIN, normalizarTarjeta } from '../lib/credenciales.js';
import { normalizarMonto } from '../lib/riel/montos.js';
import { RUBROS } from '../lib/rubros.js';
import * as db from '../lib/db.js';

/** En Peru se escribe 18,50; la red espera 18.50. */
function montoDe(valor) {
  try {
    return normalizarMonto(String(valor ?? '').trim().replace(',', '.'));
  } catch {
    throw new TypeError('Escribe un monto válido, por ejemplo 18,50.');
  }
}

/** El rubro lo cubre el programa vigente? Lo decide la aplicacion. */
async function rechazoPorRubro(sesion, rubro, monto, comercio) {
  const programa = await db.programaVigente(sesion);
  if (!programa || programa.rubros.includes(rubro)) return null;
  return {
    pagado: false,
    controlDe: 'aplicacion',
    rubro,
    monto,
    comercio,
    mensaje: `Este vale no cubre ${RUBROS[rubro].toLowerCase()}.`,
    transaccion: null,
  };
}

/** Envia el pago del trabajador a la tienda. La red decide si procede. */
async function enviarPago(sesion, pagador, destino, monto, rubro) {
  const r = riel();
  const cuenta = derivarCuenta({ sesion, rol: 'beneficiario', id: pagador.id });
  const tx = await r.pagar(cuenta, destino.cuenta_publica, monto, { rubro });
  return { r, tx, evento: await anotar(sesion, 'pagar', tx, r) };
}

// ---------------------------------------------------------------------------

/**
 * El cobro que la trabajadora quiere pagar: del QR (su token firmado) o de
 * su codigo de respaldo de 6 numeros. El monto y la tienda vienen del cobro:
 * ella no escribe nada mas.
 */
async function resolverCobro(yo, datos) {
  let token = datos.cobro ? String(datos.cobro) : null;
  if (!token) {
    const codigo = String(datos.codigo ?? '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(codigo)) throw new TypeError('Escribe los 6 números que te muestra la tienda.');
    token = await db.tokenDeCodigo(yo.sesion, codigo);
    if (!token) {
      return { error: 'No encontramos ese cobro. Revisa los 6 números o pide a la tienda que genere otro.' };
    }
  }
  const cobro = leerCobro(yo.sesion, token);
  if (cobro.error) return { error: cobro.error };
  const destino = await db.comercio(yo.sesion, cobro.comercioId);
  if (!destino) return { error: 'Este cobro es de una tienda que no existe.' };
  return { token, cobro, destino };
}

async function pagoConCelular(yo, datos, res) {
  const quien = await db.beneficiario(yo.sesion, yo.id);
  if (!quien) return json(res, 404, { error: 'No encontramos tu registro.' });

  const r = await resolverCobro(yo, datos);
  if (r.error) return json(res, 404, { error: r.error });
  const { token, cobro, destino } = r;
  const { monto, rubro } = cobro;
  const comercio = { id: destino.id, nombre: destino.nombre, distrito: destino.distrito, rubro: destino.rubro };

  // --- Ver el cobro antes de confirmarlo: tienda, monto y si se puede pagar.
  if (datos.accion === 'ver') {
    const programa = await db.programaVigente(yo.sesion);
    return json(res, 200, {
      cobro: token,
      monto,
      rubro,
      comercio,
      yaPagado: await db.cobroYaUsado(cobro.firma),
      cubierto: !programa || programa.rubros.includes(rubro),
      requierePin: Number(monto) > UMBRAL_PIN,
    });
  }

  // --- Control 2: el rubro de la tienda. Lo aplica la aplicacion, no la red.
  const rechazo = await rechazoPorRubro(yo.sesion, rubro, monto, comercio);
  if (rechazo) return json(res, 200, rechazo);

  // --- Montos grandes: el PIN. Si alguien toma el celular desbloqueado, no
  // puede vaciar el vale de golpe.
  if (Number(monto) > UMBRAL_PIN) {
    if (!datos.pin) {
      return json(res, 403, {
        requierePin: true,
        error: `Para pagar más de S/ ${UMBRAL_PIN}, escribe tu PIN.`,
      });
    }
    const c = await comprobarSecreto(await db.usuarioPorId(yo.usuarioId), datos.pin);
    if (!c.ok) return json(res, c.estado, { requierePin: true, error: c.error });
  }

  // Un cobro se paga una sola vez. Se reserva antes de enviar.
  if (!await db.reclamarCobro(yo.sesion, cobro.firma)) {
    return json(res, 409, { error: 'Este cobro ya fue pagado.' });
  }

  // --- Control 1: la afiliacion. Lo aplica la red.
  const { tx, evento } = await enviarPago(yo.sesion, quien, destino, monto, rubro);

  // Si la red lo rechazo, no se movio dinero: el cobro se puede volver a usar.
  if (!tx.ok) await db.liberarCobro(cobro.firma);

  return json(res, 200, {
    pagado: tx.ok, controlDe: 'red', rubro, monto, comercio, transaccion: evento,
  });
}

// ---------------------------------------------------------------------------

async function pagoConTarjeta(yo, datos, res) {
  const tienda = await db.comercio(yo.sesion, yo.id);
  if (!tienda) return json(res, 404, { error: 'Tu tienda no existe.' });

  const numero = normalizarTarjeta(datos.tarjeta);
  const t = numero && await db.tarjeta(numero);
  // Una tarjeta de otra empresa se trata igual que una que no existe.
  if (!t || t.sesion_id !== yo.sesion) {
    return json(res, 404, { error: 'No reconocemos esa tarjeta. Revisa el número.' });
  }
  if (t.estado !== 'activa') {
    return json(res, 409, { error: 'Esta tarjeta fue anulada. La persona debe pedir una nueva a su empresa.' });
  }
  const quien = await db.beneficiario(yo.sesion, t.beneficiario_id);
  const usuario = await db.usuarioDe(yo.sesion, 'beneficiario', t.beneficiario_id);
  if (!quien || !usuario) return json(res, 404, { error: 'No reconocemos esa tarjeta.' });

  const monto = montoDe(datos.monto);
  // El rubro es el de la tienda, fijado al afiliarla.
  const rubro = tienda.rubro;

  // --- La tarjeta sola no paga: el trabajador marca su PIN. Se comprueba
  // primero, antes de revelar nada sobre su vale.
  const c = await comprobarSecreto(usuario, datos.pin);
  if (!c.ok) return json(res, c.estado, { requierePin: true, error: c.error });

  const comercio = { id: tienda.id, nombre: tienda.nombre };
  const rechazo = await rechazoPorRubro(yo.sesion, rubro, monto, comercio);
  if (rechazo) return json(res, 200, { ...rechazo, pagador: quien.nombre });

  // --- Tope diario: una tarjeta se puede perder. Se reserva antes de enviar.
  const reserva = await db.reservarPagoTarjeta(numero, quien.id, monto, TOPE_DIARIO_TARJETA);
  if (!reserva) {
    return json(res, 409, {
      error: `Con tarjeta se pueden pagar hasta S/ ${TOPE_DIARIO_TARJETA} por día. Hoy ya no alcanza para este monto.`,
    });
  }

  const { r, tx, evento } = await enviarPago(yo.sesion, quien, tienda, monto, rubro);
  if (!tx.ok) await db.liberarPagoTarjeta(reserva);

  // El saldo que le queda, para decirselo en voz alta en la tienda.
  let saldoRestante = null;
  if (tx.ok) {
    try { saldoRestante = (await r.consultarSaldo(quien.cuenta_publica)).saldo; } catch { /* no es imprescindible */ }
  }

  return json(res, 200, {
    pagado: tx.ok,
    controlDe: 'red',
    rubro,
    monto,
    comercio,
    pagador: quien.nombre,
    saldoRestante,
    transaccion: evento,
  });
}

export default manejar({
  async POST(req, res) {
    const yo = await exigirSesion(req, res);
    if (!yo) return undefined;
    if (!exigir(yo, res, 'beneficiario', 'comercio')) return undefined;
    const datos = await cuerpo(req);

    if (yo.rol === 'comercio') {
      if (!datos.tarjeta) return json(res, 400, { error: 'Escanea o escribe el número de la tarjeta.' });
      return pagoConTarjeta(yo, datos, res);
    }
    return pagoConCelular(yo, datos, res);
  },
});
