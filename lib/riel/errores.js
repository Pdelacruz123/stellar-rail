/**
 * Traduccion de los codigos de resultado de Stellar.
 *
 * Un rechazo de la red NO es un error del programa: es el producto
 * funcionando. Que la red rechace un pago a una bodega no afiliada es
 * exactamente lo que este proyecto quiere demostrar. Por eso el riel
 * devuelve los rechazos como resultado, no como excepcion, y aqui se
 * guarda que significa cada codigo y como contarselo a una persona.
 *
 * Los codigos estan verificados contra transacciones reales en testnet.
 */

/**
 * @typedef {object} Explicacion
 * @property {string} significado  Para nosotros, en el log y en EVIDENCIAS.md.
 * @property {string} mensaje      Para la persona que esta usando la app.
 * @property {boolean} enElLedger  Si la transaccion quedo registrada y cobro comision.
 */

/** @type {Record<string, Explicacion>} */
export const CODIGOS = {
  // --- Rechazos a nivel de operacion: SI quedan en el ledger y cobran comision.
  op_not_authorized: {
    significado: 'El destino no tiene la trustline autorizada por el emisor.',
    mensaje: 'Este comercio no acepta tu vale: no está afiliado al programa.',
    enElLedger: true,
  },
  op_src_not_authorized: {
    significado: 'La cuenta de origen esta congelada por el emisor.',
    mensaje: 'Tu vale está congelado. El programa venció y ya no se puede usar.',
    enElLedger: true,
  },
  op_no_trust: {
    significado: 'El destino no tiene trustline hacia este activo. '
      + 'Ojo: suele significar que el emisor del activo esta mal armado.',
    mensaje: 'Este comercio todavía no está registrado para recibir vales.',
    enElLedger: true,
  },
  op_underfunded: {
    significado: 'Saldo insuficiente en la cuenta de origen.',
    mensaje: 'No tienes saldo suficiente para este pago.',
    enElLedger: true,
  },
  op_line_full: {
    significado: 'El monto supera el limite de la trustline del destino.',
    mensaje: 'El comercio alcanzó su límite para recibir vales.',
    enElLedger: true,
  },
  op_low_reserve: {
    significado: 'La cuenta no llega al saldo minimo que exige la red. '
      + 'Pasa al revocar un patrocinio: la reserva se TRASPASA al patrocinado, '
      + 'que no tiene XLM para asumirla.',
    mensaje: 'La cuenta no tiene el mínimo que exige la red.',
    enElLedger: true,
  },
  op_invalid_state: {
    significado: 'Combinacion de flags invalida. Pasa al descongelar si se pone '
      + 'authorized sin limpiar authorizedToMaintainLiabilities: son excluyentes.',
    mensaje: 'No se pudo cambiar el estado de la cuenta.',
    enElLedger: true,
  },
  op_no_issuer: {
    significado: 'La cuenta emisora del activo no existe. Casi siempre es un '
      + 'error de configuracion: el emisor se tomo de otro lado.',
    mensaje: 'El programa de vales no está disponible.',
    enElLedger: true,
  },

  // --- Rechazos a nivel de transaccion: NO llegan al ledger, no hay hash que mostrar.
  tx_bad_auth: {
    significado: 'Firma equivocada o faltante. No se registra en el ledger.',
    mensaje: 'No se pudo autorizar la operación.',
    enElLedger: false,
  },
  tx_bad_seq: {
    significado: 'Numero de secuencia usado. Dos transacciones de la misma cuenta '
      + 'a la vez: una cuenta solo consume una secuencia por ledger.',
    mensaje: 'El sistema está procesando otra operación. Intenta de nuevo.',
    enElLedger: false,
  },
  tx_insufficient_fee: {
    significado: 'La comision ofrecida no alcanza. La red esta congestionada.',
    mensaje: 'La red está congestionada. Intenta de nuevo en unos segundos.',
    enElLedger: false,
  },
  tx_too_late: {
    significado: 'La transaccion expiro antes de entrar (setTimeout vencido).',
    mensaje: 'La operación tardó demasiado. Intenta de nuevo.',
    enElLedger: false,
  },
  tx_too_early: {
    significado: 'La ventana de validez todavia no empieza.',
    mensaje: 'La operación no se pudo procesar. Intenta de nuevo.',
    enElLedger: false,
  },
  tx_insufficient_balance: {
    significado: 'La cuenta de origen no puede pagar la comision.',
    mensaje: 'La cuenta no tiene saldo para la comisión de la red.',
    enElLedger: false,
  },
  tx_no_source_account: {
    significado: 'La cuenta de origen no existe en la red.',
    mensaje: 'La cuenta no existe todavía.',
    enElLedger: false,
  },
};

/** Codigo que usamos cuando Horizon no nos dice nada util. */
const DESCONOCIDO = {
  significado: 'La red rechazo la operacion sin un codigo que sepamos traducir.',
  mensaje: 'No se pudo completar la operación.',
  enElLedger: false,
};

/**
 * Explica un conjunto de codigos. Se queda con el primero de operacion,
 * que es el que dice algo concreto; `tx_failed` solo dice "alguna fallo".
 *
 * @param {{ transaction?: string, operations?: string[] }} codigos
 * @returns {Explicacion & { codigo: string }}
 */
export function explicar(codigos) {
  const deOperacion = (codigos?.operations ?? []).find((c) => c && c !== 'op_success');
  const codigo = deOperacion ?? codigos?.transaction ?? 'desconocido';
  return { codigo, ...(CODIGOS[codigo] ?? DESCONOCIDO) };
}

/**
 * Saca los codigos de resultado de un error de Horizon, mirando los sitios
 * donde el SDK los deja segun como haya fallado.
 *
 * @param {unknown} error
 * @returns {{ transaction?: string, operations?: string[] } | null}
 */
export function codigosDe(error) {
  const extras = /** @type {any} */ (error)?.response?.data?.extras
    ?? /** @type {any} */ (error)?.response?.extras
    ?? /** @type {any} */ (error)?.extras;
  return extras?.result_codes ?? null;
}
