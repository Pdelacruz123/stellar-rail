/**
 * POST /api/pagos
 *
 * Como un vale de alimentos real, la tienda cobra de dos formas y el
 * trabajador nunca escribe un monto:
 *
 * 1. CON QR. La tienda escribe el monto y muestra un QR. El trabajador lo
 *    escanea en su celular, ve a quien le paga y cuanto, y confirma.
 *      { accion:'ver', cobro }   ver el cobro: tienda, monto, si se puede
 *      { cobro, pin? }           pagarlo. Por encima de S/ 50 pide su PIN
 *
 * 2. CON EL CODIGO DEL TRABAJADOR, como el codigo de aprobacion de Yape. El
 *    trabajador genera con su PIN un codigo de 6 numeros que vale unos
 *    minutos y sirve para un solo pago, y se lo dicta a la tienda.
 *      { accion:'miCodigo', pin }        el trabajador genera su codigo
 *      { accion:'estadoCodigo', codigo } su celular ve si ya le cobraron
 *      { codigo, monto }                 la tienda cobra con ese codigo
 *
 * DOS CONTROLES DISTINTOS, y la respuesta dice cual actuo (`controlDe`):
 *
 * 1. Si la tienda esta afiliada lo decide LA RED. Este endpoint no lo
 *    comprueba, a proposito: manda el pago y traduce lo que responda. Si no
 *    esta autorizada vuelve `op_not_authorized`, con su hash comprobable.
 *
 * 2. Si el rubro de la tienda esta cubierto lo decide LA APLICACION. La red
 *    no ve que se compra, asi que esta regla no puede hacerla cumplir la red
 *    sin un contrato Soroban. No se envia ninguna transaccion y no hay hash.
 *    Se dice asi, sin vestirlo de lo que no es.
 *
 * En ambos casos un pago no hecho responde 200: no es un fallo del sistema,
 * es el resultado.
 */
import { randomInt } from 'node:crypto';
import {
  anotar, cuerpo, exigir, exigirSesion, json, manejar, riel,
} from '../lib/http.js';
import { comprobarSecreto } from '../lib/acceso.js';
import { derivarCuenta } from '../lib/cuentas.js';
import { leerCobro } from '../lib/cobros.js';
import { UMBRAL_PIN, VIGENCIA_CODIGO_MIN } from '../lib/reglas.js';
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

/** Puede pagar: aprobado, o dado de baja con saldo que todavia es suyo. */
const puedePagar = (b) => b && (b.estado === 'verificado' || (b.estado === 'baja' && b.hash_verificacion));

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
// 1. Con QR: el trabajador escanea el cobro de la tienda
// ---------------------------------------------------------------------------

async function pagoConQr(yo, datos, res) {
  const quien = await db.beneficiario(yo.sesion, yo.id);
  if (!quien) return json(res, 404, { error: 'No encontramos tu registro.' });
  if (!datos.cobro) return json(res, 400, { error: 'Escanea el QR que te muestra la tienda.' });

  const token = String(datos.cobro);
  const cobro = leerCobro(yo.sesion, token);
  if (cobro.error) return json(res, 404, { error: cobro.error });
  const destino = await db.comercio(yo.sesion, cobro.comercioId);
  if (!destino) return json(res, 404, { error: 'Este cobro es de una tienda que no existe.' });

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

  if (!puedePagar(quien)) return json(res, 409, { error: 'Todavía no puedes pagar con tu vale.' });

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
// 2. Con el codigo del trabajador
// ---------------------------------------------------------------------------

const leerCodigo = (valor) => String(valor ?? '').replace(/\D/g, '');

/** El trabajador genera su codigo con su PIN: es lo que autoriza el pago. */
async function generarCodigo(yo, datos, res) {
  const quien = await db.beneficiario(yo.sesion, yo.id);
  if (!puedePagar(quien)) return json(res, 409, { error: 'Todavía no puedes pagar con tu vale.' });
  if (!datos.pin) return json(res, 403, { requierePin: true, error: 'Escribe tu PIN para ver tu código.' });
  const c = await comprobarSecreto(await db.usuarioPorId(yo.usuarioId), datos.pin);
  if (!c.ok) return json(res, c.estado, { requierePin: true, error: c.error });

  for (let intento = 0; intento < 12; intento += 1) {
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const fila = await db.crearCodigoPago(yo.sesion, quien.id, codigo, VIGENCIA_CODIGO_MIN);
    if (fila) return json(res, 201, { codigo, vigencia: VIGENCIA_CODIGO_MIN * 60 });
  }
  throw new Error('No se pudo generar tu código.');
}

/** El celular del trabajador pregunta si ya le cobraron con su codigo. */
async function estadoCodigo(yo, datos, res) {
  const fila = await db.codigoPagoDe(yo.sesion, yo.id, leerCodigo(datos.codigo));
  if (!fila) return json(res, 404, { error: 'Ese código no es tuyo.' });
  return json(res, 200, {
    usado: Boolean(fila.usado_en),
    vencido: Boolean(fila.vencido) && !fila.usado_en,
    ultimo: fila.ultimo,
  });
}

/** La tienda escribe el monto y el codigo que le dicta el trabajador. */
async function cobroConCodigo(yo, datos, res) {
  const tienda = await db.comercio(yo.sesion, yo.id);
  if (!tienda) return json(res, 404, { error: 'Tu tienda no existe.' });

  const codigo = leerCodigo(datos.codigo);
  if (!/^\d{6}$/.test(codigo)) return json(res, 400, { error: 'El código del cliente tiene 6 números.' });
  const monto = montoDe(datos.monto);

  const fila = await db.codigoPagoVigente(yo.sesion, codigo);
  if (!fila) {
    return json(res, 404, {
      error: 'Ese código no existe, ya se usó o venció. Pide al cliente que genere uno nuevo.',
    });
  }
  const quien = await db.beneficiario(yo.sesion, fila.beneficiario_id);
  if (!puedePagar(quien)) return json(res, 404, { error: 'Ese código no sirve.' });

  // El rubro es el de la tienda, fijado al afiliarla.
  const rubro = tienda.rubro;
  const comercio = { id: tienda.id, nombre: tienda.nombre };

  // --- Control 2: el rubro. Lo aplica la aplicacion, no la red.
  const rechazo = await rechazoPorRubro(yo.sesion, rubro, monto, comercio);
  if (rechazo) {
    await db.anotarIntentoCodigo(yo.sesion, codigo, { ...rechazo, fecha: new Date().toISOString() });
    return json(res, 200, { ...rechazo, pagador: quien.nombre });
  }

  // Un codigo paga una sola vez. Se reserva antes de enviar.
  if (!await db.reclamarCodigoPago(yo.sesion, codigo)) {
    return json(res, 409, { error: 'Ese código ya se usó. Pide al cliente que genere uno nuevo.' });
  }

  // --- Control 1: la afiliacion. Lo aplica la red.
  const { tx, evento } = await enviarPago(yo.sesion, quien, tienda, monto, rubro);
  const respuesta = {
    pagado: tx.ok,
    controlDe: 'red',
    rubro,
    monto,
    comercio,
    pagador: quien.nombre,
    transaccion: evento,
  };
  // El celular del trabajador lo ve. Si la red lo rechazo, no se movio
  // dinero y el codigo se libera: sigue sirviendo hasta vencer.
  await db.anotarIntentoCodigo(yo.sesion, codigo, {
    pagado: tx.ok,
    controlDe: 'red',
    monto,
    comercio,
    mensaje: tx.ok ? null : evento?.mensaje ?? tx.mensaje,
    hash: tx.hash,
    fecha: new Date().toISOString(),
  });
  return json(res, 200, respuesta);
}

export default manejar({
  async POST(req, res) {
    const yo = await exigirSesion(req, res);
    if (!yo) return undefined;
    if (!exigir(yo, res, 'beneficiario', 'comercio')) return undefined;
    const datos = await cuerpo(req);

    if (yo.rol === 'comercio') {
      if (!datos.codigo) return json(res, 400, { error: 'Escribe el código que te dicta el cliente.' });
      return cobroConCodigo(yo, datos, res);
    }
    if (datos.accion === 'miCodigo') return generarCodigo(yo, datos, res);
    if (datos.accion === 'estadoCodigo') return estadoCodigo(yo, datos, res);
    return pagoConQr(yo, datos, res);
  },
});
