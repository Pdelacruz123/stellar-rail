#!/usr/bin/env node
/**
 * Reproduce el ciclo completo del vale en Stellar Testnet, de principio a fin,
 * con cuentas nuevas en cada corrida.
 *
 *     npm run ciclo
 *
 * No necesita configuracion ni archivo .env: crea su propio emisor con
 * Friendbot. Cualquiera puede ejecutarlo y comprobar por su cuenta lo que
 * dice EVIDENCIAS.md, sin pedirnos nada.
 *
 * Imprime, por cada paso, la operacion, el hash y el ledger, o el codigo de
 * error de la red cuando el rechazo es el resultado esperado. Al final
 * comprueba el estado contra Horizon y devuelve un codigo de salida distinto
 * de cero si algo no cuadra, para que sirva como prueba y no solo como demo.
 */

import { crearRiel, Keypair } from '../lib/riel/index.js';

// Los mismos importes de EVIDENCIAS.md, para que las corridas sean comparables.
const ENTREGA = '10';
const COMPRA = '3';
const INTENTO = '1';

const N = { reset: '\x1b[0m', gris: '\x1b[90m', verde: '\x1b[32m', rojo: '\x1b[31m', neg: '\x1b[1m' };
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (t, code) => (color ? code + t + N.reset : t);

const pasos = [];
let fallos = 0;

function titulo(n, texto) {
  console.log(`\n${c(`── ${n} ${'─'.repeat(Math.max(0, 68 - String(n).length - texto.length))}`, N.gris)}`);
  console.log(`   ${c(texto, N.neg)}`);
}

function nota(texto) {
  console.log(`   ${c(texto, N.gris)}`);
}

/**
 * Busca en que ledger quedo una transaccion rechazada.
 *
 * Un rechazo a nivel de operacion SI se registra y cobra comision, asi que
 * tiene ledger y es tan comprobable como un exito. Horizon no lo devuelve
 * en la respuesta de error, por eso se consulta aparte: sin esto la tabla
 * de evidencias dejaria en blanco justo las dos filas que mas importan.
 */
async function ledgerDe(hash) {
  for (let intento = 0; intento < 5; intento += 1) {
    await new Promise((s) => setTimeout(s, 2000));
    try {
      const tx = await riel.servidor.transactions().transaction(hash).call();
      return tx.ledger_attr ?? tx.ledger ?? null;
    } catch (e) {
      if (e?.response?.status !== 404) return null;
    }
  }
  return null;
}

/**
 * Ejecuta un paso y lo muestra. `esperado` dice que codigo de rechazo es
 * el correcto: en dos pasos el exito seria el fallo.
 */
async function paso(etiqueta, promesa, { esperado = null } = {}) {
  const r = await promesa;

  if (esperado) {
    if (r.ok) {
      console.log(`   ${c('✗', N.rojo)} ${etiqueta}`);
      console.log(`     ${c(`Se esperaba que la red lo rechazara con ${esperado} y lo acepto.`, N.rojo)}`);
      fallos += 1;
    } else if (r.codigo !== esperado) {
      console.log(`   ${c('✗', N.rojo)} ${etiqueta}`);
      console.log(`     ${c(`Se esperaba ${esperado} y la red devolvio ${r.codigo}.`, N.rojo)}`);
      fallos += 1;
    } else {
      const ledger = r.enElLedger ? await ledgerDe(r.hash) : null;
      console.log(`   ${c('✓', N.verde)} ${etiqueta}`);
      console.log(`     ${c('RECHAZADO POR LA RED', N.rojo)}  ${c(r.codigo, N.neg)}`);
      console.log(`     ${r.significado}`);
      console.log(`     Al usuario: "${r.mensaje}"`);
      console.log(`     hash ${r.hash}`);
      if (ledger) console.log(`     ledger ${ledger}`);
      console.log(`     ${c(r.enElLedger ? 'Quedo en el ledger y cobro comision: el rechazo se comprueba igual que un exito.' : 'No llego al ledger.', N.gris)}`);
      pasos.push({ etiqueta, ok: false, codigo: r.codigo, hash: r.hash, ledger });
      return r;
    }
    pasos.push({ etiqueta, ok: false, codigo: r.codigo, hash: r.hash });
    return r;
  }

  if (!r.ok) {
    console.log(`   ${c('✗', N.rojo)} ${etiqueta}`);
    console.log(`     ${c(`${r.codigo}: ${r.significado}`, N.rojo)}`);
    console.log(`     hash ${r.hash}`);
    fallos += 1;
    pasos.push({ etiqueta, ok: false, codigo: r.codigo, hash: r.hash });
    return r;
  }

  console.log(`   ${c('✓', N.verde)} ${etiqueta}`);
  console.log(`     hash ${r.hash}`);
  console.log(`     ledger ${r.ledger}`);
  pasos.push({ etiqueta, ok: true, hash: r.hash, ledger: r.ledger });
  return r;
}

/** Comprueba una afirmacion sobre el estado final leido de Horizon. */
function comprobar(descripcion, real, esperado) {
  const bien = String(real) === String(esperado);
  if (!bien) fallos += 1;
  console.log(`   ${bien ? c('✓', N.verde) : c('✗', N.rojo)} ${descripcion}: ${c(String(real), N.neg)}`
    + (bien ? '' : c(`  (se esperaba ${esperado})`, N.rojo)));
}

// ---------------------------------------------------------------------------

console.log(c('\n═══ Ciclo completo del vale en Stellar Testnet ═══', N.neg));
nota('Cuentas nuevas en cada corrida. Nada se reutiliza.');

titulo(0, 'Preparacion: cuatro cuentas nuevas');

const emisorKp = Keypair.random();
nota('Fondeando el emisor con Friendbot...');
const fondeo = await fetch(`https://friendbot.stellar.org?addr=${emisorKp.publicKey()}`);
if (!fondeo.ok) {
  console.error(c(`\nFriendbot no respondio (HTTP ${fondeo.status}). Reintenta en un momento.`, N.rojo));
  process.exit(1);
}

// El emisor sale de aqui y de ningun otro lado: es la trampa que ya nos costo
// un error. Nunca se toma de la cuenta de origen de una operacion.
const riel = crearRiel({ emisorSecret: emisorKp.secret() });

const trabajador = Keypair.random();
const bodegaA = Keypair.random();
const bodegaB = Keypair.random();

console.log(`   EMISOR      ${riel.emisor}`);
console.log(`   TRABAJADOR  ${trabajador.publicKey()}`);
console.log(`   BODEGA_A    ${bodegaA.publicKey()}  ${c('(se va a afiliar)', N.gris)}`);
console.log(`   BODEGA_B    ${bodegaB.publicKey()}  ${c('(NO se afilia, a proposito)', N.gris)}`);

titulo(1, 'El emisor activa sus reglas de control');
nota('Set Options con AUTH_REQUIRED (1) + AUTH_REVOCABLE (2) + AUTH_CLAWBACK_ENABLED (8) = 11.');
nota('Va PRIMERO: el clawback solo alcanza a las trustlines creadas despues.');
await paso('configurarEmisor', riel.configurarEmisor());

titulo(2, 'Las tres cuentas piden poder tener el vale');
nota('Cada alta crea la cuenta y su trustline en una sola transaccion, con el');
nota('emisor pagando las reservas. El trabajador entra con 0 XLM propios.');
nota('Las trustlines nacen SIN autorizar: tener el vale exige dos voluntades.');
await paso('alta patrocinada de TRABAJADOR', riel.crearCuentaPatrocinada(trabajador));
await paso('alta patrocinada de BODEGA_A', riel.crearCuentaPatrocinada(bodegaA));
await paso('alta patrocinada de BODEGA_B', riel.crearCuentaPatrocinada(bodegaB));

const reservas = await riel.consultarReservas(trabajador);
nota(`TRABAJADOR: ${reservas.xlm} XLM, saldo minimo exigido ${reservas.minimo}, `
  + `gastable ${reservas.gastable}. Las reservas las paga el emisor.`);

titulo(3, 'El emisor verifica y afilia');
nota('Esta transaccion ES la verificacion. Aprobar no es un campo en una tabla:');
nota('es una operacion publica que cualquiera comprueba con el hash.');
nota('BODEGA_B se queda fuera a proposito.');
await paso('autorizar a TRABAJADOR y BODEGA_A', riel.autorizarVarias([trabajador, bodegaA]));

titulo(4, `Nace el vale: el emisor entrega ${ENTREGA} ALIM`);
nota('Como el pago sale de la cuenta emisora, el activo se crea en este momento.');
await paso(`emitir ${ENTREGA} ALIM al TRABAJADOR`, riel.emitir(trabajador, ENTREGA));

titulo(5, `Pago ACEPTADO en la bodega afiliada (${COMPRA} ALIM)`);
await paso(`TRABAJADOR paga ${COMPRA} ALIM a BODEGA_A`, riel.pagar(trabajador, bodegaA, COMPRA));

titulo(6, 'Pago RECHAZADO en el comercio no afiliado');
nota('Mismo pagador, mismo saldo, misma firma. La unica diferencia es que el');
nota('emisor nunca autorizo a BODEGA_B. No lo rechaza nuestro codigo: lo');
nota('rechaza el protocolo. Esta es la demostracion central del proyecto.');
await paso(`TRABAJADOR intenta pagar ${INTENTO} ALIM a BODEGA_B`,
  riel.pagar(trabajador, bodegaB, INTENTO), { esperado: 'op_not_authorized' });

titulo(7, 'Vencimiento, primer paso: el emisor congela');
nota('La cuenta conserva el saldo pero ya no puede moverlo.');
nota('El flag de clawback no se toca: si se quitara, el saldo no se podria anular.');
await paso('congelar al TRABAJADOR', riel.congelar(trabajador));

const congelado = await riel.consultarSaldo(trabajador);
nota(`Estado: saldo ${congelado.saldo} ALIM, congelado=${congelado.congelado}, `
  + `clawback sigue activo=${congelado.clawbackActivo}`);

titulo('7b', 'Un vale congelado no se puede gastar');
nota('El mismo pago del paso 5, al mismo comercio afiliado. Ahora falla porque');
nota('la cuenta de origen esta congelada.');
await paso(`TRABAJADOR intenta pagar ${INTENTO} ALIM a BODEGA_A`,
  riel.pagar(trabajador, bodegaA, INTENTO), { esperado: 'op_src_not_authorized' });

titulo(8, 'Vencimiento, segundo paso: anular el saldo');
nota('El clawback DESTRUYE el vale; no lo devuelve al emisor. Lo que la empresa');
nota('recupera es su respaldo en soles, que deja de estar comprometido.');
nota('');
nota('Aqui congelar y anular van en transacciones separadas A PROPOSITO: entre');
nota('las dos va el paso 7b, que demuestra que un vale congelado no se puede');
nota('gastar. En la aplicacion se usa riel.vencer(), que las junta en una sola');
nota('transaccion atomica y evita una carrera. No "optimices" este script.');
if (riel.hayQueAnular(congelado.saldo)) {
  await paso(`anular ${congelado.saldo} ALIM no gastados`, riel.anular(trabajador, congelado.saldo));
} else {
  nota('No queda saldo que anular: un clawback de cero haria fallar la operacion.');
}

// ---------------------------------------------------------------------------

titulo('', 'Estado final segun Horizon');

const finTrabajador = await riel.consultarSaldo(trabajador);
const finA = await riel.consultarSaldo(bodegaA);
const finB = await riel.consultarSaldo(bodegaB);

console.log(`   ${c('TRABAJADOR', N.neg)}`);
comprobar('  saldo ALIM', finTrabajador.saldo, '0.0000000');
comprobar('  autorizado', finTrabajador.autorizado, false);
comprobar('  congelado', finTrabajador.congelado, true);
comprobar('  clawback activo', finTrabajador.clawbackActivo, true);
comprobar('  reservas a cargo del emisor', finTrabajador.patrocinador === riel.emisor, true);

console.log(`   ${c('BODEGA_A (afiliada)', N.neg)}`);
comprobar('  saldo ALIM', finA.saldo, `${COMPRA}.0000000`);
comprobar('  autorizado', finA.autorizado, true);

console.log(`   ${c('BODEGA_B (no afiliada)', N.neg)}`);
comprobar('  saldo ALIM', finB.saldo, '0.0000000');
comprobar('  autorizado', finB.autorizado, false);
comprobar('  tiene trustline', finB.tieneTrustline, true);
nota('  BODEGA_B si tiene trustline: por eso el rechazo fue op_not_authorized');
nota('  y no op_no_trust. La cuenta podia recibir; el emisor no la aprobo.');

titulo('', 'Tabla para EVIDENCIAS.md');
console.log();
console.log('| # | Operacion | Resultado | Ledger | Transaccion |');
console.log('|---|---|---|---|---|');
pasos.forEach((p, i) => {
  const resultado = p.ok ? 'exitosa' : `**rechazada**: \`${p.codigo}\``;
  const ledger = p.ledger ?? '';
  console.log(`| ${i + 1} | ${p.etiqueta} | ${resultado} | ${ledger} | [\`${p.hash.slice(0, 8)}…\`](${riel.explorador(p.hash)}) |`);
});

console.log();
if (fallos === 0) {
  console.log(c('═══ CICLO COMPLETO Y VERIFICADO ═══', N.verde));
  console.log('Los dos rechazos ocurrieron como debian. Cada hash de arriba abre');
  console.log('la transaccion en el explorador publico de Stellar.');
} else {
  console.log(c(`═══ ${fallos} COMPROBACION(ES) FALLARON ═══`, N.rojo));
  process.exitCode = 1;
}
console.log();
