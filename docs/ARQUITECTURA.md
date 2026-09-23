# Arquitectura de Rail

**Stellar Odyssey Perú** · Track 03: Real-World Assets & Compliant Rails
Documento de checkpoint · 22 de septiembre de 2026

Rail entrega vales de alimentación como un activo de Stellar. Las reglas del beneficio —quién puede tenerlo, dónde se puede gastar, cuándo caduca— no viven en nuestro servidor: son propiedades del activo y las hace cumplir la red.

Este documento describe cómo está construido y por qué. El recorrido del producto está en el [README](../README.md); las transacciones que lo respaldan, en [EVIDENCIAS.md](../EVIDENCIAS.md).

---

## 1. Las piezas

Un solo proyecto desplegado en Vercel, con tres capas y una fuente de verdad que no controlamos nosotros.

El navegador ejecuta las tres vistas. Cuando el usuario actúa —registrarse, aprobar, entregar, pagar, vencer— la vista llama a `api/`, que consulta en Neon quién es quién y delega en `lib/riel/` la construcción y firma de la transacción. El riel es el único que habla con Stellar.

Hay un camino que **no** pasa por el servidor: para el saldo y el gasto en vivo, el navegador lee Horizon directamente. Una función serverless no mantiene conexiones abiertas, y además así el saldo que ve el usuario viene de la misma fuente que puede auditar cualquiera.

`scripts/ciclo.js` usa el mismo riel sin pasar por la API ni por la base de datos: por eso puede reproducir el ciclo entero desde una terminal, sin desplegar nada.

| Capa | Tecnología | Responsabilidad |
|---|---|---|
| `src/` | Vue 3 + Vite | Tres vistas: emisor, beneficiario, comercio |
| `api/` | Funciones serverless (Node 22) | Firman y envían; registro y verificación |
| `lib/riel/` | `@stellar/stellar-sdk` 17 | Todas las operaciones de Stellar. Compartido por `api/` y `scripts/` |
| `lib/db.js` | Neon (PostgreSQL) | Programas, personas, comercios, estados y eventos |
| — | Stellar Testnet | Saldos, autorizaciones, historial |

### La regla que ordena todo

**El saldo vive en Stellar. La base de datos guarda solo lo que la red no sabe.**

La red conoce saldos, autorizaciones y el historial de transacciones. No conoce que la cuenta `GCKD…` es de María Quispe, ni que el programa vence el 30 de octubre. Eso es lo único que guarda Neon.

La consecuencia práctica: no existe un campo `saldo` en ninguna tabla. Cuando la interfaz muestra un saldo, lo acaba de leer de Horizon. Así no hay dos verdades que puedan discrepar, y el estado que ve el usuario es el mismo que puede auditar cualquiera.

---

## 2. La lógica principal: `lib/riel/`

Todas las operaciones de Stellar pasan por aquí. Se obtiene una instancia atada a una configuración:

```js
const riel = crearRiel({ emisorSecret: process.env.ISSUER_SECRET });
const r = await riel.pagar(maria, bodega, '18.50');
if (!r.ok) console.log(r.codigo, r.mensaje);   // op_not_authorized
```

### Dos decisiones de diseño

**El emisor sale siempre de la configuración, nunca de la cuenta que envía.** Un activo de Stellar se identifica por su código *y* su emisor. Al reproducir el ciclo a mano, el emisor se autocompletó con la cuenta equivocada y se creó un activo distinto con el mismo nombre; el síntoma fue un `op_no_trust` difícil de leer. Ahora el activo se construye una sola vez, dentro de la fábrica, y ninguna función lo arma por su cuenta.

**Un rechazo de la red es un resultado, no una excepción.** Las funciones devuelven `{ ok: true, hash, ledger }` o `{ ok: false, hash, codigo, significado, mensaje, enElLedger }`. Solo lanzan excepción los fallos de infraestructura. Que la red rechace un pago a un comercio no afiliado no es un error del programa: es el producto funcionando, y es lo que este proyecto quiere demostrar.

### Operaciones

| Función | Operación de Stellar | Quién firma |
|---|---|---|
| `configurarEmisor()` | `Set Options`, flags 1+2+8 | Emisor |
| `crearCuentasPatrocinadas(cuentas)` | Sándwich de patrocinio: crea cuentas y trustlines, reservas a cargo del emisor. Hasta 25 por transacción | Emisor y cada cuenta |
| `autorizar(cuenta)` · `autorizarVarias(cuentas)` | `Set Trust Line Flags`. **Es la verificación** | Emisor |
| `emitir(destino, monto)` · `emitirVarios(entregas)` | `Payment` desde el emisor: así nace el vale | Emisor |
| `pagar(origen, destino, monto)` | `Payment`. No valida si el destino está afiliado | Origen |
| `congelar(cuenta)` · `descongelar(cuenta)` | `Set Trust Line Flags` | Emisor |
| `anular(cuenta, monto)` | `Clawback` | Emisor |
| `vencer(cuenta, saldo)` · `vencerVarios(entradas)` | Congela y anula en una transacción atómica | Emisor |
| `consultarSaldo(cuenta)` · `consultarReservas(cuenta)` | Lectura en Horizon | — |

### El modelo en Stellar

**Activo:** `ALIM`, `credit_alphanum4`, 1 ALIM = S/ 1.

Tres flags sobre la cuenta emisora, valor combinado 11:

| Flag | Valor | Qué hace posible |
|---|---|---|
| `AUTH_REQUIRED` | 1 | Solo cuentas aprobadas por el emisor pueden tener el vale. **Esto es la afiliación** |
| `AUTH_REVOCABLE` | 2 | El emisor puede congelar una cuenta |
| `AUTH_CLAWBACK_ENABLED` | 8 | El emisor puede anular saldo. **Esto es el vencimiento** |

No se activa `AUTH_IMMUTABLE` (4), que dejaría estas reglas fijas para siempre.

No hay contrato inteligente. Las tres garantías son capacidades del protocolo, disponibles en un activo clásico.

---

## 3. Verificación: de un trámite a una regla de red

El track pide controles de cumplimiento. La respuesta de Rail no es un campo `verificado` en una tabla: **la aprobación ejecuta la autorización en la red.**

1. El beneficiario se registra con su nombre. La API le crea una cuenta y su trustline hacia `ALIM`, y la guarda en `pendiente`.
2. La trustline **nace sin autorizar**: la cuenta existe y pidió poder recibir el vale, pero todavía no puede. Tener el activo exige dos voluntades, la de la cuenta y la del emisor.
3. El emisor revisa su bandeja.
4. **Si aprueba**, la API ejecuta `autorizar(cuenta)` en la red. El estado pasa a `verificado` y se guarda el hash de esa transacción. Desde ese momento la cuenta puede recibir el vale.
5. **Si rechaza**, el estado pasa a `rechazado` y la cuenta simplemente nunca se autoriza. No hay nada que bloquear: la red no le deja tener el activo.

La diferencia con un sistema convencional: si alguien manipulara la base de datos para marcar a una cuenta como verificada, **seguiría sin poder recibir el vale**, porque quien lo impide es el protocolo. El control no depende de que nuestro código se comporte bien.

Un comercio rechazado no es un comercio al que le negamos el cobro: es un comercio al que la red le rechaza el pago.

En el MVP la verificación es **simulada**: no se procesan datos reales de identidad. El siguiente paso es SEP-12, el estándar de Stellar para intercambiar datos de KYC.

---

## 4. Ciclo de vida del vale

| Estado | Cómo se llega | Qué puede hacer |
|---|---|---|
| **Sin cuenta** | — | Nada |
| **Pendiente** | Se registra: cuenta y trustline creadas, sin autorizar | Nada todavía. Existe y ya pidió poder recibir |
| **Rechazado** | El emisor rechaza | Nada, nunca. La cuenta no se autoriza y la red le impide tener el vale |
| **Verificado** | El emisor aprueba · `Set Trust Line Flags` | Puede recibir |
| **Con saldo** | El emisor entrega · `Payment` | Puede pagar en comercios afiliados, tantas veces como quiera |
| **Congelado** | Vence el programa · `Set Trust Line Flags` | Conserva el saldo pero no puede moverlo |
| **Anulado** | `Clawback` | Saldo en cero. Fin del ciclo |

Los rechazos que hace cumplir la red, con el código que devuelve:

| Situación | Código | Qué significa |
|---|---|---|
| Pago a comercio no afiliado | `op_not_authorized` | El emisor nunca autorizó ese destino |
| Pago desde cuenta congelada | `op_src_not_authorized` | El programa venció |
| Destino sin trustline | `op_no_trust` | La cuenta ni siquiera pidió poder recibir |
| Saldo insuficiente | `op_underfunded` | |

Los dos primeros están reproducidos y verificados en testnet. Un rechazo a nivel de operación **queda registrado en el ledger y cobra comisión**, así que se comprueba con su hash igual que una operación exitosa.

---

## 5. Datos

Cuatro tablas. Ninguna guarda saldos ni claves secretas.

```sql
-- Aislamiento de la demo: cada visitante recibe sus propias cuentas,
-- para que dos personas no se pisen el recorrido.
CREATE TABLE sesiones (
  id          TEXT PRIMARY KEY,
  creada_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE programas (
  id          SERIAL PRIMARY KEY,
  sesion_id   TEXT REFERENCES sesiones(id),
  nombre      TEXT NOT NULL,
  monto       NUMERIC(18,7) NOT NULL,   -- por beneficiario, no es un saldo
  categoria   TEXT NOT NULL DEFAULT 'alimentacion',
  vence_el    DATE NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'vigente',   -- vigente | vencido
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE beneficiarios (
  id              SERIAL PRIMARY KEY,
  sesion_id       TEXT REFERENCES sesiones(id),
  nombre          TEXT NOT NULL,
  cuenta_publica  TEXT NOT NULL,        -- G... La secreta se deriva, no se guarda
  estado          TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente|verificado|rechazado
  hash_verificacion TEXT,               -- la transacción que lo autorizó
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE comercios (
  id              SERIAL PRIMARY KEY,
  sesion_id       TEXT REFERENCES sesiones(id),
  nombre          TEXT NOT NULL,
  distrito        TEXT,
  telefono        TEXT,
  cuenta_publica  TEXT NOT NULL,
  codigo_corto    TEXT NOT NULL,        -- 6 dígitos para cobrar sin QR
  estado          TEXT NOT NULL DEFAULT 'pendiente',
  hash_verificacion TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sesion_id, codigo_corto)
);

-- Espejo del ledger. El hash se guarda ANTES de enviar: si el envío se
-- corta a medias, la evidencia no se pierde.
CREATE TABLE eventos (
  id           SERIAL PRIMARY KEY,
  sesion_id    TEXT REFERENCES sesiones(id),
  tipo         TEXT NOT NULL,           -- autorizar | emitir | pagar | vencer...
  etiqueta     TEXT NOT NULL,
  hash         TEXT NOT NULL,
  ledger       BIGINT,
  exitosa      BOOLEAN,
  codigo_error TEXT,                    -- op_not_authorized, etc.
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Ninguna clave secreta se guarda.** Las cuentas de demo se derivan de una única variable de servidor: `HMAC(MASTER_SEED, "<sesión>:<rol>:<id>")`. Una filtración de la base de datos no compromete ninguna cuenta.

---

## 6. API

Siete funciones serverless, una por recurso. Las acciones viajan en el cuerpo de la peticion:

| Peticion | Que hace |
|---|---|
| `GET /api/sesion` | Devuelve la sesion del visitante, creandola si es su primera visita |
| `POST /api/entrar` | Abre el panel del emisor con la clave |
| `GET /api/beneficiarios` | Lista los de la sesion |
| `POST /api/beneficiarios` | Registra uno: crea su cuenta y su trustline, en `pendiente` |
| `POST /api/beneficiarios` `{accion:'verificar'}` | Aprueba, y al aprobar **ejecuta `autorizar` en la red**, o rechaza |
| `GET` y `POST /api/comercios` | Lo mismo para comercios, mas su codigo de 6 digitos |
| `GET /api/programas` | Lista los programas |
| `POST /api/programas` | Crea uno |
| `POST /api/programas` `{accion:'entregar'}` | Emite a los beneficiarios verificados |
| `POST /api/programas` `{accion:'vencer'}` | Congela y anula |
| `POST /api/pagos` | El beneficiario paga a un comercio, por QR o codigo corto |
| `GET /api/eventos` | Historial con hash y enlace al explorador |

**Por que las acciones no van en la ruta.** Sin framework, Vercel convierte cada archivo de `api/` en una funcion, y el plan gratuito admite **12 por despliegue**. Con una ruta REST por accion serian 11, mas la del vencimiento programado: justo en el limite y sin margen, ademas de once paquetes distintos con el SDK de Stellar dentro. Agrupadas por recurso son 7, con cinco de reserva.

**Las rutas del emisor exigen autenticacion.** La URL es publica; sin puerta, cualquiera podria aprobar beneficiarios o vencer el programa y dejar la demo inservible. La clave esta en el README para que el jurado pueda entrar: es testnet y no protege nada de valor.

**`POST /api/pagos` no comprueba si el comercio esta afiliado.** Envia el pago y traduce lo que responda la red. Comprobarlo antes convertiria una regla del protocolo en una regla nuestra, que es lo contrario de lo que propone el proyecto. Por eso un rechazo responde `200` y no un error: no es un fallo, es el resultado, y llega con su hash y su enlace al explorador.

## 7. Decisiones y sus motivos

### El trabajador no necesita comprar criptomonedas

Toda cuenta de Stellar exige un depósito bloqueado de 1,5 XLM: 1 por la cuenta y 0,5 por la trustline. No es una comisión, es dinero inmovilizado mientras la cuenta exista. Es el mes de garantía de un alquiler.

Eso plantea la pregunta que decide la viabilidad: *¿una trabajadora tiene que comprar criptomonedas para cobrar su beneficio de alimentación?*

Rail usa **reservas patrocinadas**: el emisor paga el depósito de cada trabajador y de cada comercio. El saldo mínimo exigido a la beneficiaria es cero, y el emisor recupera lo que puso al terminar el programa. Verificado en testnet:

```
Cuenta de la beneficiaria
  ALIM              50.0000000
  XLM                0.1000000   ← íntegramente gastable
  mínimo exigido     0           ← (2 + 1 + 0 − 3) × 0,5
  reservas a cargo de  la cuenta del emisor
```

El patrocinio cubre reservas, no comisiones; por eso cada cuenta nace con 0,1 XLM, que con mínimo cero alcanza para unos mil pagos. Cubrir también las comisiones con *fee bump* es un paso posterior: complicaría la evidencia al generar dos hashes por transacción.

### Custodia, declarada

El backend guarda las claves de las cuentas de demo y firma por ellas. Es una decisión del MVP y está declarada: sin ella, don Julio tendría que instalar una billetera y custodiar una frase de recuperación para cobrar S/ 18.

Lo verificable no es la custodia: es que las reglas son públicas y las hace cumplir la red. En producción, cada usuario tendría su propia billetera y la arquitectura no cambiaría, porque cada canal de pago es solo una interfaz sobre las mismas operaciones.

### El emisor es un punto de serialización

Una cuenta de Stellar consume **una sola secuencia por ledger** (~5 s), y el emisor firma casi todo: autorizar, emitir, congelar, anular. Dos peticiones simultáneas producen `tx_bad_seq`.

Rail lo resuelve en tres niveles:

1. Los envíos cuyo origen es el emisor se serializan con un *advisory lock* de Postgres. Los pagos de los beneficiarios no: cada uno tiene su propia cuenta y su propia secuencia.
2. Las operaciones se agrupan: las cuentas de una sesión se crean en una transacción (hasta 25), y vencer congela y anula en una sola (hasta 50 beneficiarios).
3. Si aun así hay choque, se reintenta con la secuencia al día.

A escala, el camino conocido son las *cuentas de canal*: varias cuentas que aportan secuencia y pagan comisión mientras el emisor sigue siendo el origen de las operaciones.

### Vencer es una sola transacción

Para anular hay que saber cuánto queda. Si se lee el saldo y luego se congela en otra transacción, el beneficiario puede gastar en el medio: el clawback pide más de lo que hay, falla, y la cuenta queda congelada **con** saldo. Un vale a medio vencer.

Congelar y anular juntas son atómicas: si el saldo cambió, falla la transacción entera y no se aplica nada. Se vuelve a leer y se reintenta. Comprobado provocando la carrera a propósito en testnet.

### Otras

| Decisión | Motivo |
|---|---|
| Cada visitante recibe sus propias cuentas | La URL es pública. Con un mundo compartido, el visitante anterior puede dejar el programa vencido y la demo muerta |
| El hash se calcula antes de enviar | Cuando una transacción falla, Horizon a veces no lo devuelve. Y un rechazo es evidencia |
| Un 504 no se trata como fallo | Horizon corta a los ~30 s pero la transacción puede entrar. Se consulta por el hash antes de reintentar; si no, se emitiría dos veces |
| Los montos son texto, nunca `number` | `0.1 + 0.2` no da `0.3` en JavaScript, y eso en un saldo es dinero mal puesto |
| Ni "Stellar" ni una clave en las vistas de beneficiario y comercio | Don Julio no debería necesitar entender la red para cobrar. Solo un enlace *ver comprobante* lleva al explorador |
| Un activo por categoría, sin Soroban | Cabe en la semana y es verificable con transacciones clásicas |

---

## 8. Límites conocidos

| Límite | Cómo se resuelve |
|---|---|
| El clawback **destruye** el saldo; no lo devuelve al emisor | El emisor recupera su respaldo en soles, que deja de estar comprometido |
| El vencimiento no lo dispara la red | Lo ejecuta el emisor con un botón. Vercel Cron admite una ejecución diaria en el plan gratuito, suficiente para vencimientos por día |
| Stellar controla quién tiene el activo, no en qué se gasta | Un activo por categoría. Un contrato Soroban que valide rubro y vigencia es el siguiente paso |
| Verificación simulada | SEP-12 |
| Un beneficiario podría transferir a otro tenedor autorizado | Requiere Soroban o un esquema donde solo los comercios reciban |
| El emisor paga directo, sin cuenta distribuidora | En producción conviene separar ambos roles |
| Las reservas se recuperan cerrando la trustline y fusionando la cuenta | Revocar el patrocinio no sirve: traspasa la reserva al beneficiario, que no tiene XLM, y falla con `op_low_reserve`. Comprobado |

---

## 9. Estado al 22 de septiembre

**Construido y verificado en testnet**

- `lib/riel/`: las operaciones completas, con hash previo al envío, reintento ante choque de secuencia, resolución de 504 y traducción de 15 códigos de la red.
- `scripts/ciclo.js`: reproduce el ciclo entero con cuentas nuevas, 11 transacciones, y comprueba 12 afirmaciones contra Horizon. Devuelve código distinto de cero si algo no cuadra. **No necesita configuración**: crea su propio emisor con Friendbot.
- Reservas patrocinadas, vencimiento atómico y creación de cuentas en lote, cada uno probado contra la red.
- Nueve transacciones del ciclo ejecutado a mano, en [EVIDENCIAS.md](../EVIDENCIAS.md).

**En construcción**

- `api/`: los endpoints de la sección 6.
- `src/`: las tres vistas. La interfaz está sin decidir.
- Neon: el esquema de la sección 5.

Para reproducir el ciclo completo:

```bash
npm install
npm run ciclo
```
