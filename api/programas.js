/**
 * /api/programas
 *
 *   GET                                               lista (todos los roles)
 *   POST { nombre, monto, venceEl, tipo, rubros }     crea uno (la empresa)
 *   POST { accion:'entregar', id }                    emite a los verificados
 *   POST { accion:'vencer', id }                      congela y anula
 */
import {
  anotar, cuerpo, exigir, exigirSesion, json, manejar, riel,
} from '../lib/http.js';
import { MAX_OPERACIONES } from '../lib/riel/index.js';
import { esTipo, rubrosDe } from '../lib/rubros.js';
import * as db from '../lib/db.js';

/** Parte una lista en trozos que quepan en una transaccion. */
const trozos = (lista, tamano) => Array.from(
  { length: Math.ceil(lista.length / tamano) },
  (_, i) => lista.slice(i * tamano, (i + 1) * tamano),
);

export default manejar({
  async GET(req, res) {
    const yo = await exigirSesion(req, res);
    if (!yo) return undefined;
    // El trabajador tambien lo necesita: ahi ve cuando vence su vale y en
    // que rubros lo puede usar.
    json(res, 200, { programas: await db.programasDe(yo.sesion) });
  },

  async POST(req, res) {
    const yo = await exigirSesion(req, res);
    if (!yo) return undefined;
    if (!exigir(yo, res, 'empresa')) return undefined;
    const datos = await cuerpo(req);
    const r = riel();

    // --- Entregar: el vale nace aqui, al salir de la cuenta emisora.
    if (datos.accion === 'entregar') {
      const programa = (await db.programasDe(yo.sesion)).find((p) => p.id === Number(datos.id));
      if (!programa) return json(res, 404, { error: 'Ese programa no existe.' });
      if (programa.estado !== 'vigente') return json(res, 409, { error: 'El programa ya venció.' });

      const verificados = await db.beneficiariosDe(yo.sesion, 'verificado');
      if (!verificados.length) {
        return json(res, 409, { error: 'Todavía no hay ningún trabajador verificado.' });
      }

      // Solo a quien aun no lo tiene. Se reserva ANTES de emitir: dos clics
      // seguidos no pueden emitir dos veces.
      const reservados = await db.reservarEntregas(programa.id, verificados.map((b) => b.id));
      if (!reservados.length) {
        return json(res, 409, { error: 'Todos los trabajadores verificados ya recibieron su vale.' });
      }
      const pendientes = verificados.filter((b) => reservados.includes(b.id));

      const transacciones = [];
      // Una operacion por beneficiario: caben 100 por transaccion.
      for (const grupo of trozos(pendientes, MAX_OPERACIONES)) {
        const ids = grupo.map((b) => b.id);
        const tx = await r.emitirVarios(
          grupo.map((b) => ({ cuenta: b.cuenta_publica, monto: programa.monto })),
        );
        transacciones.push(await anotar(yo.sesion, 'emitir', tx, r));
        if (!tx.ok) {
          // Los de este grupo siguen sin vale: se liberan para reintentar.
          await db.liberarEntregas(programa.id, ids);
          return json(res, 502, { error: tx.mensaje, transacciones });
        }
        await db.confirmarEntregas(programa.id, ids, tx.hash);
      }
      return json(res, 200, { entregados: pendientes.length, transacciones });
    }

    // --- Vencer: congelar y anular, en una sola transaccion por lote.
    if (datos.accion === 'vencer') {
      const programa = (await db.programasDe(yo.sesion)).find((p) => p.id === Number(datos.id));
      if (!programa) return json(res, 404, { error: 'Ese programa no existe.' });
      if (programa.estado !== 'vigente') return json(res, 409, { error: 'Ya estaba vencido.' });

      const verificados = await db.beneficiariosDe(yo.sesion, 'verificado');

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
          transacciones.push(await anotar(yo.sesion, 'vencer', tx, r));
          if (!tx.ok) return json(res, 502, { error: tx.mensaje, transacciones });
        }
      }

      const actualizado = await db.marcarProgramaVencido(programa.id);
      return json(res, 200, { programa: actualizado, transacciones });
    }

    // --- Crear. No toca la red: un programa es una regla del emisor.
    const nombre = String(datos.nombre ?? '').trim();
    if (!nombre) return json(res, 400, { error: 'Falta el nombre del programa.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(datos.venceEl ?? ''))) {
      return json(res, 400, { error: 'La fecha de vencimiento debe ser AAAA-MM-DD.' });
    }
    const tipo = datos.tipo ?? 'alimentaria';
    if (!esTipo(tipo)) return json(res, 400, { error: 'Ese tipo de programa no existe.' });

    // Todos los vales son el mismo activo: dos programas vigentes mezclarian
    // sus saldos en la misma cuenta y sus reglas dejarian de tener sentido.
    if (await db.programaVigente(yo.sesion)) {
      return json(res, 409, {
        error: 'Ya hay un programa vigente. Véncelo antes de crear otro.',
      });
    }

    const programa = await db.crearPrograma({
      sesion: yo.sesion,
      nombre,
      monto: String(datos.monto ?? '').trim().replace(',', '.'),
      tipo,
      // La prestacion alimentaria solo admite alimentos, lo pida quien lo pida.
      rubros: rubrosDe(tipo, datos.rubros),
      venceEl: datos.venceEl,
    });
    return json(res, 201, { programa });
  },
});
