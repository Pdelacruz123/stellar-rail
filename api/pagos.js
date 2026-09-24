/**
 * POST /api/pagos
 *
 *   { cobro }                 pagar un QR con monto: el cliente solo confirma
 *   { codigo | comercioId,    pagar el QR fijo de la tienda, o su codigo de 6
 *     monto }                 digitos, escribiendo el monto
 *
 * DOS CONTROLES DISTINTOS, y la respuesta dice cual actuo (`controlDe`):
 *
 * 1. Si el comercio esta afiliado lo decide LA RED. Este endpoint no lo
 *    comprueba, a proposito: manda el pago y traduce lo que responda. Si no
 *    esta autorizado vuelve `op_not_authorized`, con su hash comprobable.
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
  anotar, cuerpo, exigir, identidad, json, manejar, riel,
} from '../lib/http.js';
import { derivarCuenta } from '../lib/cuentas.js';
import { leerCobro } from '../lib/cobros.js';
import { RUBROS } from '../lib/rubros.js';
import * as db from '../lib/db.js';

export default manejar({
  async POST(req, res) {
    const yo = await identidad(req, res);
    if (!exigir(yo, res, 'beneficiario', 'empresa')) return undefined;
    const datos = await cuerpo(req);

    // Un trabajador solo paga con su propio vale. La empresa, en la
    // demostracion con un solo dispositivo, puede elegir por quien paga.
    if (yo.rol === 'beneficiario' && yo.id === null) {
      return json(res, 409, { error: 'Primero completa tu registro.' });
    }
    const pagadorId = yo.rol === 'beneficiario' ? yo.id : Number(datos.beneficiarioId);
    const quien = await db.beneficiario(yo.sesion, pagadorId);
    if (!quien) return json(res, 404, { error: 'Ese trabajador no existe.' });

    // --- A quien, cuanto y de que rubro.
    let destino;
    let monto;
    let rubro;
    let cobro = null;
    if (datos.cobro) {
      // QR con monto: todo viene firmado por la tienda. El cliente no puede
      // tocar ni el monto ni el rubro.
      cobro = leerCobro(yo.sesion, datos.cobro);
      if (cobro.error) return json(res, 400, { error: cobro.error });
      destino = await db.comercio(yo.sesion, cobro.comercioId);
      monto = cobro.monto;
      rubro = cobro.rubro;
    } else {
      destino = datos.codigo
        ? await db.comercioPorCodigo(yo.sesion, String(datos.codigo).replace(/\s/g, ''))
        : await db.comercio(yo.sesion, datos.comercioId);
      // En Peru se escribe 18,50; la red espera 18.50.
      monto = String(datos.monto ?? '').trim().replace(',', '.');
      rubro = destino?.rubro ?? 'alimentos';
    }
    if (!destino) {
      return json(res, 404, { error: 'No encontramos esa tienda. Revisa el código.' });
    }
    const comercio = { id: destino.id, nombre: destino.nombre };

    // --- Control 2: el rubro. Lo aplica la aplicacion, no la red.
    const programa = await db.programaVigente(yo.sesion);
    if (programa && !programa.rubros.includes(rubro)) {
      return json(res, 200, {
        pagado: false,
        controlDe: 'aplicacion',
        rubro,
        monto,
        comercio,
        mensaje: `Tu vale no cubre ${RUBROS[rubro].toLowerCase()}.`,
        transaccion: null,
      });
    }

    // Un QR con monto se paga una sola vez. Se reserva antes de enviar.
    if (cobro && !await db.reclamarCobro(yo.sesion, cobro.firma)) {
      return json(res, 409, { error: 'Este cobro ya fue pagado.' });
    }

    // --- Control 1: la afiliacion. Lo aplica la red.
    const r = riel();
    const cuenta = derivarCuenta({ sesion: yo.sesion, rol: 'beneficiario', id: quien.id });
    const tx = await r.pagar(cuenta, destino.cuenta_publica, monto, { rubro });
    const evento = await anotar(yo.sesion, 'pagar', tx, r);

    // Si la red lo rechazo, no se movio dinero: el cobro se puede volver a usar.
    if (cobro && !tx.ok) await db.liberarCobro(cobro.firma);

    return json(res, 200, {
      pagado: tx.ok,
      controlDe: 'red',
      rubro,
      monto,
      comercio,
      transaccion: evento,
    });
  },
});
