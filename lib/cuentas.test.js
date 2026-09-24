import test from 'node:test';
import assert from 'node:assert/strict';
import {
  codigoCorto, derivarCuenta, nuevaSesion, publicaDe,
} from './cuentas.js';

const SEMILLA = 'a'.repeat(64);
const OTRA = 'b'.repeat(64);
const base = { sesion: 'abc12345', rol: 'beneficiario', id: 1 };

test('la misma ruta da siempre la misma cuenta', () => {
  assert.equal(publicaDe(base, SEMILLA), publicaDe(base, SEMILLA));
});

test('cambiar cualquier tramo de la ruta da otra cuenta', () => {
  const original = publicaDe(base, SEMILLA);
  assert.notEqual(publicaDe({ ...base, sesion: 'zzz99999' }, SEMILLA), original);
  assert.notEqual(publicaDe({ ...base, rol: 'comercio' }, SEMILLA), original);
  assert.notEqual(publicaDe({ ...base, id: 2 }, SEMILLA), original);
});

test('otra semilla maestra da otro juego de cuentas', () => {
  assert.notEqual(publicaDe(base, OTRA), publicaDe(base, SEMILLA));
});

test('la cuenta derivada puede firmar', () => {
  assert.equal(derivarCuenta(base, SEMILLA).canSign(), true);
});

test('dos sesiones distintas no comparten ninguna cuenta', () => {
  const a = nuevaSesion();
  const b = nuevaSesion();
  assert.notEqual(a, b);
  for (const rol of ['beneficiario', 'comercio']) {
    for (const id of [1, 2, 3]) {
      assert.notEqual(publicaDe({ sesion: a, rol, id }, SEMILLA),
        publicaDe({ sesion: b, rol, id }, SEMILLA));
    }
  }
});

test('nuevaSesion produce un identificador que la derivacion acepta', () => {
  assert.doesNotThrow(() => publicaDe({ ...base, sesion: nuevaSesion() }, SEMILLA));
});

test('rechaza una sesion con formato invalido', () => {
  for (const sesion of ['corta', '', 'con espacios', 'MAYUSCULAS', 'a'.repeat(65)]) {
    assert.throws(() => publicaDe({ ...base, sesion }, SEMILLA), TypeError);
  }
});

test('rechaza un rol desconocido', () => {
  assert.throws(() => publicaDe({ ...base, rol: 'emisor' }, SEMILLA), TypeError);
});

test('rechaza un id que contenga ":"', () => {
  // Si un tramo pudiera llevar el separador, dos rutas distintas podrian
  // colapsar en la misma clave: "a:b" + "c" daria lo mismo que "a" + "b:c".
  assert.throws(() => publicaDe({ ...base, id: '1:beneficiario:1' }, SEMILLA), TypeError);
});

test('rechaza un id vacio', () => {
  for (const id of [null, undefined, '']) {
    assert.throws(() => publicaDe({ ...base, id }, SEMILLA), TypeError);
  }
});

test('exige una semilla maestra, y que no sea corta', () => {
  assert.throws(() => publicaDe(base, undefined), /MASTER_SEED/);
  assert.throws(() => publicaDe(base, 'corta'), /al menos 32/);
});

test('el codigo corto son 6 digitos, estable y distinto por comercio', () => {
  const uno = codigoCorto({ sesion: 'abc12345', id: 1 }, SEMILLA);
  assert.match(uno, /^\d{6}$/);
  assert.equal(uno, codigoCorto({ sesion: 'abc12345', id: 1 }, SEMILLA));
  assert.notEqual(uno, codigoCorto({ sesion: 'abc12345', id: 2 }, SEMILLA));
  assert.notEqual(uno, codigoCorto({ sesion: 'zzz99999', id: 1 }, SEMILLA));
});
