/**
 * POST /api/demo
 *
 * "Probar la demostracion": crea en un clic una empresa de prueba con cinco
 * personas, cada una con su acceso, y devuelve sus datos para que el jurado
 * pueda entrar como cualquiera. Nada de credenciales escondidas en un archivo.
 *
 * Las cinco cuentas se crean en UNA transaccion de red. Nacen pendientes: el
 * jurado hace la verificacion, que es justo lo que tiene que ver.
 *
 *   - Maria, con smartphone.
 *   - Rosa, sin smartphone: paga con una tarjeta impresa y su PIN.
 *   - Bodega Don Julio, para afiliar.
 *   - Minimarket La Esquina, para NO afiliar y ver el rechazo de la red.
 *   - Electro Hogar, de electrodomesticos, para ver el control de rubros.
 *
 * Devuelve tambien una credencial por persona: la usa la vista de tres
 * pantallas, que abre varias sesiones a la vez en la misma pestana.
 */
import { credencialDe, iniciarSesion, json, manejar, riel } from '../lib/http.js';
import { altaEnLote } from '../lib/altas.js';
import {
  celularAlAzar, cifrar, contrasenaAlAzar, numeroDeTarjeta, pinAlAzar,
} from '../lib/credenciales.js';
import { nuevaSesion } from '../lib/cuentas.js';
import * as db from '../lib/db.js';

/** Tope contra el abuso: cada demostracion gasta XLM de prueba del emisor. */
const MAXIMO_POR_HORA = 30;
const EMPRESA = 'Textiles Andinos S.A.C. (demostración)';

/** Un celular al azar que nadie mas tenga. */
async function usuarioConCelular(sesion, rol, refId, pin) {
  const { hash, sal } = await cifrar(pin);
  for (let intento = 0; intento < 8; intento += 1) {
    const celular = celularAlAzar();
    try {
      const usuario = await db.crearUsuario({ sesion, rol, refId, identificador: celular, hash, sal });
      return { celular, usuario };
    } catch (e) {
      if (e?.code !== '23505') throw e;
    }
  }
  throw new Error('No se pudo generar un celular único para la demostración.');
}

export default manejar({
  async POST(req, res) {
    if (await db.demosRecientes() >= MAXIMO_POR_HORA) {
      return json(res, 429, {
        error: 'Se crearon muchas demostraciones en la última hora. Inténtalo en unos minutos.',
      });
    }

    const sesion = nuevaSesion();
    await db.crearSesion(sesion, { esDemo: true, nombre: EMPRESA });
    const r = riel();

    const alta = await altaEnLote(r, sesion, {
      beneficiarios: [{ nombre: 'María Quispe' }, { nombre: 'Rosa Huamán' }],
      comercios: [
        { nombre: 'Bodega Don Julio', rubro: 'alimentos', distrito: 'San Juan de Lurigancho' },
        { nombre: 'Minimarket La Esquina', rubro: 'alimentos', distrito: 'Comas' },
        { nombre: 'Electro Hogar', rubro: 'electro', distrito: 'Comas' },
      ],
    });
    if (!alta.ok) {
      return json(res, 502, { error: 'No se pudo preparar la demostración. Inténtalo otra vez.', transaccion: alta.evento });
    }

    // La empresa: correo + contrasena.
    const correo = `empresa-${nuevaSesion().slice(0, 6)}@demo.stellarrail.pe`;
    const contrasena = contrasenaAlAzar();
    const cifrada = await cifrar(contrasena);
    const empresa = await db.crearUsuario({
      sesion, rol: 'empresa', identificador: correo, hash: cifrada.hash, sal: cifrada.sal,
    });

    // Trabajadores y tiendas: celular + PIN.
    const [maria, rosa] = alta.beneficiarios;
    const [julio, esquina, electro] = alta.comercios;
    const plan = [
      { clave: 'maria', rol: 'beneficiario', fila: maria, nota: 'Tiene smartphone: paga escaneando el QR de la tienda.' },
      { clave: 'rosa', rol: 'beneficiario', fila: rosa, nota: 'No tiene smartphone: paga en la tienda con su tarjeta y su PIN.' },
      { clave: 'julio', rol: 'comercio', fila: julio, nota: 'Afíliala para que pueda cobrar.' },
      { clave: 'esquina', rol: 'comercio', fila: esquina, nota: 'No la afilies: así verás que la red rechaza el pago.' },
      { clave: 'electro', rol: 'comercio', fila: electro, nota: 'Vende electrodomésticos: el vale de alimentos no le sirve.' },
    ];
    const personas = [];
    for (const p of plan) {
      const pin = pinAlAzar();
      const { celular, usuario } = await usuarioConCelular(sesion, p.rol, p.fila.id, pin);
      personas.push({
        clave: p.clave,
        rol: p.rol,
        nombre: p.fila.nombre,
        celular,
        pin,
        nota: p.nota,
        credencial: credencialDe(usuario),
      });
    }

    // La tarjeta impresa de Rosa.
    let tarjeta;
    for (let intento = 0; intento < 5 && !tarjeta; intento += 1) {
      try { tarjeta = await db.emitirTarjeta(sesion, rosa.id, numeroDeTarjeta()); } catch (e) {
        if (e?.code !== '23505') throw e;
      }
    }
    personas.find((p) => p.clave === 'rosa').tarjeta = tarjeta.numero;

    // Este navegador entra como la empresa.
    iniciarSesion(req, res, empresa);

    return json(res, 201, {
      empresa: { nombre: EMPRESA, correo, contrasena, credencial: credencialDe(empresa) },
      personas,
      transaccion: alta.evento,
    });
  },
});
