/**
 * Llamadas a la API y lecturas directas de la red.
 *
 * Un pago que no se hace NO es un error aqui: llega con estado 200 y
 * `pagado: false`, y `controlDe` dice quien lo freno: la red o la aplicacion.
 */

async function pedir(ruta, metodo = 'GET', cuerpo) {
  const cabeceras = {};
  if (cuerpo) cabeceras['content-type'] = 'application/json';
  const r = await fetch(`/api/${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    credentials: 'same-origin',
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(datos.error ?? 'No se pudo completar la operación.');
    e.estado = r.status;
    e.datos = datos;
    throw e;
  }
  return datos;
}

const sesion = (accion, datos = {}) => pedir('sesion', 'POST', { accion, ...datos });

export const api = {
  sesion: () => pedir('sesion'),
  entrar: (identificador, secreto) => sesion('entrar', { identificador, secreto }),
  salir: () => sesion('salir'),
  cerrarTodas: () => sesion('cerrarTodas'),
  registrarEmpresa: (datos) => sesion('registrarEmpresa', datos),
  verInvitacion: (token) => sesion('invitacion', { token }),
  verRestablecer: (token) => sesion('verRestablecer', { token }),
  restablecer: (token, pin) => sesion('restablecer', { token, pin }),
  crearDemo: () => pedir('demo', 'POST'),

  beneficiarios: () => pedir('beneficiarios'),
  registrarBeneficiario: (datos) => pedir('beneficiarios', 'POST', datos),
  verificarBeneficiario: (id, aprobar) =>
    pedir('beneficiarios', 'POST', { accion: 'verificar', id, aprobar }),
  darDeBaja: (id) => pedir('beneficiarios', 'POST', { accion: 'baja', id }),
  darTarjeta: (id) => pedir('beneficiarios', 'POST', { accion: 'tarjeta', id }),
  anularTarjeta: (id) => pedir('beneficiarios', 'POST', { accion: 'anularTarjeta', id }),
  /** @param {'beneficiarios'|'comercios'} tabla */
  nuevoPin: (tabla, id) => pedir(tabla, 'POST', { accion: 'restablecer', id }),

  comercios: () => pedir('comercios'),
  registrarComercio: (datos) => pedir('comercios', 'POST', datos),
  verificarComercio: (id, aprobar) =>
    pedir('comercios', 'POST', { accion: 'verificar', id, aprobar }),
  cobrar: (datos) => pedir('comercios', 'POST', { accion: 'cobrar', ...datos }),

  programas: () => pedir('programas'),
  crearPrograma: (datos) => pedir('programas', 'POST', datos),
  entregar: (id) => pedir('programas', 'POST', { accion: 'entregar', id }),
  vencer: (id) => pedir('programas', 'POST', { accion: 'vencer', id }),

  pagar: (datos) => pedir('pagos', 'POST', datos),
  eventos: () => pedir('eventos'),
};

// ---------------------------------------------------------------------------
// Lecturas DIRECTAS de Horizon, sin pasar por nuestro servidor.
//
// Es deliberado: el saldo vive en Stellar y la base de datos nunca lo guarda.
// Lo que ve el usuario sale de la misma fuente que puede auditar cualquiera.
// ---------------------------------------------------------------------------

export async function saldoEnLaRed(horizon, cuenta, activo, emisor) {
  // Un fallo de la red NO es un saldo de cero. Mostrarle "S/ 0.00" a alguien
  // que acaba de recibir su vale lo asustaria. Se reintenta una vez y, si
  // sigue fallando, se avisa de que no se pudo consultar.
  let r;
  for (let intento = 0; intento < 2; intento += 1) {
    try {
      r = await fetch(`${horizon}/accounts/${cuenta}`);
      if (r.ok || r.status === 404) break;
    } catch {
      r = null;
    }
    await new Promise((listo) => { setTimeout(listo, 800); });
  }
  if (r?.status === 404) return { existe: false, saldo: '0.0000000', autorizado: false, congelado: false };
  if (!r?.ok) throw new Error('No pudimos consultar el saldo. Revisa tu conexión e inténtalo otra vez.');
  const datos = await r.json();
  const linea = datos.balances.find((b) => b.asset_code === activo && b.asset_issuer === emisor);
  return {
    existe: true,
    saldo: linea?.balance ?? '0.0000000',
    autorizado: Boolean(linea?.is_authorized),
    congelado: Boolean(linea) && !linea.is_authorized
      && Boolean(linea.is_authorized_to_maintain_liabilities),
  };
}

/** El rubro que el comercio declaro, leido del memo de la transaccion. */
function rubroDelMemo(tx) {
  if (tx?.memo_type !== 'text') return null;
  const m = /^rubro:(\w+)$/.exec(tx.memo ?? '');
  return m ? m[1] : null;
}

const esPagoDelVale = (p, cuenta, activo, emisor) => p?.type === 'payment'
  && p.to === cuenta && p.asset_code === activo && p.asset_issuer === emisor;

/** Ultimos cobros recibidos por una cuenta, con el rubro declarado. */
export async function pagosRecibidos(horizon, cuenta, activo, emisor, limite = 10) {
  const r = await fetch(
    `${horizon}/accounts/${cuenta}/payments?order=desc&limit=${limite}&join=transactions`,
  );
  if (!r.ok) return [];
  const datos = await r.json();
  return datos._embedded.records
    .filter((p) => esPagoDelVale(p, cuenta, activo, emisor))
    .map((p) => ({
      id: p.id,
      monto: p.amount,
      fecha: p.created_at,
      hash: p.transaction_hash,
      rubro: rubroDelMemo(p.transaction),
    }));
}

/**
 * Escucha en vivo los cobros que llegan a una cuenta.
 *
 * Es lo que el bodeguero necesita en caja: saber que ya le pagaron sin
 * recargar nada. Se conecta directo al flujo de Horizon desde el
 * navegador; una funcion serverless no podria mantener esta conexion.
 *
 * Solo llegan pagos exitosos: uno que la red rechazo nunca se cobro.
 *
 * @returns {() => void} funcion para dejar de escuchar
 */
export function escucharPagos(horizon, cuenta, activo, emisor, alRecibir) {
  if (typeof EventSource === 'undefined') return () => {};
  const fuente = new EventSource(`${horizon}/accounts/${cuenta}/payments?cursor=now`);
  fuente.onmessage = (e) => {
    let pago;
    try { pago = JSON.parse(e.data); } catch { return; }
    // El primer mensaje del flujo es el texto "hello": se ignora.
    if (esPagoDelVale(pago, cuenta, activo, emisor)) {
      alRecibir({ monto: pago.amount, hash: pago.transaction_hash, fecha: pago.created_at });
    }
  };
  return () => fuente.close();
}

export const explorador = (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
