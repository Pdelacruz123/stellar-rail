import test from 'node:test';
import assert from 'node:assert/strict';

// La firma depende de MASTER_SEED; se fija antes de cargar el modulo.
process.env.MASTER_SEED = 'c'.repeat(64);
const { tokenDeInvitacion, leerInvitacion } = await import('./http.js');

const S = 'abcdef1234567890';

test('una invitacion valida se lee con su espacio y su rol', () => {
  for (const rol of ['beneficiario', 'comercio']) {
    assert.deepEqual(leerInvitacion(tokenDeInvitacion(S, rol)), { sesion: S, rol });
  }
});

test('a la empresa no se la invita: se crea al abrir la aplicacion', () => {
  assert.throws(() => tokenDeInvitacion(S, 'empresa'), TypeError);
});

test('cambiar el rol de una invitacion la invalida', () => {
  // Un trabajador no puede convertir su enlace en uno de comercio, ni de empresa.
  const [sesion, , firma] = tokenDeInvitacion(S, 'beneficiario').split('.');
  assert.equal(leerInvitacion(`${sesion}.comercio.${firma}`), null);
  assert.equal(leerInvitacion(`${sesion}.empresa.${firma}`), null);
});

test('cambiar el espacio de una invitacion la invalida', () => {
  const [, rol, firma] = tokenDeInvitacion(S, 'comercio').split('.');
  assert.equal(leerInvitacion(`otroespacio123456.${rol}.${firma}`), null);
});

test('una firma inventada o recortada no sirve', () => {
  assert.equal(leerInvitacion(`${S}.beneficiario.inventada`), null);
  const bueno = tokenDeInvitacion(S, 'beneficiario');
  assert.equal(leerInvitacion(bueno.slice(0, -1)), null);
});

test('entradas basura no rompen nada', () => {
  for (const basura of [undefined, null, '', '.', '..', 'a.b.c.d', 12345, {}]) {
    assert.equal(leerInvitacion(basura), null);
  }
});

test('con otra semilla maestra, la misma invitacion deja de valer', async () => {
  const token = tokenDeInvitacion(S, 'beneficiario');
  process.env.MASTER_SEED = 'd'.repeat(64);
  try {
    assert.equal(leerInvitacion(token), null);
  } finally {
    process.env.MASTER_SEED = 'c'.repeat(64);
  }
});
