/**
 * POST /api/pagos  { codigo | comercioId, monto }
 *
 * El trabajador paga a un comercio: escaneando su QR con la camara del
 * celular, o tecleando el codigo de 6 digitos que la bodega muestra en caja.
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

    const destino = datos.codigo
      ? await db.comercioPorCodigo(yo.sesion, String(datos.codigo).trim())
      : await db.comercio(yo.sesion, datos.comercioId);
    if (!destino) {
      return json(res, 404, { error: 'No encontramos ese comercio. Revisa el código.' });
    }
    const comercio = { id: destino.id, nombre: destino.nombre };
    const rubro = destino.rubro ?? 'alimentos';

    // --- Control 2: el rubro. Lo aplica la aplicacion, no la red.
    const programa = await db.programaVigente(yo.sesion);
    if (programa && !programa.rubros.includes(rubro)) {
      return json(res, 200, {
        pagado: false,
        controlDe: 'aplicacion',
        rubro,
        comercio,
        mensaje: `Tu vale no cubre ${RUBROS[rubro].toLowerCase()}.`,
        transaccion: null,
      });
    }

    // --- Control 1: la afiliacion. Lo aplica la red.
    const r = riel();
    const cuenta = derivarCuenta({ sesion: yo.sesion, rol: 'beneficiario', id: quien.id });
    // En Peru se escribe 18,50; la red espera 18.50.
    const monto = String(datos.monto ?? '').trim().replace(',', '.');
    const tx = await r.pagar(cuenta, destino.cuenta_publica, monto, { rubro });
    const evento = await anotar(yo.sesion, 'pagar', tx, r);

    return json(res, 200, {
      pagado: tx.ok,
      controlDe: 'red',
      rubro,
      comercio,
      transaccion: evento,
    });
  },
});
