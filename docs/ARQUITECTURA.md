# Arquitectura de StellarRail

**Stellar Odyssey Perú** · Track 03: Real-World Assets & Compliant Rails
Documento de checkpoint · 22 de septiembre de 2026

StellarRail entrega vales de alimentación como un activo de Stellar. Las reglas del beneficio —quién puede tenerlo, dónde se puede gastar, cuándo caduca— no viven en nuestro servidor: son propiedades del activo y las hace cumplir la red.

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

El track pide controles de cumplimiento. La respuesta de StellarRail no es un campo `verificado` en una tabla: **la aprobación ejecuta la autorización en la red.**

1. El beneficiario abre la invitación de su empresa en su celular, escribe su nombre y su celular y elige un PIN. La API le crea una cuenta y su trustline hacia `ALIM`, y la guarda en `pendiente`.
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
| **De baja** | La empresa lo da de baja · congelar y anular en una transacción | Nada. Su tarjeta se anula y sus sesiones se cierran |

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

Ninguna tabla guarda saldos ni claves de cuentas. Además de las de abajo hay tablas auxiliares: `entregas` y `cobros_usados` (para no emitir ni cobrar dos veces) y `candados` (el turno del emisor).

```sql
-- El espacio de una empresa. Cada demostracion es un espacio propio, para
-- que dos visitantes no se pisen el recorrido.
CREATE TABLE sesiones (
  id          TEXT PRIMARY KEY,
  nombre      TEXT,
  es_demo     BOOLEAN NOT NULL DEFAULT false,
  creada_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Quien puede entrar: la empresa con correo, trabajador y tienda con
-- celular. El PIN o la contrasena, cifrados con scrypt y una sal propia.
CREATE TABLE usuarios (
  id              SERIAL PRIMARY KEY,
  sesion_id       TEXT REFERENCES sesiones(id),
  rol             TEXT NOT NULL,            -- empresa | beneficiario | comercio
  ref_id          INTEGER,                  -- el beneficiario o el comercio
  identificador   TEXT NOT NULL UNIQUE,     -- celular o correo
  hash            TEXT NOT NULL,
  sal             TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,  -- subirla cierra todas sus sesiones
  intentos        INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ
);

-- Tarjetas impresas de quien no tiene smartphone, y sus pagos del dia
-- para el tope de S/ 100.
CREATE TABLE tarjetas (
  numero          TEXT PRIMARY KEY,         -- SR-XXXX-XXXX
  sesion_id       TEXT REFERENCES sesiones(id),
  beneficiario_id INTEGER NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'activa'   -- activa | anulada
);
CREATE TABLE pagos_tarjeta (
  id              SERIAL PRIMARY KEY,
  numero          TEXT NOT NULL,
  beneficiario_id INTEGER NOT NULL,
  monto           NUMERIC(18,7) NOT NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
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
  estado          TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente|verificado|rechazado|baja
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

Siete funciones serverless, una por recurso. Las acciones viajan en el cuerpo de la petición:

| Petición | Qué hace | Quién |
|---|---|---|
| `GET /api/sesion` | Quién soy, o nadie | Todos |
| `POST /api/sesion` | `entrar` (celular + PIN o correo + contraseña), `salir`, `cerrarTodas`, `registrarEmpresa`, ver una invitación, `restablecer` el PIN | Según el caso |
| `POST /api/demo` | Crea la demostración: empresa, dos trabajadores y tres tiendas, con sus accesos | Cualquiera, hasta 30 por hora |
| `GET /api/beneficiarios` | La empresa ve a todos, con su celular y su tarjeta; un trabajador, solo a sí mismo | Empresa, trabajador |
| `POST /api/beneficiarios` | Registrarse con una invitación (nombre, celular y PIN): crea su cuenta y su trustline, en `pendiente` | Invitados, empresa |
| `POST /api/beneficiarios` `{accion}` | `verificar` (al aprobar **ejecuta `autorizar` en la red**), `baja`, `restablecer`, `tarjeta`, `anularTarjeta` | Empresa |
| `GET` y `POST /api/comercios` | Lo mismo para comercios, con su rubro y su código de 6 dígitos | Según el caso |
| `POST /api/comercios` `{accion:'cobrar'}` | La tienda genera un **cobro con monto**: firmado, caduca a los 10 minutos | Tienda |
| `GET /api/programas` | Programas del espacio, con sus rubros y su vencimiento | Todos |
| `POST /api/programas` | Crear, `entregar` o `vencer` | Empresa |
| `POST /api/pagos` | El trabajador paga un cobro con monto (`{cobro}`) o un QR fijo o código (`{codigo, monto}`), con PIN por encima de S/ 50. La tienda cobra con tarjeta (`{tarjeta, pin, monto}`) | Trabajador, tienda |
| `GET /api/eventos` | Historial con hash y enlace al explorador | Empresa |

**Por qué las acciones no van en la ruta.** Sin framework, Vercel convierte cada archivo de `api/` en una función, y el plan gratuito admite **12 por despliegue**. Con una ruta REST por acción se pasaría del límite, además de tener muchos paquetes distintos con el SDK de Stellar dentro. Agrupadas por recurso son 7.

**`POST /api/pagos` no comprueba si el comercio está afiliado.** Envía el pago y traduce lo que responda la red. Comprobarlo antes convertiría una regla del protocolo en una regla nuestra. Un pago no hecho responde `200` y no un error, y el campo `controlDe` dice quién lo frenó: `red`, con su hash y su código, o `aplicacion`, si el programa no cubre ese rubro, sin transacción. Las dos cosas no se confunden.

## 7. Decisiones y sus motivos

### El trabajador no necesita comprar criptomonedas

Toda cuenta de Stellar exige un depósito bloqueado de 1,5 XLM: 1 por la cuenta y 0,5 por la trustline. No es una comisión, es dinero inmovilizado mientras la cuenta exista. Es el mes de garantía de un alquiler.

Eso plantea la pregunta que decide la viabilidad: *¿una trabajadora tiene que comprar criptomonedas para cobrar su beneficio de alimentación?*

StellarRail usa **reservas patrocinadas**: el emisor paga el depósito de cada trabajador y de cada comercio. El saldo mínimo exigido a la beneficiaria es cero, y el emisor recupera lo que puso al terminar el programa. Verificado en testnet:

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

StellarRail lo resuelve en tres niveles:

1. Los envíos cuyo origen es el emisor se serializan con un *advisory lock* de Postgres. Los pagos de los beneficiarios no: cada uno tiene su propia cuenta y su propia secuencia.
2. Las operaciones se agrupan: las cuentas de una sesión se crean en una transacción (hasta 25), y vencer congela y anula en una sola (hasta 50 beneficiarios).
3. Si aun así hay choque, se reintenta con la secuencia al día.

A escala, el camino conocido son las *cuentas de canal*: varias cuentas que aportan secuencia y pagan comisión mientras el emisor sigue siendo el origen de las operaciones.

### Vencer es una sola transacción

Para anular hay que saber cuánto queda. Si se lee el saldo y luego se congela en otra transacción, el beneficiario puede gastar en el medio: el clawback pide más de lo que hay, falla, y la cuenta queda congelada **con** saldo. Un vale a medio vencer.

Congelar y anular juntas son atómicas: si el saldo cambió, falla la transacción entera y no se aplica nada. Se vuelve a leer y se reintenta. Comprobado provocando la carrera a propósito en testnet.

### Acceso según el riesgo

Cada quien entra con lo que corresponde a lo que puede mover:

| Quién | Cómo entra | Por qué |
|---|---|---|
| Empresa | Correo y contraseña | Maneja el dinero de todos |
| Trabajador y tienda | Celular y un PIN de 4 números | Es lo que alguien que no se maneja con la tecnología puede recordar |

El PIN y la contraseña se guardan cifrados con **scrypt** y una sal por usuario. Cinco intentos fallidos bloquean el acceso **15 minutos**; el contador es el mismo para entrar y para pagar, así que nadie prueba PIN por un camino cuando el otro ya lo bloqueó. Se rechazan 1234, 4321 y los dígitos repetidos, y nada más: cada regla extra es una traba para quien menos se maneja con el celular.

Al entrar se recibe una **credencial firmada con `MASTER_SEED`** que lleva el usuario y su *versión*. Subir la versión invalida todas sus credenciales: así funciona «cerrar sesión en todos mis dispositivos», y también cambiar el PIN o dar de baja.

**Sin SMS ni correos de verificación.** En su versión gratuita solo llegan al desarrollador, y el jurado no podría probarlos. Para un PIN olvidado, la empresa genera un **enlace de un solo uso**, válido 24 horas, y se lo pasa a la persona por WhatsApp o con un QR en Recursos Humanos. Guardar el PIN nuevo no inicia sesión: el enlace puede abrirse en el equipo de Recursos Humanos, con la cuenta de la empresa abierta, y no debe cambiarla. Por lo mismo, una invitación abierta con otra cuenta en el equipo avisa y ofrece salir primero.

La empresa invita con dos enlaces firmados, uno para trabajadores y otro para tiendas. Invitar no aprueba a nadie: el control sigue siendo la verificación, que se ejecuta en la red.

### La demostración

La entrada al sitio es el inicio de sesión, como en cualquier página con cuentas. Debajo, **Probar la demostración** crea un espacio nuevo con cinco personas, cuyas cuentas nacen en una sola transacción patrocinada, y muestra el correo, el celular y el PIN de cada una; «Usar» completa el formulario. Se entra con una, se sale y se entra con otra. Nada queda escondido en un archivo, y ningún visitante estropea la demostración de otro.

Cada pantalla es responsiva: en computadora, la tienda y el trabajador ven dos columnas; en celular, una.

### Sin smartphone

Quien no tiene smartphone recibe una **tarjeta impresa** con un QR y un número (`SR-XXXX-XXXX`). La tienda escribe el monto, escanea la tarjeta y el trabajador marca su PIN en el teclado de la tienda. La tarjeta sola no paga: siempre pide PIN, tiene un **tope de S/ 100 al día** y la empresa la puede anular. El tope se reserva antes de enviar, dentro de una transacción con un candado por trabajador, para que dos cobros simultáneos no lo salten.

Con smartphone, el PIN se pide solo por encima de S/ 50. Por debajo basta confirmar, como en Yape: el celular ya tiene la sesión abierta.

### Si el QR no se puede escanear

- **Subir una foto** del código, por ejemplo la que llegó por WhatsApp.
- **Pegar el enlace** del cobro.
- **Escribir** el código de 6 números de la tienda.
- La tienda puede **enviar el cobro por WhatsApp** con un enlace `wa.me`, que no necesita la API de WhatsApp Business ni ningún servicio de pago.

### Rubros: lo que la red ve y lo que no

La red sabe quién le paga a quién y cuánto. **No sabe qué se compró**: la canasta solo la ve el comercio. Ningún medio de pago lo resuelve solo; las tarjetas de alimentación actuales restringen por tipo de comercio, y en un supermercado separar la comida del resto depende del cajero.

StellarRail lo resuelve en capas, y dice con precisión quién garantiza cada una:

| Qué | Quién lo garantiza |
|---|---|
| Dónde se gasta: solo en comercios afiliados | **La red**, con `AUTH_REQUIRED` |
| Qué rubro declara el comercio en cada cobro | **La red lo registra**: viaja en el memo de la transacción, que es público |
| Que el programa cubra ese rubro | **La aplicación**, en este MVP. Hacerlo cumplir en la cadena exige Soroban |
| Sancionar a un comercio que declara en falso | **La red**: desafiliarlo le impide volver a cobrar |

El tipo de programa fija los rubros posibles. En la **prestación alimentaria** de la Ley 28051 solo cabe alimentos, porque la ley lo exige, y la empresa no puede cambiarlo. En un **bono o incentivo** la empresa elige.

### El QR, pensado para quien no se maneja bien con el celular

Muchos no saben que la cámara del celular lee códigos QR: quien usa Yape aprendió a escanear *dentro* de Yape. StellarRail hace lo mismo: el trabajador toca **Pagar con QR** y la app abre la cámara. Si no hay cámara o no hay permiso, se ofrece escribir el código de 6 números.

**Cobro con monto.** La tienda escribe cuánto cobra y muestra un QR; el trabajador escanea y **solo confirma**, sin escribir nada. El cobro viaja en el propio enlace, **firmado por el servidor**:

- el cliente no puede cambiar ni el monto ni el rubro: alterarlos rompe la firma;
- la tienda declara el rubro de **cada venta**, así que una bodega que también vende televisores puede cobrar una tele como electrodomésticos, y esa declaración termina en el memo público;
- caduca a los 10 minutos y se paga **una sola vez**: el servidor reserva la firma antes de enviar el pago, y la libera si la red lo rechaza.

El vencimiento lo decide solo el servidor. El celular cuenta hacia atrás desde que recibe el cobro, sin comparar relojes: si el de un celular va adelantado, daría por vencido un cobro que todavía vale.

**QR fijo.** Para imprimir y pegar en el mostrador, como los de Yape. El cliente escribe el monto.

**Cómo se generan.** En SVG, nítido a cualquier tamaño, con el margen de cuatro módulos que exige la norma y corrección de errores alta, porque un cartel se ensucia y se raya. Siempre negro sobre blanco, también en modo oscuro. Contienen un enlace web normal, así que también los abre la cámara nativa de cualquier celular.

**Aviso en vivo, también en voz alta.** Cuando le pagan, la tienda lo ve en grande y, si lo activa, el celular lo dice: *"Recibiste 18 soles con 50 céntimos"*. No tiene que mirar la pantalla mientras atiende.

### Entregar no duplica

Cada entrega se **reserva por trabajador antes de emitir**. Dos clics seguidos en "Entregar" no emiten dos veces el vale, y quien se verifica después de una entrega recibe el suyo en la siguiente. "Entregado" cuenta vales emitidos de verdad, cada uno con su hash; no es una estimación a partir de cuántos trabajadores hay verificados.

### Otras

| Decisión | Motivo |
|---|---|
| Cada visitante recibe sus propias cuentas | La URL es pública. Con un mundo compartido, el visitante anterior puede dejar el programa vencido y la demo muerta |
| El hash se calcula antes de enviar | Cuando una transacción falla, Horizon a veces no lo devuelve. Y un rechazo es evidencia |
| Un 504 no se trata como fallo | Horizon corta a los ~30 s pero la transacción puede entrar. Se consulta por el hash antes de reintentar; si no, se emitiría dos veces |
| Los montos son texto, nunca `number` | `0.1 + 0.2` no da `0.3` en JavaScript, y eso en un saldo es dinero mal puesto |
| Ni "Stellar" ni una clave en las vistas de beneficiario y comercio | Don Julio no debería necesitar entender la red para cobrar. Solo un enlace *ver comprobante* lleva al explorador |
| Un solo activo, `ALIM`, sin Soroban | Cabe en la semana y es verificable con transacciones clásicas |

---

## 8. Límites conocidos

| Límite | Cómo se resuelve |
|---|---|
| El clawback **destruye** el saldo; no lo devuelve al emisor | El emisor recupera su respaldo en soles, que deja de estar comprometido |
| El vencimiento no lo dispara la red | Lo ejecuta el emisor con un botón. Vercel Cron admite una ejecución diaria en el plan gratuito, suficiente para vencimientos por día |
| Stellar controla quién tiene el activo, no en qué se gasta | El comercio declara el rubro en el memo y la aplicación lo compara con el programa. Un contrato Soroban que valide rubro y vigencia es el siguiente paso |
| Verificación simulada | SEP-12 |
| Un beneficiario podría transferir a otro tenedor autorizado | Requiere Soroban o un esquema donde solo los comercios reciban |
| El emisor paga directo, sin cuenta distribuidora | En producción conviene separar ambos roles |
| Las reservas se recuperan cerrando la trustline y fusionando la cuenta | Revocar el patrocinio no sirve: traspasa la reserva al beneficiario, que no tiene XLM, y falla con `op_low_reserve`. Comprobado |
| Un solo programa vigente por empresa | Todos los vales son `ALIM` y los saldos de dos programas se mezclarían. La salida es un activo por programa |
| La empresa entra solo con contraseña | Segundo factor y doble aprobación de las entregas, fuera del alcance del MVP |

---

## 9. Estado

**Construido y verificado**

- `lib/riel/`: las operaciones completas, con el hash calculado antes de enviar, reintento ante choque de secuencia, resolución de 504 y traducción de 15 códigos de la red.
- `scripts/ciclo.js`: reproduce el ciclo entero con cuentas nuevas, 11 transacciones, y comprueba 12 afirmaciones contra Horizon. **No necesita configuración**: crea su propio emisor con Friendbot.
- `lib/cuentas.js` y `lib/db.js`: derivación de cuentas y esquema, probados contra la base real.
- `api/`: las siete funciones, probadas de punta a punta contra la base y la red: login, bloqueo, cierre de sesión en todos los dispositivos, PIN nuevo de un solo uso, pagos con PIN y con tarjeta, tope diario, baja y vencimiento.
- `src/`: portada, demostración y las tres vistas, responsivas, probadas en un navegador real en computadora y en celular, desde cero y con la demostración: aprobación, entrega, pago con QR, rechazo de la red, control de rubros, PIN sobre S/ 50, tarjeta con PIN, foto del QR, enlace pegado, WhatsApp, baja, PIN nuevo y vencimiento. Con estilo sobrio, a la espera del diseño definitivo.
- La aplicación desplegada recorrió el ciclo completo en producción: evidencias 9 a 18 de [EVIDENCIAS.md](../EVIDENCIAS.md).
- Nueve transacciones más del ciclo ejecutado a mano, evidencias 1 a 8.

**Pendiente**

- Vencimiento programado con Vercel Cron. El plan gratuito admite una ejecución diaria, suficiente para vencimientos por día; el botón del emisor ya cubre la demo.
- Un URI SEP-7 en el QR, que entienden las billeteras de Stellar, tendrá sentido el día que cada usuario tenga la suya. Hoy el QR lleva un enlace web, que abre la app o la cámara de cualquier celular.
- Diseño visual definitivo.

Para reproducir el ciclo desde cero, sin configurar nada:

```bash
npm install
npm run ciclo
```

Para levantar la interfaz y la API en local, contra la base de datos y la red de pruebas:

```bash
npm run dev
```
