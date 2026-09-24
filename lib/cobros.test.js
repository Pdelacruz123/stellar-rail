import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MASTER_SEED = 'e'.repeat(64);
const {
  aCentimos, desdeCentimos, crearCobro, leerCobro, VIGENCIA_SEGUNDOS,
} = await import('./cobros.js');

const S = 'espacio0123456789';
const T0 = Date.UTC(2026, 8, 24, 12, 0, 0);
const nuevo = (extra = {}) => crearCobro({
  sesion: S, comercioId: 7, monto: '18,50', rubro: 'alimentos', ahora: T0, ...extra,
});

test('los montos se pasan a centimos sin redondeos', () => {
  assert.equal(aCentimos('18.50'), 1850);
  assert.equal(aCentimos('18,5'), 1850);
  assert.equal(aCentimos('0.1'), 10);
  assert.equal(aCentimos('1500'), 150000);
  assert.equal(desdeCentimos(1850), '18.50');
  assert.equal(desdeCentimos(5), '0.05');
  for (const malo of ['', '0', '0.00', '-3', '18.505', 'abc', '1e3', null, '9999999']) {
    assert.equal(aCentimos(malo), null, `deberia rechazar ${malo}`);
  }
});

test('un cobro se lee con su comercio, su monto y su rubro', () => {
  const c = nuevo();
  const leido = leerCobro(S, c.token, T0 + 1000);
  assert.equal(leido.comercioId, 7);
  assert.equal(leido.monto, '18.50');
  assert.equal(leido.rubro, 'alimentos');
});

test('cambiar el monto invalida el cobro', () => {
  const partes = nuevo().token.split('.');
  partes[1] = '1';
  assert.ok(leerCobro(S, partes.join('.'), T0).error);
});

test('cambiar el rubro invalida el cobro: una tele no se puede pasar por comida', () => {
  const c = nuevo({ rubro: 'electro', monto: '1500' });
  const partes = c.token.split('.');
  partes[2] = 'alimentos';
  assert.ok(leerCobro(S, partes.join('.'), T0).error);
});

test('cambiar el comercio invalida el cobro', () => {
  const partes = nuevo().token.split('.');
  partes[0] = '8';
  assert.ok(leerCobro(S, partes.join('.'), T0).error);
});

test('un cobro de otra empresa no sirve aqui', () => {
  assert.ok(leerCobro('otroespacio98765432', nuevo().token, T0).error);
});

test('caduca a los 10 minutos', () => {
  const c = nuevo();
  assert.ok(!leerCobro(S, c.token, T0 + (VIGENCIA_SEGUNDOS - 1) * 1000).error);
  assert.match(leerCobro(S, c.token, T0 + (VIGENCIA_SEGUNDOS + 1) * 1000).error, /venció/);
});

test('rechaza datos invalidos al crear', () => {
  assert.throws(() => nuevo({ monto: '0' }), TypeError);
  assert.throws(() => nuevo({ rubro: 'armas' }), TypeError);
  assert.throws(() => nuevo({ comercioId: 'x' }), TypeError);
});

test('entradas basura no rompen la lectura', () => {
  for (const basura of [undefined, null, '', 'a.b.c', '1.2.3.4.5.6', 12, 'x.1850.alimentos.zz.firma']) {
    assert.ok(leerCobro(S, basura, T0).error);
  }
});
