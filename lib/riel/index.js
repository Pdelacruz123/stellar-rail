/**
 * El riel: todas las operaciones de Stellar del proyecto.
 *
 * Se usa creando una instancia atada a una configuracion:
 *
 *     const riel = crearRiel({ emisorSecret: process.env.ISSUER_SECRET });
 *     const r = await riel.pagar(maria, bodegaA, '18.50');
 *     if (!r.ok) console.log(r.mensaje, r.codigo);
 *
 * Dos reglas de diseño, cada una por un error que ya cometimos:
 *
 * - EL EMISOR SALE SIEMPRE DE LA CONFIGURACION, nunca de la cuenta de
 *   origen de una operacion. En Stellar Lab se autocompleto con la cuenta
 *   equivocada y creo un activo distinto con el mismo codigo: `op_no_trust`.
 *   Por eso el activo se construye una sola vez, aqui, y nadie mas lo arma.
 *
 * - UN RECHAZO DE LA RED ES UN RESULTADO, NO UNA EXCEPCION. Las funciones
 *   devuelven `{ ok: true, hash, ledger }` o `{ ok: false, hash, codigo,
 *   mensaje, ... }`. Solo lanzan excepcion los fallos de infraestructura
 *   (Horizon caido, configuracion invalida). Que la red rechace un pago a
 *   una bodega no afiliada no es un error: es el producto funcionando.
 *
 * Verificado contra @stellar/stellar-sdk 17.1.0 en testnet.
 */

import {
  Asset, Horizon, Keypair, Memo, Networks, Operation, StrKey,
} from '@stellar/stellar-sdk';
import { crearEnviador } from './red.js';
import { esPositivo, normalizarMonto } from './montos.js';
import { esRubro, memoDeRubro } from '../rubros.js';

export { CODIGOS, explicar } from './errores.js';
export { aStroops, desdeStroops, esPositivo, normalizarMonto } from './montos.js';

// Para que quien use el riel no tenga que importar el SDK por separado
// solo para crear un par de claves.
export { Keypair } from '@stellar/stellar-sdk';

/** Maximo de operaciones en una transaccion. Lo fija el protocolo. */
export const MAX_OPERACIONES = 100;

/** Operaciones que consume dar de alta una cuenta patrocinada. */
const OPS_POR_ALTA = 4;

/** Operaciones que consume vencer a un beneficiario: congelar y anular. */
const OPS_POR_VENCIMIENTO = 2;

/**
 * Flags del emisor, en una sola cifra: 1 + 2 + 8 = 11.
 *
 * AUTH_REQUIRED (1)          solo cuentas aprobadas por el emisor tienen el vale
 * AUTH_REVOCABLE (2)         el emisor puede congelar un saldo
 * AUTH_CLAWBACK_ENABLED (8)  el emisor puede anular un saldo: es el vencimiento
 *
 * NUNCA AUTH_IMMUTABLE (4): dejaria estas reglas fijas para siempre.
 */
export const FLAGS_EMISOR = 1 | 2 | 8;

/**
 * XLM con el que nace una cuenta de demo. Con las reservas patrocinadas su
 * saldo minimo es cero, asi que este importe es integramente gastable en
 * comisiones: alcanza para unos mil pagos.
 */
const SALDO_INICIAL = '0.1';

/** Valida una clave publica antes de meterla en una operacion. */
function exigirPublica(valor, nombre) {
  const publica = valor?.publicKey ? valor.publicKey() : valor;
  if (typeof publica !== 'string' || !StrKey.isValidEd25519PublicKey(publica)) {
    throw new TypeError(`${nombre} no es una clave publica de Stellar valida.`);
  }
  return publica;
}

/** Exige un Keypair con clave secreta: la cuenta tiene que poder firmar. */
function exigirFirmante(valor, nombre) {
  if (!valor?.canSign?.()) {
    throw new TypeError(`${nombre} tiene que ser un Keypair con clave secreta: debe firmar.`);
  }
  return valor;
}

/**
 * @param {object} [config]
 * @param {string} [config.emisorSecret]       Clave secreta del emisor. Solo servidor.
 * @param {string} [config.horizonUrl]
 * @param {string} [config.networkPassphrase]
 * @param {string} [config.assetCode]
 * @param {(tarea: () => Promise<any>) => Promise<any>} [config.candado]
 *   Serializa los envios del emisor. Ver `red.js`.
 */
export function crearRiel(config = {}) {
  const horizonUrl = config.horizonUrl
    ?? process.env.VITE_HORIZON_URL
    ?? 'https://horizon-testnet.stellar.org';
  const networkPassphrase = config.networkPassphrase
    ?? process.env.NETWORK_PASSPHRASE
    ?? Networks.TESTNET;
  const assetCode = config.assetCode ?? process.env.VITE_ASSET_CODE ?? 'ALIM';
  const emisorSecret = config.emisorSecret ?? process.env.ISSUER_SECRET;

  if (!emisorSecret) {
    throw new Error(
      'Falta la clave secreta del emisor. Se lee de ISSUER_SECRET, '
      + 'una variable SOLO de servidor: nunca con prefijo VITE_.',
    );
  }

  const emisor = Keypair.fromSecret(emisorSecret);
  const servidor = new Horizon.Server(horizonUrl);
  const enviar = crearEnviador({
    servidor,
    networkPassphrase,
    candado: config.candado,
    // Solo los envios del emisor se serializan: es la cuenta que firma casi
    // todo. Los pagos de los beneficiarios salen de cuentas distintas.
    cuentaSerializada: emisor.publicKey(),
  });

  // El activo se arma UNA sola vez, con el emisor de la configuracion.
  const activo = new Asset(assetCode, emisor.publicKey());

  /** Atajo: operaciones que firma el emisor desde su propia cuenta. */
  const desdeElEmisor = (operaciones, etiqueta) => enviar({
    fuente: emisor.publicKey(),
    firmantes: [emisor],
    operaciones,
    etiqueta,
  });

  return {
    activo,
    assetCode,
    horizonUrl,
    networkPassphrase,
    servidor,
    emisor: emisor.publicKey(),

    /**
     * Crea un par de claves y lo fondea con Friendbot.
     * Solo sirve en testnet, y solo para el script: una funcion serverless
     * no deberia depender de que Friendbot este disponible. En la app, las
     * cuentas nacen con `crearCuentaPatrocinada`.
     *
     * @returns {Promise<Keypair>}
     */
    async crearCuenta() {
      const kp = Keypair.random();
      const r = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
      if (!r.ok) {
        throw new Error(`Friendbot no pudo fondear la cuenta (HTTP ${r.status}).`);
      }
      return kp;
    },

    /**
     * Activa los flags de control sobre la cuenta emisora.
     *
     * TIENE QUE CORRER ANTES DE CUALQUIER TRUSTLINE: el clawback solo se
     * aplica a las trustlines creadas despues de activar el flag. Si se
     * invierte el orden, el vencimiento no funciona y el error no aparece
     * hasta el final del ciclo.
     */
    configurarEmisor() {
      return desdeElEmisor(
        [Operation.setOptions({ setFlags: FLAGS_EMISOR })],
        'configurarEmisor (Set Options, flags 1+2+8)',
      );
    },

    /**
     * La cuenta pide poder tener el vale. Nace SIN autorizar: tener el
     * activo exige dos voluntades, la de la cuenta y la del emisor.
     *
     * @param {Keypair} cuenta Tiene que firmar ella misma.
     */
    abrirTrustline(cuenta) {
      exigirFirmante(cuenta, 'cuenta');
      return enviar({
        fuente: cuenta.publicKey(),
        firmantes: [cuenta],
        operaciones: [Operation.changeTrust({ asset: activo })],
        etiqueta: `abrirTrustline (Change Trust hacia ${assetCode})`,
      });
    },

    /**
     * Crea la cuenta y su trustline en una sola transaccion, con el emisor
     * pagando las reservas.
     *
     * Toda cuenta de Stellar exige 1,5 XLM inmovilizados (1 la cuenta,
     * 0,5 la trustline). Sin esto, un trabajador tendria que conseguir XLM
     * para poder cobrar su vale de alimentacion. Con el patrocinio entra
     * con cero: su saldo minimo es (2 + 1 + 0 - 3) x 0,5 = 0.
     *
     * El sandwich lo exige el protocolo: begin y end tienen que ir en la
     * misma transaccion, y firman las dos cuentas. Nadie puede imponerle
     * un patrocinio a otro ni endosarle un costo.
     *
     * Para recuperar las reservas NO sirve revocar el patrocinio: eso las
     * TRASPASA al patrocinado, que no tiene XLM, y da `op_low_reserve`.
     * Hay que cerrar la trustline y fusionar la cuenta. Ver docs/ARQUITECTURA.md,
     * seccion 8, "Limites conocidos".
     *
     * @param {Keypair} cuenta Tiene que firmar: acepta el patrocinio.
     */
    crearCuentaPatrocinada(cuenta, opciones) {
      return this.crearCuentasPatrocinadas([cuenta], opciones);
    },

    /**
     * Crea VARIAS cuentas patrocinadas en una sola transaccion.
     *
     * Cada alta son 4 operaciones, asi que caben 25 cuentas por transaccion.
     * Importa mas de lo que parece: cada visitante de la demo necesita sus
     * propias cuentas, y los envios del emisor estan serializados. En tres
     * transacciones separadas, montar una sesion costaria tres ledgers
     * (~15s) y dos visitantes a la vez esperarian el doble. En una, un
     * ledger. Verificado en testnet con 12 operaciones.
     *
     * @param {Keypair[]} cuentas Todas tienen que firmar: aceptan el patrocinio.
     */
    crearCuentasPatrocinadas(cuentas, { saldoInicial = SALDO_INICIAL } = {}) {
      const maximo = Math.floor(MAX_OPERACIONES / OPS_POR_ALTA);
      if (cuentas.length === 0) throw new TypeError('No hay cuentas que crear.');
      if (cuentas.length > maximo) {
        throw new RangeError(
          `Son ${cuentas.length} cuentas y cada alta usa ${OPS_POR_ALTA} operaciones, `
          + `asi que caben ${maximo} por transaccion. Hay que partir el lote.`,
        );
      }

      const operaciones = [];
      for (const cuenta of cuentas) {
        exigirFirmante(cuenta, 'cuenta');
        const nueva = cuenta.publicKey();
        operaciones.push(
          Operation.beginSponsoringFutureReserves({ sponsoredId: nueva }),
          Operation.createAccount({ destination: nueva, startingBalance: saldoInicial }),
          Operation.changeTrust({ asset: activo, source: nueva }),
          Operation.endSponsoringFutureReserves({ source: nueva }),
        );
      }

      return enviar({
        fuente: emisor.publicKey(),
        firmantes: [emisor, ...cuentas],
        operaciones,
        etiqueta: cuentas.length === 1
          ? 'crearCuentaPatrocinada (reservas a cargo del emisor)'
          : `crearCuentasPatrocinadas (${cuentas.length} cuentas, reservas del emisor)`,
      });
    },

    /**
     * El emisor autoriza a una cuenta a tener el vale.
     *
     * Esta operacion ES la verificacion. Aprobar a un beneficiario o afiliar
     * a un comercio no es un campo en una base de datos: es esta transaccion,
     * publica y comprobable por cualquiera con el hash.
     *
     * @param {string|Keypair} cuenta
     */
    autorizar(cuenta) {
      const trustor = exigirPublica(cuenta, 'cuenta');
      return desdeElEmisor(
        [Operation.setTrustLineFlags({ trustor, asset: activo, flags: { authorized: true } })],
        'autorizar (Set Trust Line Flags)',
      );
    },

    /**
     * Autoriza a varias cuentas en una sola transaccion.
     * @param {(string|Keypair)[]} cuentas
     */
    autorizarVarias(cuentas) {
      if (cuentas.length > MAX_OPERACIONES) {
        throw new RangeError(
          `Son ${cuentas.length} cuentas y una transaccion admite ${MAX_OPERACIONES} operaciones. `
          + 'Hay que partir el lote.',
        );
      }
      const operaciones = cuentas.map((c) => Operation.setTrustLineFlags({
        trustor: exigirPublica(c, 'cuenta'),
        asset: activo,
        flags: { authorized: true },
      }));
      return desdeElEmisor(operaciones, `autorizarVarias (${cuentas.length} cuentas)`);
    },

    /**
     * El emisor entrega el vale. Como el pago sale de la cuenta emisora,
     * el activo nace en este momento: antes no existia.
     *
     * @param {string|Keypair} destino
     * @param {string|number} monto
     */
    emitir(destino, monto) {
      const destination = exigirPublica(destino, 'destino');
      const amount = normalizarMonto(monto);
      return desdeElEmisor(
        [Operation.payment({ destination, asset: activo, amount })],
        `emitir ${amount} ${assetCode}`,
      );
    },

    /**
     * Entrega a varios beneficiarios en una sola transaccion.
     * @param {{ cuenta: string|Keypair, monto: string|number }[]} entregas
     */
    emitirVarios(entregas) {
      if (entregas.length > MAX_OPERACIONES) {
        throw new RangeError(
          `Son ${entregas.length} entregas y una transaccion admite ${MAX_OPERACIONES} operaciones. `
          + 'Hay que partir el lote.',
        );
      }
      const operaciones = entregas.map(({ cuenta, monto }) => Operation.payment({
        destination: exigirPublica(cuenta, 'cuenta'),
        asset: activo,
        amount: normalizarMonto(monto),
      }));
      return desdeElEmisor(operaciones, `emitirVarios (${entregas.length} beneficiarios)`);
    },

    /**
     * Un beneficiario paga a un comercio.
     *
     * Esta funcion NO comprueba si el comercio esta afiliado. Es a proposito:
     * la que decide es la red. Si el comercio no esta autorizado devuelve
     * `op_not_authorized`, y ese rechazo es la demostracion central del
     * proyecto. Validarlo antes lo convertiria en una regla nuestra.
     *
     * El rubro, si se indica, viaja en el memo de la transaccion. La red no
     * ve que se compro: el rubro es lo que el comercio DECLARA, y queda en
     * el libro publico. Si declara en falso, la prueba es publica.
     *
     * @param {Keypair} origen  Tiene que firmar el.
     * @param {string|Keypair} destino
     * @param {string|number} monto
     * @param {{ rubro?: string }} [opciones]
     */
    pagar(origen, destino, monto, { rubro } = {}) {
      exigirFirmante(origen, 'origen');
      const destination = exigirPublica(destino, 'destino');
      const amount = normalizarMonto(monto);
      if (rubro !== undefined && !esRubro(rubro)) {
        throw new TypeError(`Rubro desconocido: ${rubro}.`);
      }
      return enviar({
        fuente: origen.publicKey(),
        firmantes: [origen],
        operaciones: [Operation.payment({ destination, asset: activo, amount })],
        memo: rubro ? Memo.text(memoDeRubro(rubro)) : undefined,
        etiqueta: rubro
          ? `pagar ${amount} ${assetCode} (rubro ${rubro})`
          : `pagar ${amount} ${assetCode}`,
      });
    },

    /**
     * Congela el saldo: la cuenta lo conserva pero no puede moverlo.
     * Primer paso del vencimiento.
     *
     * NO se toca el flag de clawback. El SDK solo permite ponerlo en false
     * aqui; se activa a nivel de cuenta con Set Options. Si se quita, el
     * saldo ya no se puede anular y el vencimiento deja de funcionar.
     * Omitir el campo lo deja intacto: verificado en testnet.
     *
     * @param {string|Keypair} cuenta
     */
    congelar(cuenta) {
      const trustor = exigirPublica(cuenta, 'cuenta');
      return desdeElEmisor(
        [Operation.setTrustLineFlags({
          trustor,
          asset: activo,
          flags: { authorized: false, authorizedToMaintainLiabilities: true },
        })],
        'congelar (Set Trust Line Flags)',
      );
    },

    /**
     * Devuelve una cuenta congelada al estado normal.
     *
     * Los dos flags son excluyentes: poner `authorized` sin limpiar
     * `authorizedToMaintainLiabilities` da `op_invalid_state`. Hay que
     * hacer las dos cosas en la misma operacion.
     *
     * @param {string|Keypair} cuenta
     */
    descongelar(cuenta) {
      const trustor = exigirPublica(cuenta, 'cuenta');
      return desdeElEmisor(
        [Operation.setTrustLineFlags({
          trustor,
          asset: activo,
          flags: { authorized: true, authorizedToMaintainLiabilities: false },
        })],
        'descongelar (Set Trust Line Flags)',
      );
    },

    /**
     * Anula el saldo. Esto es el vencimiento.
     *
     * El clawback DESTRUYE el vale, no lo devuelve al emisor. Lo que la
     * empresa recupera es su respaldo en soles, que deja de estar
     * comprometido. Decirlo de otra forma es falso.
     *
     * @param {string|Keypair} cuenta
     * @param {string|number} monto
     */
    anular(cuenta, monto) {
      const from = exigirPublica(cuenta, 'cuenta');
      const amount = normalizarMonto(monto);
      return desdeElEmisor(
        [Operation.clawback({ from, asset: activo, amount })],
        `anular ${amount} ${assetCode} (Clawback)`,
      );
    },

    /**
     * Vencimiento completo: congela y anula en UNA sola transaccion.
     *
     * Hacerlo en dos transacciones abre una carrera. Para anular hay que
     * saber cuanto queda, y si se lee el saldo antes de congelar, el
     * beneficiario puede gastar en el medio: el clawback pide mas de lo que
     * hay y falla con `op_underfunded`, dejando la cuenta congelada pero con
     * saldo. Un vale a medio vencer.
     *
     * Juntas, la transaccion es atomica: si el saldo cambio, falla entera y
     * no congela ni anula. Se vuelve a leer y se reintenta. Verificado en
     * testnet provocando la carrera a proposito.
     *
     * Ademas cuesta la mitad de secuencias del emisor, que es el recurso
     * escaso del sistema.
     *
     * @param {string|Keypair} cuenta
     * @param {string} saldo Saldo leido con `consultarSaldo`.
     */
    vencer(cuenta, saldo) {
      return this.vencerVarios([{ cuenta, saldo }]);
    },

    /**
     * Vence a varios beneficiarios de golpe. Dos operaciones cada uno, asi
     * que caben 50 por transaccion.
     *
     * @param {{ cuenta: string|Keypair, saldo: string }[]} entradas
     */
    vencerVarios(entradas) {
      const maximo = Math.floor(MAX_OPERACIONES / OPS_POR_VENCIMIENTO);
      if (entradas.length === 0) throw new TypeError('No hay cuentas que vencer.');
      if (entradas.length > maximo) {
        throw new RangeError(
          `Son ${entradas.length} cuentas y cada vencimiento usa ${OPS_POR_VENCIMIENTO} `
          + `operaciones, asi que caben ${maximo} por transaccion. Hay que partir el lote.`,
        );
      }

      const operaciones = [];
      let anulados = 0;
      for (const { cuenta, saldo } of entradas) {
        const trustor = exigirPublica(cuenta, 'cuenta');
        operaciones.push(Operation.setTrustLineFlags({
          trustor,
          asset: activo,
          flags: { authorized: false, authorizedToMaintainLiabilities: true },
        }));
        // Un clawback de cero hace fallar la operacion, y con ella toda la
        // transaccion. A quien ya gasto todo solo se le congela.
        if (esPositivo(saldo)) {
          operaciones.push(Operation.clawback({
            from: trustor, asset: activo, amount: normalizarMonto(saldo),
          }));
          anulados += 1;
        }
      }

      return desdeElEmisor(
        operaciones,
        `vencer ${entradas.length} cuenta(s): congelar todas, anular ${anulados}`,
      );
    },

    /**
     * Lee el saldo en Horizon. La base de datos nunca guarda saldos:
     * el saldo vive en Stellar y se lee de la red.
     *
     * @param {string|Keypair} cuenta
     * @returns {Promise<{
     *   existe: boolean, saldo: string, tieneTrustline: boolean,
     *   autorizado: boolean, congelado: boolean, clawbackActivo: boolean,
     *   xlm: string, patrocinador: string|null
     * }>}
     */
    async consultarSaldo(cuenta) {
      const publica = exigirPublica(cuenta, 'cuenta');
      let datos;
      try {
        datos = await servidor.loadAccount(publica);
      } catch (e) {
        if (e?.response?.status === 404) {
          return {
            existe: false,
            saldo: '0.0000000',
            tieneTrustline: false,
            autorizado: false,
            congelado: false,
            clawbackActivo: false,
            xlm: '0.0000000',
            patrocinador: null,
          };
        }
        throw e;
      }

      const linea = datos.balances.find(
        (b) => b.asset_code === assetCode && b.asset_issuer === emisor.publicKey(),
      );
      const nativo = datos.balances.find((b) => b.asset_type === 'native');

      return {
        existe: true,
        saldo: linea?.balance ?? '0.0000000',
        tieneTrustline: Boolean(linea),
        autorizado: Boolean(linea?.is_authorized),
        congelado: Boolean(linea) && !linea.is_authorized
          && Boolean(linea.is_authorized_to_maintain_liabilities),
        clawbackActivo: Boolean(linea?.is_clawback_enabled),
        xlm: nativo?.balance ?? '0.0000000',
        patrocinador: datos.sponsor ?? null,
      };
    },

    /**
     * Cuanto XLM tiene inmovilizado una cuenta y cuanto puede gastar.
     * Es lo que sostiene la historia del patrocinio: la cuenta de un
     * beneficiario exige cero.
     *
     * @param {string|Keypair} cuenta
     */
    async consultarReservas(cuenta) {
      const publica = exigirPublica(cuenta, 'cuenta');
      const datos = await servidor.loadAccount(publica);
      const xlm = datos.balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
      const patrocinando = datos.num_sponsoring ?? 0;
      const patrocinadas = datos.num_sponsored ?? 0;
      const minimo = (2 + datos.subentry_count + patrocinando - patrocinadas) * 0.5;
      return {
        xlm,
        minimo,
        gastable: (Number(xlm) - minimo).toFixed(7),
        patrocinando,
        patrocinadas,
        subentradas: datos.subentry_count,
      };
    },

    /** Enlace al explorador, para la UI y para EVIDENCIAS.md. */
    explorador(hash) {
      return `https://stellar.expert/explorer/testnet/tx/${hash}`;
    },

    /** ¿Queda algo que anular? Un clawback de cero hace fallar la operacion. */
    hayQueAnular: esPositivo,
  };
}
