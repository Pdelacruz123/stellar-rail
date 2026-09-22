/**
 * /api/programas
 *
 *   GET                                lista los programas de la sesion
 *   POST { nombre, monto, venceEl }    crea uno (solo el emisor)
 *   POST { accion:'entregar', id }     emite a los beneficiarios verificados
 *   POST { accion:'vencer', id }       congela y anula
 */
import { anotar, cuerpo, exigirAdmin, json, manejar, riel, sesionDe } from '../lib/http.js';
import { MAX_OPERACIONES } from '../lib/riel/index.js';
import * as db from '../lib/db.js';

/** Parte una lista en trozos que quepan en una transaccion. */
const trozos = (lista, tamano) => Array.from(
  { length: Math.ceil(lista.length / tamano) },
  (_, i) => lista.slice(i * tamano, (i + 1) * tamano),
);

export default manejar({
  async GET(req, res) {
    const sesion = await sesionDe(req, res);
    json(res, 200, { programas: await db.programasDe(sesion) });
  },

  async POST(req, res) {
    const sesion = await sesionDe(req, res);
    if (!exigirAdmin(req, res)) return undefined;
    const datos = await cuerpo(req);
    const r = riel();

    // --- Entregar: el vale nace aqui, al salir de la cuenta emisora.
    if (datos.accion === 'entregar') {
      const programa = (await db.programasDe(sesion)).find((p) => p.id === Number(datos.id));
      if (!programa) return json(res, 404, { error: 'Ese programa no existe.' });
      if (programa.estado !== 'vigente') return json(res, 409, { error: 'El programa ya vencio.' });

      const verificados = await db.beneficiariosDe(sesion, 'verificado');
      if (!verificados.length) {
        return json(res, 409, { error: 'Todavia no hay ningun beneficiario verificado.' });
      }

      const transacciones = [];
      // Una operacion por beneficiario: caben 100 por transaccion.
      for (const grupo of trozos(verificados, MAX_OPERACIONES)) {
        const tx = await r.emitirVarios(
          grupo.map((b) => ({ cuenta: b.cuenta_publica, monto: programa.monto })),
        );
        transacciones.push(await anotar(sesion, 'emitir', tx, r));
        if (!tx.ok) return json(res, 502, { error: tx.mensaje, transacciones });
      }
      return json(res, 200, { entregados: verificados.length, transacciones });
    }

    // --- Vencer: congelar y anular, en una sola transaccion por lote.
    if (datos.accion === 'vencer') {
      const programa = (await db.programasDe(sesion)).find((p) => p.id === Number(datos.id));
      if (!programa) return json(res, 404, { error: 'Ese programa no existe.' });
      if (programa.estado !== 'vigente') return json(res, 409, { error: 'Ya estaba vencido.' });

      const verificados = await db.beneficiariosDe(sesion, 'verificado');

      // El saldo se lee de Horizon, nunca de la base: es la fuente de verdad.
      // Si alguno gasta entre la lectura y el envio, la transaccion falla
      // entera y no deja nada a medias; se reintenta con el saldo al dia.
      const entradas = [];
      for (const b of verificados) {
        const estado = await r.consultarSaldo(b.cuenta_publica);
        entradas.push({ cuenta: b.cuenta_publica, saldo: estado.saldo });
      }

      const transacciones = [];
      if (entradas.length) {
        // Dos operaciones por beneficiario: caben 50 por transaccion.
        for (const grupo of trozos(entradas, Math.floor(MAX_OPERACIONES / 2))) {
          const tx = await r.vencerVarios(grupo);
          transacciones.push(await anotar(sesion, 'vencer', tx, r));
          if (!tx.ok) return json(res, 502, { error: tx.mensaje, transacciones });
        }
      }

      const actualizado = await db.marcarProgramaVencido(programa.id);
      return json(res, 200, { programa: actualizado, transacciones });
    }

    // --- Crear. No toca la red: un programa es solo una regla del emisor.
    const nombre = String(datos.nombre ?? '').trim();
    if (!nombre) return json(res, 400, { error: 'Falta el nombre del programa.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(datos.venceEl ?? ''))) {
      return json(res, 400, { error: 'La fecha de vencimiento debe ser AAAA-MM-DD.' });
    }
    const programa = await db.crearPrograma({
      sesion,
      nombre,
      monto: datos.monto,
      categoria: datos.categoria,
      venceEl: datos.venceEl,
    });
    return json(res, 201, { programa });
  },
});
