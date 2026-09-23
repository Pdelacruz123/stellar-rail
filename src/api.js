/**
 * Llamadas a la API. Una sola funcion: todo el backend habla JSON y
 * responde con la misma forma.
 *
 * Un pago que la red rechaza NO es un error aqui: llega con estado 200 y
 * `pagado: false`. Es el resultado, y es lo que el proyecto demuestra.
 */

async function pedir(ruta, metodo = 'GET', cuerpo) {
  const r = await fetch(`/api/${ruta}`, {
    method: metodo,
    headers: cuerpo ? { 'content-type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    credentials: 'same-origin',
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(datos.error ?? 'No se pudo completar la operacion.');
    e.estado = r.status;
    e.datos = datos;
    throw e;
  }
  return datos;
}

export const api = {
  sesion: () => pedir('sesion'),
  entrar: (clave) => pedir('entrar', 'POST', { clave }),

  beneficiarios: () => pedir('beneficiarios'),
  registrarBeneficiario: (nombre) => pedir('beneficiarios', 'POST', { nombre }),
  verificarBeneficiario: (id, aprobar) =>
    pedir('beneficiarios', 'POST', { accion: 'verificar', id, aprobar }),

  comercios: () => pedir('comercios'),
  registrarComercio: (datos) => pedir('comercios', 'POST', datos),
  verificarComercio: (id, aprobar) =>
    pedir('comercios', 'POST', { accion: 'verificar', id, aprobar }),

  programas: () => pedir('programas'),
  crearPrograma: (datos) => pedir('programas', 'POST', datos),
  entregar: (id) => pedir('programas', 'POST', { accion: 'entregar', id }),
  vencer: (id) => pedir('programas', 'POST', { accion: 'vencer', id }),

  pagar: (datos) => pedir('pagos', 'POST', datos),
  eventos: () => pedir('eventos'),
};

/**
 * Saldo leido DIRECTAMENTE de Horizon, sin pasar por nuestro servidor.
 *
 * Es deliberado: el saldo vive en Stellar y la base de datos nunca lo
 * guarda. Lo que ve el usuario sale de la misma fuente que puede auditar
 * cualquiera.
 */
export async function saldoEnLaRed(horizon, cuenta, activo, emisor) {
  const r = await fetch(`${horizon}/accounts/${cuenta}`);
  if (!r.ok) return { existe: false, saldo: '0.0000000', autorizado: false, congelado: false };
  const datos = await r.json();
  const linea = datos.balances.find((b) => b.asset_code === activo && b.asset_issuer === emisor);
  return {
    existe: true,
    saldo: linea?.balance ?? '0.0000000',
    autorizado: Boolean(linea?.is_authorized),
    congelado: Boolean(linea) && !linea.is_authorized
      && Boolean(linea.is_authorized_to_maintain_liabilities),
    xlm: datos.balances.find((b) => b.asset_type === 'native')?.balance ?? '0',
    patrocinador: datos.sponsor ?? null,
  };
}
