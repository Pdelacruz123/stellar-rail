/**
 * Base de datos: Neon (PostgreSQL serverless).
 *
 * Regla de oro del proyecto: **el saldo vive en Stellar**. Aqui se guarda
 * solo lo que la red no sabe. La red conoce saldos, autorizaciones e
 * historial; no conoce que la cuenta GCKD... es de Maria Quispe, ni que el
 * programa vence el 30 de octubre.
 *
 * Por eso no existe ninguna columna de saldo. Cuando la interfaz muestra un
 * saldo, lo acaba de leer de Horizon. Asi no hay dos verdades que puedan
 * discrepar, y lo que ve el usuario es lo mismo que puede auditar cualquiera.
 *
 * Tampoco se guarda ninguna clave secreta: se derivan de MASTER_SEED en
 * `lib/cuentas.js`. Una filtracion de esta base no compromete ninguna cuenta.
 *
 * Se usa el driver HTTP de Neon, no un pool TCP: una funcion serverless no
 * reutiliza conexiones y Vercel limita los descriptores de archivo.
 */

import { neon } from '@neondatabase/serverless';

let conexion = null;

/**
 * @returns {ReturnType<typeof neon>} plantilla etiquetada `sql`
 */
export function db() {
  if (conexion) return conexion;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Falta DATABASE_URL. Es una variable SOLO de servidor: nunca con prefijo VITE_.',
    );
  }
  conexion = neon(url);
  return conexion;
}

// ---------------------------------------------------------------------------
// Esquema
// ---------------------------------------------------------------------------

/**
 * Crea el esquema. Es idempotente: se puede ejecutar en cada despliegue.
 *
 * Se declara como una lista de sentencias sueltas porque el driver HTTP
 * envia una por peticion; no admite varias separadas por punto y coma.
 */
export const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS sesiones (
     id         TEXT PRIMARY KEY,
     creada_en  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS programas (
     id         SERIAL PRIMARY KEY,
     sesion_id  TEXT NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
     nombre     TEXT NOT NULL,
     monto      NUMERIC(18,7) NOT NULL CHECK (monto > 0),
     categoria  TEXT NOT NULL DEFAULT 'alimentacion',
     vence_el   DATE NOT NULL,
     estado     TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','vencido')),
     creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS beneficiarios (
     id                SERIAL PRIMARY KEY,
     sesion_id         TEXT NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
     nombre            TEXT NOT NULL,
     cuenta_publica    TEXT NOT NULL,
     estado            TEXT NOT NULL DEFAULT 'pendiente'
                       CHECK (estado IN ('pendiente','verificado','rechazado')),
     hash_verificacion TEXT,
     creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (sesion_id, cuenta_publica)
   )`,

  `CREATE TABLE IF NOT EXISTS comercios (
     id                SERIAL PRIMARY KEY,
     sesion_id         TEXT NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
     nombre            TEXT NOT NULL,
     distrito          TEXT,
     telefono          TEXT,
     cuenta_publica    TEXT NOT NULL,
     codigo_corto      TEXT NOT NULL,
     estado            TEXT NOT NULL DEFAULT 'pendiente'
                       CHECK (estado IN ('pendiente','verificado','rechazado')),
     hash_verificacion TEXT,
     creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (sesion_id, cuenta_publica),
     UNIQUE (sesion_id, codigo_corto)
   )`,

  // Espejo del ledger. El hash se guarda ANTES de enviar la transaccion: si
  // el envio se corta a medias, la evidencia no se pierde.
  `CREATE TABLE IF NOT EXISTS eventos (
     id            SERIAL PRIMARY KEY,
     sesion_id     TEXT REFERENCES sesiones(id) ON DELETE CASCADE,
     tipo          TEXT NOT NULL,
     etiqueta      TEXT NOT NULL,
     hash          TEXT NOT NULL,
     ledger        BIGINT,
     exitosa       BOOLEAN,
     codigo_error  TEXT,
     creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS eventos_por_sesion ON eventos (sesion_id, creado_en DESC)`,

  // Candado de arrendamiento para serializar los envios del emisor. Ver
  // `tomarCandado` mas abajo.
  `CREATE TABLE IF NOT EXISTS candados (
     nombre     TEXT PRIMARY KEY,
     titular    TEXT,
     expira_en  TIMESTAMPTZ
   )`,

  `INSERT INTO candados (nombre) VALUES ('emisor') ON CONFLICT (nombre) DO NOTHING`,
];

/** Ejecuta el esquema completo. */
export async function migrar() {
  const sql = db();
  for (const sentencia of ESQUEMA) await sql.query(sentencia);
}

// ---------------------------------------------------------------------------
// Candado del emisor
// ---------------------------------------------------------------------------

/**
 * El emisor firma casi todo: autorizar, emitir, congelar, anular. Una cuenta
 * de Stellar consume una sola secuencia por ledger (~5s), asi que dos
 * peticiones simultaneas chocan con `tx_bad_seq`.
 *
 * No se usa `pg_advisory_lock` porque el driver HTTP es sin estado: cada
 * consulta es una peticion independiente y la sesion de Postgres muere con
 * ella, asi que un candado de sesion se soltaria solo. En su lugar, un
 * arrendamiento con vencimiento: una fila que se toma por un rato. Si una
 * funcion muere sin soltarlo, el candado caduca y nadie queda bloqueado.
 */
const CANDADO_SEGUNDOS = 25;
const ESPERA_MS = 400;

async function intentarTomar(sql, titular) {
  const filas = await sql`
    UPDATE candados
       SET titular = ${titular},
           expira_en = now() + make_interval(secs => ${CANDADO_SEGUNDOS})
     WHERE nombre = 'emisor'
       AND (titular IS NULL OR expira_en < now())
    RETURNING titular`;
  return filas.length > 0;
}

/**
 * Ejecuta una tarea con el candado del emisor tomado.
 *
 * Se pasa a `crearRiel({ candado })`, que lo aplica solo a los envios cuyo
 * origen es el emisor. Los pagos de los beneficiarios no pasan por aqui:
 * cada uno tiene su propia cuenta y su propia secuencia.
 *
 * @template T
 * @param {() => Promise<T>} tarea
 * @param {{ esperaMaximaMs?: number }} [opciones]
 * @returns {Promise<T>}
 */
export async function conCandadoDelEmisor(tarea, { esperaMaximaMs = 20000 } = {}) {
  const sql = db();
  const titular = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const limite = Date.now() + esperaMaximaMs;

  let tomado = false;
  while (Date.now() < limite) {
    // eslint-disable-next-line no-await-in-loop
    if (await intentarTomar(sql, titular)) { tomado = true; break; }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((s) => { setTimeout(s, ESPERA_MS + Math.random() * 200); });
  }

  if (!tomado) {
    throw new Error(
      'El emisor esta ocupado y no se libero a tiempo. Vuelve a intentarlo.',
    );
  }

  try {
    return await tarea();
  } finally {
    // Solo lo suelta quien lo tiene: si ya caduco y otro lo tomo, no se le quita.
    await sql`
      UPDATE candados SET titular = NULL, expira_en = NULL
       WHERE nombre = 'emisor' AND titular = ${titular}`;
  }
}

// ---------------------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------------------

/** @param {string} id */
export async function crearSesion(id) {
  const sql = db();
  await sql`INSERT INTO sesiones (id) VALUES (${id}) ON CONFLICT (id) DO NOTHING`;
  return id;
}

/** @param {string} id */
export async function existeSesion(id) {
  const sql = db();
  const filas = await sql`SELECT 1 FROM sesiones WHERE id = ${id}`;
  return filas.length > 0;
}

// ---------------------------------------------------------------------------
// Programas
// ---------------------------------------------------------------------------

export async function crearPrograma({ sesion, nombre, monto, categoria, venceEl }) {
  const sql = db();
  const [fila] = await sql`
    INSERT INTO programas (sesion_id, nombre, monto, categoria, vence_el)
    VALUES (${sesion}, ${nombre}, ${monto}, ${categoria ?? 'alimentacion'}, ${venceEl})
    RETURNING *`;
  return fila;
}

export async function programasDe(sesion) {
  const sql = db();
  return sql`SELECT * FROM programas WHERE sesion_id = ${sesion} ORDER BY id`;
}

export async function marcarProgramaVencido(id) {
  const sql = db();
  const [fila] = await sql`
    UPDATE programas SET estado = 'vencido' WHERE id = ${id} RETURNING *`;
  return fila;
}

// ---------------------------------------------------------------------------
// Beneficiarios y comercios
//
// Comparten forma: registro en `pendiente`, y una aprobacion que ejecuta la
// autorizacion en la red y guarda su hash. Esa aprobacion ES la verificacion.
// ---------------------------------------------------------------------------

export async function crearBeneficiario({ sesion, nombre, cuentaPublica }) {
  const sql = db();
  const [fila] = await sql`
    INSERT INTO beneficiarios (sesion_id, nombre, cuenta_publica)
    VALUES (${sesion}, ${nombre}, ${cuentaPublica})
    RETURNING *`;
  return fila;
}

export async function beneficiariosDe(sesion, estado = null) {
  const sql = db();
  return estado
    ? sql`SELECT * FROM beneficiarios WHERE sesion_id = ${sesion} AND estado = ${estado} ORDER BY id`
    : sql`SELECT * FROM beneficiarios WHERE sesion_id = ${sesion} ORDER BY id`;
}

export async function beneficiario(sesion, id) {
  const sql = db();
  const [fila] = await sql`
    SELECT * FROM beneficiarios WHERE sesion_id = ${sesion} AND id = ${id}`;
  return fila ?? null;
}

export async function crearComercio({ sesion, nombre, distrito, telefono, cuentaPublica, codigoCorto }) {
  const sql = db();
  const [fila] = await sql`
    INSERT INTO comercios (sesion_id, nombre, distrito, telefono, cuenta_publica, codigo_corto)
    VALUES (${sesion}, ${nombre}, ${distrito ?? null}, ${telefono ?? null},
            ${cuentaPublica}, ${codigoCorto})
    RETURNING *`;
  return fila;
}

export async function comerciosDe(sesion, estado = null) {
  const sql = db();
  return estado
    ? sql`SELECT * FROM comercios WHERE sesion_id = ${sesion} AND estado = ${estado} ORDER BY id`
    : sql`SELECT * FROM comercios WHERE sesion_id = ${sesion} ORDER BY id`;
}

export async function comercio(sesion, id) {
  const sql = db();
  const [fila] = await sql`SELECT * FROM comercios WHERE sesion_id = ${sesion} AND id = ${id}`;
  return fila ?? null;
}

/** Busca un comercio por el codigo de 6 digitos que muestra en caja. */
export async function comercioPorCodigo(sesion, codigo) {
  const sql = db();
  const [fila] = await sql`
    SELECT * FROM comercios WHERE sesion_id = ${sesion} AND codigo_corto = ${codigo}`;
  return fila ?? null;
}

/**
 * Guarda el resultado de una verificacion.
 *
 * @param {'beneficiarios'|'comercios'} tabla
 * @param {number} id
 * @param {'verificado'|'rechazado'} estado
 * @param {string|null} hash  La transaccion que lo autorizo en la red.
 */
export async function guardarVerificacion(tabla, id, estado, hash = null) {
  const sql = db();
  // El nombre de tabla no puede ir parametrizado, asi que se valida contra
  // una lista cerrada: nunca se interpola nada que venga del usuario.
  if (tabla !== 'beneficiarios' && tabla !== 'comercios') {
    throw new TypeError(`Tabla invalida: ${tabla}`);
  }
  const consulta = `UPDATE ${tabla} SET estado = $1, hash_verificacion = $2
                    WHERE id = $3 RETURNING *`;
  // Ojo: sql.query() devuelve el array de filas, no un objeto { rows }.
  const filas = await sql.query(consulta, [estado, hash, id]);
  return filas[0] ?? null;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

/**
 * Anota una transaccion. Acepta tal cual el resultado del riel, que trae
 * `{ ok, hash, ledger }` o `{ ok, hash, codigo }`.
 *
 * @param {string|null} sesion
 * @param {string} tipo
 * @param {{ ok: boolean, hash: string, ledger?: number, etiqueta?: string, codigo?: string }} r
 */
export async function anotarEvento(sesion, tipo, r) {
  const sql = db();
  const [fila] = await sql`
    INSERT INTO eventos (sesion_id, tipo, etiqueta, hash, ledger, exitosa, codigo_error)
    VALUES (${sesion}, ${tipo}, ${r.etiqueta ?? tipo}, ${r.hash},
            ${r.ledger ?? null}, ${r.ok}, ${r.ok ? null : (r.codigo ?? null)})
    RETURNING *`;
  return fila;
}

export async function eventosDe(sesion, limite = 50) {
  const sql = db();
  return sql`
    SELECT * FROM eventos WHERE sesion_id = ${sesion}
     ORDER BY creado_en DESC, id DESC LIMIT ${limite}`;
}
