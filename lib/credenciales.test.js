import test from 'node:test';
import assert from 'node:assert/strict';

// La firma de sesiones depende de MASTER_SEED; se fija antes de cargar http.js.
process.env.MASTER_SEED = 'd'.repeat(64);
const {
  cifrar, verificar, pinValido, normalizarCelular, normalizarCorreo,
  contrasenaValida,
} = await import('./credenciales.js');
const { periodoDe } = await import('./rubros.js');
const {
  credencialDe, leerCredencial, tokenDeRestablecer, leerRestablecer,
} = await import('./http.js');

const S = 'abcdef1234567890';

test('el PIN se guarda cifrado y solo coincide el correcto', async () => {
  const { hash, sal } = await cifrar('2580');
  assert.ok(!hash.includes('2580'));
  assert.equal(await verificar('2580', hash, sal), true);
  assert.equal(await verificar('2581', hash, sal), false);
  assert.equal(await verificar('', hash, sal), false);
  assert.equal(await verificar('2580', null, null), false);
});

test('dos personas con el mismo PIN no tienen el mismo hash', async () => {
  const a = await cifrar('2580');
  const b = await cifrar('2580');
  assert.notEqual(a.hash, b.hash);
});

test('PIN: 4 numeros, sin los que se adivinan al primer intento', () => {
  for (const p of ['2580', '0917', '9021']) assert.equal(pinValido(p), true, p);
  for (const p of ['1234', '4321', '0000', '7777', '123', '12345', 'abcd', '', null]) {
    assert.equal(pinValido(p), false, String(p));
  }
});

test('celular: como lo escriba la persona, 9 digitos que empiezan por 9', () => {
  assert.equal(normalizarCelular('+51 987 654 321'), '987654321');
  assert.equal(normalizarCelular('987-654-321'), '987654321');
  assert.equal(normalizarCelular('51987654321'), '987654321');
  assert.equal(normalizarCelular('887654321'), null);
  assert.equal(normalizarCelular('98765432'), null);
  assert.equal(normalizarCelular(undefined), null);
});

test('correo en minusculas y con forma de correo', () => {
  assert.equal(normalizarCorreo('  RRHH@Empresa.PE '), 'rrhh@empresa.pe');
  assert.equal(normalizarCorreo('sin-arroba'), null);
});

test('la contrasena de la empresa tiene al menos 8 caracteres', () => {
  assert.equal(contrasenaValida('LosAndes-2026'), true);
  assert.equal(contrasenaValida('corta'), false);
});

test('la prestacion alimentaria se recarga por mes de Lima; un bono, una vez', () => {
  // 1 de octubre a las 02:00 UTC todavia es 30 de setiembre en Lima.
  assert.equal(periodoDe('alimentaria', new Date('2026-10-01T02:00:00Z')), '2026-09');
  assert.equal(periodoDe('alimentaria', new Date('2026-10-01T06:00:00Z')), '2026-10');
  assert.equal(periodoDe('bono', new Date('2026-10-01T06:00:00Z')), '');
});

test('la credencial de sesion se lee, y no se puede alterar', () => {
  const u = { id: 7, version: 3, sesion_id: S };
  const c = credencialDe(u);
  assert.deepEqual(leerCredencial(c), { sesion: S, usuarioId: 7, version: 3 });
  // Hacerse pasar por otro usuario, o revivir una version cerrada, rompe la firma.
  assert.equal(leerCredencial(c.replace('u:7:', 'u:8:')), null);
  assert.equal(leerCredencial(c.replace(':3.', ':2.')), null);
  assert.equal(leerCredencial(c.replace(S, 'otroespacio12345')), null);
  assert.equal(leerCredencial('basura'), null);
  assert.equal(leerCredencial(undefined), null);
});

test('el enlace para restablecer el PIN caduca en 24 horas', () => {
  const ahora = Date.UTC(2026, 8, 24, 12);
  const t = tokenDeRestablecer({ id: 5, version: 2 }, ahora);
  assert.deepEqual(leerRestablecer(t, ahora + 23 * 3600e3), { usuarioId: 5, version: 2 });
  assert.equal(leerRestablecer(t, ahora + 25 * 3600e3), null);
});

test('el enlace para restablecer no se puede reescribir para otra persona', () => {
  const t = tokenDeRestablecer({ id: 5, version: 2 });
  const [, version, exp, firma] = t.split('.');
  assert.equal(leerRestablecer(`6.${version}.${exp}.${firma}`), null);
  assert.equal(leerRestablecer(`5.${version}.zzzzzzz.${firma}`), null);
  assert.equal(leerRestablecer('1.2.3'), null);
});

test('la pantalla avisa del PIN facil o distinto, solo cuando ya hay 4 numeros', async () => {
  const { problemaDelPin } = await import('./reglas.js');
  assert.equal(problemaDelPin('12', ''), '');
  assert.match(problemaDelPin('1234', ''), /muy fácil/);
  assert.match(problemaDelPin('7777', ''), /muy fácil/);
  assert.equal(problemaDelPin('2580', '25'), '');
  assert.match(problemaDelPin('2580', '2581'), /no son iguales/);
  assert.equal(problemaDelPin('2580', '2580'), '');
});
