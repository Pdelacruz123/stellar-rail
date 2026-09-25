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

  // Rubros. Se anaden con ALTER para no romper una base que ya existe.
  // El tipo de programa decide si los rubros los fija la ley o la empresa.
  `ALTER TABLE programas ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'alimentaria'`,
  `ALTER TABLE programas ADD COLUMN IF NOT EXISTS rubros TEXT[] NOT NULL DEFAULT '{alimentos}'`,
  // El rubro que el comercio declara por defecto en cada cobro.
  `ALTER TABLE comercios ADD COLUMN IF NOT EXISTS rubro TEXT NOT NULL DEFAULT 'alimentos'`,

  // Cobros con monto ya pagados. Un QR de cobro se paga una sola vez: si el
  // cliente lo escanea dos veces, o toca dos veces el boton, no paga doble.
  // Quien recibio el vale de cada programa. Se reserva ANTES de emitir: dos
  // clics seguidos en "Entregar" no pueden emitir dos veces el mismo vale.
  // Y quien se verifica despues de la entrega puede recibir el suyo luego.
  `CREATE TABLE IF NOT EXISTS entregas (
     programa_id     INTEGER NOT NULL REFERENCES programas(id) ON DELETE CASCADE,
     beneficiario_id INTEGER NOT NULL REFERENCES beneficiarios(id) ON DELETE CASCADE,
     hash            TEXT,
     entregado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (programa_id, beneficiario_id)
   )`,
  // La prestacion alimentaria se recarga cada mes: una entrega por trabajador
  // y por mes ("2026-09"). Un bono, una sola vez (periodo '').
  `ALTER TABLE entregas ADD COLUMN IF NOT EXISTS periodo TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE entregas DROP CONSTRAINT IF EXISTS entregas_pkey`,
  `ALTER TABLE entregas ADD CONSTRAINT entregas_pkey PRIMARY KEY (programa_id, beneficiario_id, periodo)`,

  // --- Cuentas de acceso -----------------------------------------------------
  `ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS es_demo BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS nombre TEXT`,

  // Quien puede entrar y con que. El identificador es el celular (trabajador
  // y tienda) o el correo (empresa), unico en todo el sistema. El PIN o la
  // contrasena se guardan cifrados con scrypt; nunca en claro.
  // `version` sube cuando se cierran todas las sesiones o se cambia el PIN:
  // las credenciales firmadas con la version anterior dejan de valer.
  `CREATE TABLE IF NOT EXISTS usuarios (
     id              SERIAL PRIMARY KEY,
     sesion_id       TEXT NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
     rol             TEXT NOT NULL CHECK (rol IN ('empresa','beneficiario','comercio')),
     ref_id          INTEGER,
     identificador   TEXT NOT NULL UNIQUE,
     hash            TEXT NOT NULL,
     sal             TEXT NOT NULL,
     version         INTEGER NOT NULL DEFAULT 1,
     intentos        INTEGER NOT NULL DEFAULT 0,
     bloqueado_hasta TIMESTAMPTZ,
     creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // Quien deja la empresa pasa a 'baja': no recibe mas vales, pero conserva
  // lo que ya tiene hasta que el programa venza, como en las tarjetas reales.
  `ALTER TABLE beneficiarios DROP CONSTRAINT IF EXISTS beneficiarios_estado_check`,
  `ALTER TABLE beneficiarios ADD CONSTRAINT beneficiarios_estado_check
     CHECK (estado IN ('pendiente','verificado','rechazado','baja'))`,

  `CREATE TABLE IF NOT EXISTS cobros_usados (
     firma      TEXT PRIMARY KEY,
     sesion_id  TEXT REFERENCES sesiones(id) ON DELETE CASCADE,
     usado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // El codigo de pago del trabajador, como el codigo de aprobacion de Yape:
  // lo genera con su PIN, se lo dicta a la tienda y sirve para UN pago
  // durante unos minutos. `ultimo` guarda el ultimo intento de cobro, para
  // que el trabajador vea en su celular si paso o por que no.
  `CREATE TABLE IF NOT EXISTS codigos_pago (
     sesion_id       TEXT NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
     codigo          TEXT NOT NULL,
     beneficiario_id INTEGER NOT NULL,
     expira_en       TIMESTAMPTZ NOT NULL,
     usado_en        TIMESTAMPTZ,
     ultimo          JSONB,
     PRIMARY KEY (sesion_id, codigo)
   )`,
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

/**
 * Crea el espacio de una empresa.
 * @param {string} id
 * @param {{ esDemo?: boolean, nombre?: string|null }} [opciones]
 */
export async function crearSesion(id, { esDemo = false, nombre = null } = {}) {
  const sql = db();
  await sql`
    INSERT INTO sesiones (id, es_demo, nombre) VALUES (${id}, ${esDemo}, ${nombre})
    ON CONFLICT (id) DO NOTHING`;
  return id;
}

export async function sesion(id) {
  const sql = db();
  const [fila] = await sql`SELECT * FROM sesiones WHERE id = ${id}`;
  return fila ?? null;
}

/** Demostraciones creadas en la ultima hora: tope contra el abuso. */
export async function demosRecientes() {
  const sql = db();
  const [fila] = await sql`
    SELECT count(*)::int AS n FROM sesiones
     WHERE es_demo AND creada_en > now() - interval '1 hour'`;
  return fila.n;
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

export async function crearPrograma({ sesion, nombre, monto, tipo, rubros, venceEl }) {
  const sql = db();
  const [fila] = await sql`
    INSERT INTO programas (sesion_id, nombre, monto, tipo, rubros, vence_el)
    VALUES (${sesion}, ${nombre}, ${monto}, ${tipo}, ${rubros}, ${venceEl})
    RETURNING *`;
  return fila;
}

/**
 * El programa vigente de la empresa, si hay uno.
 *
 * Solo puede haber uno a la vez. Todos los vales son el mismo activo, ALIM,
 * y los saldos de dos programas distintos se mezclarian en la misma cuenta:
 * no habria forma de saber que parte del saldo tiene que reglas. Separarlos
 * de verdad exige un activo por programa, que es el siguiente paso.
 */
export async function programaVigente(sesion) {
  const sql = db();
  const [fila] = await sql`
    SELECT * FROM programas WHERE sesion_id = ${sesion} AND estado = 'vigente'
     ORDER BY id DESC LIMIT 1`;
  return fila ?? null;
}

/**
 * Los programas de la empresa. `mes` es el periodo actual de un programa
 * recargable ("2026-09"): `recibieron` dice quien ya recibio la recarga de
 * este mes; en un bono, quien recibio el vale.
 */
export async function programasDe(sesion, mes) {
  const sql = db();
  // `entregados` cuenta vales emitidos de verdad, con su hash: no una
  // estimacion a partir de cuantos trabajadores hay verificados.
  return sql`
    SELECT p.*,
           (SELECT count(*) FROM entregas e
             WHERE e.programa_id = p.id AND e.hash IS NOT NULL)::int AS entregados,
           (SELECT coalesce(array_agg(e.beneficiario_id), '{}') FROM entregas e
             WHERE e.programa_id = p.id AND e.hash IS NOT NULL
               AND e.periodo = CASE WHEN p.tipo = 'alimentaria' THEN ${mes} ELSE '' END) AS recibieron
      FROM programas p
     WHERE p.sesion_id = ${sesion}
     ORDER BY p.id`;
}

/**
 * Reserva la entrega del vale de este periodo a estos trabajadores y
 * devuelve solo los que aun no lo tenian. Si dos peticiones llegan a la vez,
 * la segunda no recibe a nadie: no se emite dos veces.
 */
export async function reservarEntregas(programaId, periodo, beneficiarioIds) {
  if (!beneficiarioIds.length) return [];
  const sql = db();
  const filas = await sql`
    INSERT INTO entregas (programa_id, periodo, beneficiario_id)
    SELECT ${programaId}, ${periodo}, unnest(${beneficiarioIds}::int[])
    ON CONFLICT DO NOTHING
    RETURNING beneficiario_id`;
  return filas.map((f) => f.beneficiario_id);
}

/** Anota el hash de una entrega que la red confirmo. */
export async function confirmarEntregas(programaId, periodo, beneficiarioIds, hash) {
  const sql = db();
  await sql`
    UPDATE entregas SET hash = ${hash}
     WHERE programa_id = ${programaId} AND periodo = ${periodo}
       AND beneficiario_id = ANY(${beneficiarioIds}::int[])`;
}

/** Libera entregas que la red rechazo: esos trabajadores siguen sin vale. */
export async function liberarEntregas(programaId, periodo, beneficiarioIds) {
  const sql = db();
  await sql`
    DELETE FROM entregas
     WHERE programa_id = ${programaId} AND periodo = ${periodo}
       AND beneficiario_id = ANY(${beneficiarioIds}::int[])`;
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

/**
 * Reserva el siguiente id ANTES de insertar.
 *
 * La cuenta de Stellar se deriva de (sesion, rol, id), asi que hace falta el
 * id para calcular la clave publica, y la clave publica para insertar la
 * fila. Pidiendo el id a la secuencia se rompe esa dependencia circular sin
 * dejar filas a medio hacer.
 *
 * @param {'beneficiarios'|'comercios'} tabla
 */
export async function siguienteId(tabla) {
  if (tabla !== 'beneficiarios' && tabla !== 'comercios') {
    throw new TypeError(`Tabla invalida: ${tabla}`);
  }
  const sql = db();
  const filas = await sql.query(
    "SELECT nextval(pg_get_serial_sequence($1, 'id')) AS id", [tabla],
  );
  return Number(filas[0].id);
}

export async function crearBeneficiario({ id, sesion, nombre, cuentaPublica }) {
  const sql = db();
  const [fila] = await sql`
    INSERT INTO beneficiarios (id, sesion_id, nombre, cuenta_publica)
    VALUES (${id}, ${sesion}, ${nombre}, ${cuentaPublica})
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

export async function crearComercio({ id, sesion, nombre, distrito, telefono, rubro, cuentaPublica, codigoCorto }) {
  const sql = db();
  const [fila] = await sql`
    INSERT INTO comercios (id, sesion_id, nombre, distrito, telefono, rubro, cuenta_publica, codigo_corto)
    VALUES (${id}, ${sesion}, ${nombre}, ${distrito ?? null}, ${telefono ?? null},
            ${rubro ?? 'alimentos'}, ${cuentaPublica}, ${codigoCorto})
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

/**
 * Reserva un cobro antes de pagarlo. Devuelve false si ya estaba pagado.
 *
 * Se reserva ANTES de enviar el pago, no despues: dos toques seguidos al
 * boton llegarian a la vez, y comprobar despues ya seria tarde.
 */
export async function reclamarCobro(sesion, firma) {
  const sql = db();
  const filas = await sql`
    INSERT INTO cobros_usados (firma, sesion_id) VALUES (${firma}, ${sesion})
    ON CONFLICT (firma) DO NOTHING RETURNING firma`;
  return filas.length > 0;
}

/** Si un cobro ya se pago: para decirlo antes de pedir la confirmacion. */
export async function cobroYaUsado(firma) {
  const sql = db();
  const filas = await sql`SELECT 1 FROM cobros_usados WHERE firma = ${firma}`;
  return filas.length > 0;
}

/** Libera un cobro cuyo pago la red rechazo: no se movio dinero. */
export async function liberarCobro(firma) {
  const sql = db();
  await sql`DELETE FROM cobros_usados WHERE firma = ${firma}`;
}

// ---------------------------------------------------------------------------
// Codigos de pago del trabajador
// ---------------------------------------------------------------------------

/**
 * Guarda un codigo de pago nuevo y anula los anteriores sin usar del mismo
 * trabajador: solo vale el ultimo que genero. Si el codigo choca con otro
 * vigente del espacio devuelve null y se prueba con otro; uno vencido se
 * reutiliza.
 */
export async function crearCodigoPago(sesion, beneficiarioId, codigo, minutos) {
  const sql = db();
  await sql`
    DELETE FROM codigos_pago
     WHERE sesion_id = ${sesion} AND beneficiario_id = ${beneficiarioId} AND usado_en IS NULL`;
  const [fila] = await sql`
    INSERT INTO codigos_pago (sesion_id, codigo, beneficiario_id, expira_en)
    VALUES (${sesion}, ${codigo}, ${beneficiarioId}, now() + make_interval(mins => ${minutos}))
    ON CONFLICT (sesion_id, codigo) DO UPDATE
      SET beneficiario_id = EXCLUDED.beneficiario_id, expira_en = EXCLUDED.expira_en,
          usado_en = NULL, ultimo = NULL
      WHERE codigos_pago.expira_en < now()
    RETURNING *`;
  return fila ?? null;
}

/** Un codigo de pago vigente y sin usar, o null. */
export async function codigoPagoVigente(sesion, codigo) {
  const sql = db();
  const [fila] = await sql`
    SELECT * FROM codigos_pago
     WHERE sesion_id = ${sesion} AND codigo = ${codigo}
       AND usado_en IS NULL AND expira_en > now()`;
  return fila ?? null;
}

/** El codigo de un trabajador, este como este: para que su celular lo siga. */
export async function codigoPagoDe(sesion, beneficiarioId, codigo) {
  const sql = db();
  const [fila] = await sql`
    SELECT *, expira_en < now() AS vencido FROM codigos_pago
     WHERE sesion_id = ${sesion} AND codigo = ${codigo} AND beneficiario_id = ${beneficiarioId}`;
  return fila ?? null;
}

/**
 * Reserva un codigo antes de enviar el pago. Devuelve false si ya se uso o
 * vencio: dos cobros a la vez con el mismo codigo no pagan dos veces.
 */
export async function reclamarCodigoPago(sesion, codigo) {
  const sql = db();
  const filas = await sql`
    UPDATE codigos_pago SET usado_en = now()
     WHERE sesion_id = ${sesion} AND codigo = ${codigo}
       AND usado_en IS NULL AND expira_en > now()
    RETURNING codigo`;
  return filas.length > 0;
}

/**
 * Anota el resultado de un intento de cobro con el codigo. Si no se pago,
 * el codigo se libera: no se movio dinero y sigue sirviendo hasta vencer.
 */
export async function anotarIntentoCodigo(sesion, codigo, intento) {
  const sql = db();
  await sql`
    UPDATE codigos_pago
       SET ultimo = ${JSON.stringify(intento)}::jsonb,
           usado_en = CASE WHEN ${Boolean(intento.pagado)} THEN usado_en ELSE NULL END
     WHERE sesion_id = ${sesion} AND codigo = ${codigo}`;
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

/** Crea un usuario. Si el celular o el correo ya existen, lanza un error con code 23505. */
export async function crearUsuario({ sesion, rol, refId = null, identificador, hash, sal }) {
  const sql = db();
  const [fila] = await sql`
    INSERT INTO usuarios (sesion_id, rol, ref_id, identificador, hash, sal)
    VALUES (${sesion}, ${rol}, ${refId}, ${identificador}, ${hash}, ${sal})
    RETURNING *`;
  return fila;
}

export async function usuarioPorIdentificador(identificador) {
  const sql = db();
  const [fila] = await sql`SELECT * FROM usuarios WHERE identificador = ${identificador}`;
  return fila ?? null;
}

export async function usuarioPorId(id) {
  const sql = db();
  const [fila] = await sql`SELECT * FROM usuarios WHERE id = ${id}`;
  return fila ?? null;
}

/** El usuario de un trabajador o una tienda. */
export async function usuarioDe(sesion, rol, refId) {
  const sql = db();
  const [fila] = await sql`
    SELECT * FROM usuarios WHERE sesion_id = ${sesion} AND rol = ${rol} AND ref_id = ${refId}`;
  return fila ?? null;
}

/**
 * Anota un intento fallido. Al llegar al maximo, bloquea el acceso durante
 * un rato y reinicia la cuenta de intentos.
 */
export async function intentoFallido(id, maximos, minutos) {
  const sql = db();
  const [fila] = await sql`
    UPDATE usuarios
       SET intentos = CASE WHEN intentos + 1 >= ${maximos} THEN 0 ELSE intentos + 1 END,
           bloqueado_hasta = CASE WHEN intentos + 1 >= ${maximos}
                                  THEN now() + make_interval(mins => ${minutos})
                                  ELSE bloqueado_hasta END
     WHERE id = ${id}
    RETURNING intentos, bloqueado_hasta`;
  return fila;
}

export async function limpiarIntentos(id) {
  const sql = db();
  await sql`UPDATE usuarios SET intentos = 0, bloqueado_hasta = NULL WHERE id = ${id}`;
}

/** Cierra todas las sesiones del usuario, en todos los dispositivos. */
export async function subirVersion(id) {
  const sql = db();
  const [fila] = await sql`UPDATE usuarios SET version = version + 1 WHERE id = ${id} RETURNING *`;
  return fila;
}

/** Cambia el PIN o la contrasena. Cierra tambien todas las sesiones. */
export async function cambiarSecreto(id, hash, sal) {
  const sql = db();
  const [fila] = await sql`
    UPDATE usuarios
       SET hash = ${hash}, sal = ${sal}, version = version + 1,
           intentos = 0, bloqueado_hasta = NULL
     WHERE id = ${id}
    RETURNING *`;
  return fila;
}

// ---------------------------------------------------------------------------
// Trabajadores y tiendas con su acceso, para el panel de la empresa
// ---------------------------------------------------------------------------

export async function beneficiariosConAcceso(sesion) {
  const sql = db();
  return sql`
    SELECT b.*, u.identificador AS celular
      FROM beneficiarios b
      LEFT JOIN usuarios u ON u.sesion_id = b.sesion_id AND u.rol = 'beneficiario' AND u.ref_id = b.id
     WHERE b.sesion_id = ${sesion}
     ORDER BY b.id`;
}

export async function comerciosConAcceso(sesion) {
  const sql = db();
  return sql`
    SELECT c.*, u.identificador AS celular
      FROM comercios c
      LEFT JOIN usuarios u ON u.sesion_id = c.sesion_id AND u.rol = 'comercio' AND u.ref_id = c.id
     WHERE c.sesion_id = ${sesion}
     ORDER BY c.id`;
}

export async function marcarBaja(sesion, id) {
  const sql = db();
  const [fila] = await sql`
    UPDATE beneficiarios SET estado = 'baja' WHERE sesion_id = ${sesion} AND id = ${id} RETURNING *`;
  return fila ?? null;
}

export async function eventosDe(sesion, limite = 50) {
  const sql = db();
  return sql`
    SELECT * FROM eventos WHERE sesion_id = ${sesion}
     ORDER BY creado_en DESC, id DESC LIMIT ${limite}`;
}
