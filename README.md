# StellarRail — vales programables sobre Stellar

**Stellar Odyssey Perú** · Track 03: Real-World Assets & Compliant Rails


**Ayudamos a las empresas a entregar beneficios con reglas verificables, que el trabajador puede gastar en la bodega de su barrio con un QR, sin depender de una red cerrada de tarjetas.**

---

## El usuario

**María, 34 años, trabaja en planilla en una empresa mediana de Lima.** Su empresa le da un beneficio de alimentación. Compra casi todo en la bodega de su cuadra, donde paga con Yape. Su tarjeta de alimentación solo sirve donde hay un POS que acepte tarjeta.

**Don Julio, bodeguero.** Cobra la mayoría de sus ventas por QR desde el celular. Tickets pequeños, márgenes pequeños: cada comisión cuenta.

**La empresa.** Quiere dar el beneficio, controlar en qué se usa y ver el gasto sin pedir reportes.

## El problema

Hoy el beneficio de alimentación lo operan administradoras con tarjetas sobre la red Visa. Funciona, pero tiene dos límites:

1. **El canal de cobro no coincide con el de la bodega.** Yape y Plin se han vuelto el principal medio de pago en las bodegas de Lima, y nueve de cada diez bodegueros dicen que su uso aumentó este año. Una tarjeta de alimentación llega a la bodega solo si esta tiene un POS de tarjeta, con sus comisiones, sobre tickets que en la mayoría de los casos van de S/11 a S/35.
2. **Las reglas viven en la base de datos del administrador.** El trabajador no puede verificar las reglas de su beneficio, el comercio no puede verificar que un cobro es válido, y la empresa depende de los reportes del proveedor.

Falta una forma de entregar dinero restringido donde las reglas se cumplan solas, las verifique cualquiera, y el cobro funcione como el QR que la bodega ya usa.

## La solución

Un vale digital emitido como activo en Stellar, con las reglas dentro del activo:

1. **Verificación:** el beneficiario y el comercio se registran; el emisor los verifica y, al aprobarlos, los autoriza en la red.
2. **Entrega:** la empresa elige a qué trabajadores verificados les entrega el vale. La prestación alimentaria se recarga cada mes y lo no usado se acumula.
3. **Pago:** la bodega escribe cuánto cobra y el trabajador paga de una de dos formas: escanea el QR de la bodega y confirma, o le dicta su código de pago, que vale 5 minutos y sirve para un solo pago. Nunca escribe un monto. Si el comercio no está autorizado, **la red rechaza el pago**.
4. **Vencimiento:** en la fecha que fija la empresa, el emisor congela el saldo y anula lo que no se usó. Ese dinero no se pierde para la empresa: su respaldo en soles deja de estar comprometido.

Todo queda registrado en un libro público: cualquiera puede comprobar cada paso con un enlace.

## ¿Por qué no basta una base de datos?

Si sacamos Stellar, el sistema funciona igual en apariencia, pero cambia quién garantiza las reglas:

| | Con una base de datos | Con Stellar |
|---|---|---|
| Quién hace cumplir las reglas | El operador del sistema | La red |
| Quién puede verificarlas | Solo el operador | Cualquiera, con el hash |
| Si el operador se equivoca o cambia algo | Nadie se entera | Queda registrado y es público |
| Un emisor nuevo con otras reglas | Otro proveedor u otra integración | Otro activo en la misma red |

Sin Stellar, las reglas son una promesa del operador. Con Stellar, son una propiedad del activo.

## Por qué Stellar

Las garantías que necesitamos existen a nivel de protocolo, en el propio activo, sin contrato a medida:

| Necesidad | Característica de Stellar |
|---|---|
| Solo cuentas verificadas pueden tener el vale | `AUTH_REQUIRED` + `Set Trust Line Flags` |
| El emisor puede suspender una cuenta | `AUTH_REVOCABLE` y `AUTHORIZED_TO_MAINTAIN_LIABILITIES` |
| El emisor puede anular saldo al vencer | `AUTH_CLAWBACK_ENABLED` y la operación `Clawback` |
| Pagos de pocos soles | Comisión de red de 0.00001 XLM por transacción |
| Cobro en caja sin esperar | Confirmación en segundos |

## Controles de compliance (track 03)

| Control que pide el track | Cómo lo resolvemos |
|---|---|
| Verificación de identidad | El beneficiario y el comercio pasan por una verificación antes de poder recibir el vale. **La aprobación ejecuta la autorización en la red**: sin verificación, la cuenta no puede tener el activo. En el MVP la verificación es simulada, sin datos reales de identidad. |
| Registro de quién es dueño de qué | Los saldos, autorizaciones, pagos y anulaciones están en el ledger público de Stellar. |
| Restricción de uso | Solo comercios autorizados pueden recibir el vale. Un vale congelado no se puede gastar. |

Siguiente paso: integrar el estándar de Stellar para KYC (**SEP-12**), que permite a los clientes enviar su información de identidad a un servicio de verificación de forma estándar e interoperable.

## Marco legal en Perú

La **Ley 28051** de prestaciones alimentarias y su reglamento (D.S. 013-2003-TR) permiten que una empresa entregue alimentación a sus trabajadores mediante empresas administradoras que emiten vales, cupones o documentos análogos. Puntos relevantes:

- El beneficio se entrega para la **adquisición exclusiva de alimentos en establecimientos afiliados**. Es exactamente la restricción que el vale hace cumplir en la red.
- Se prohíbe otorgar la prestación en dinero. Un vale restringido, no dinero libre, es la forma que la ley contempla.
- El valor de la prestación no se computa como remuneración.
- Las **bodegas** figuran expresamente entre los proveedores de alimentos en crudo.
- Las administradoras deben inscribirse en un registro del Ministerio de Trabajo y cumplir requisitos, entre ellos un capital mínimo de 300 UIT.

Aclaración: el vencimiento no es un requisito de la ley. Es una regla que el emisor define en su programa, como hacen las administradoras: en Pluxee Perú, la empresa puede fijar plazos de uso del saldo; las tarjetas recargables acumulan lo no usado mes a mes, y en las de una sola recarga, pasada la fecha, el saldo "no podrá recuperarse". Quien deja la empresa puede seguir usando su saldo mientras la tarjeta esté vigente. StellarRail sigue ese modelo: lo no usado se acumula durante el programa, al vencer se anula, y quien se da de baja conserva lo suyo hasta el vencimiento.

Por la misma razón, en un programa de **prestación alimentaria** la empresa no elige en qué se gasta: la aplicación fija el rubro en alimentos. En un **bono o incentivo**, que no está sujeto a esta ley, la empresa sí elige los rubros.

## Competencia

| | Tarjetas de alimentación (Pluxee, Edenred) | Este proyecto |
|---|---|---|
| Canal de cobro | Tarjeta, en comercios con POS | QR desde el celular |
| Dónde viven las reglas | Base de datos del administrador | En el activo, sobre la red |
| Verificación por terceros | No | Sí, con el hash |
| Costo por transacción de red | Comisiones del medio de pago con tarjeta | 0.00001 XLM |
| Madurez | Operación nacional, cientos de miles de comercios | Prototipo en testnet |

Las administradoras existentes prueban que el mercado existe y paga. Nuestro diferencial no es reemplazarlas en todo, sino llegar al canal que la bodega ya usa y hacer las reglas verificables.

## Modelo de negocio y camino a producción

- **B2B:** cobro a la empresa emisora por programa o por beneficiario activo. El trabajador y la bodega no pagan comisión, coherente con la propuesta de valor.
- **Etapa 1, sin registro especial:** casos que no son prestación alimentaria: viáticos corporativos, incentivos, ayuda humanitaria con uso restringido.
- **Etapa 2:** licenciar la tecnología a una administradora ya registrada ante el Ministerio de Trabajo, o registrarse, lo que exige cumplir los requisitos de capital.
- **Financiamiento del ecosistema:** Instawards y Stellar Community Fund.

## Arquitectura

| Pieza | Tecnología | Responsabilidad |
|---|---|---|
| Frontend | Vue 3 + Vite | Vistas de emisor, beneficiario y comercio |
| API | Funciones serverless de Vercel (Node) | Firmar y enviar transacciones; registro, acceso y verificación |
| Riel | SDK de JavaScript de Stellar | Emisión, autorización, pago, congelado, anulación |
| Datos | Neon (PostgreSQL) | Programas, comercios, beneficiarios, accesos (PIN cifrado con scrypt), códigos de pago y eventos. **Nunca saldos ni claves de cuentas** |
| Red | Stellar Testnet vía Horizon | Fuente de verdad de saldos y autorizaciones |

**Decisión del MVP:** el backend custodia las claves de las cuentas de demo y firma por ellas. Lo verificable no es la custodia, sino que las reglas son públicas y las hace cumplir la red. En producción, cada usuario tendría su propia billetera.

## Construido durante la ventana del evento

Proyecto nuevo, iniciado el 19 de septiembre de 2026. No parte de código previo.

- **Riel de Stellar** (`lib/riel/`): emisión, autorización, pago, congelado y anulación. Reservas patrocinadas por el emisor, vencimiento en una sola transacción atómica, hash calculado antes de enviar, recuperación ante cortes de Horizon y ante choques de secuencia.
- **Script del ciclo completo** (`npm run ciclo`): reproduce las evidencias con cuentas nuevas y comprueba el estado final contra Horizon.
- **API** en funciones serverless de Vercel, con base de datos en Neon que nunca guarda saldos ni claves.
- **Aplicación web** con tres perfiles: empresa, trabajador y comercio.
- **Demostración en un clic**: crea una empresa de prueba con dos trabajadores y tres tiendas, en una sola transacción, y muestra el celular y el PIN de cada uno.
- **Diseño responsivo**: cada pantalla tiene su versión de computadora y de celular.
- **Acceso según el riesgo**: la empresa entra con correo y contraseña; trabajador y tienda, con su celular y un PIN de 4 números. PIN cifrado con scrypt, bloqueo de 15 minutos tras 5 intentos fallidos y cierre de sesión en todos los dispositivos. La empresa invita por enlace o QR.
- **Registro en persona**: la empresa puede registrar a un trabajador en Recursos Humanos; la persona escribe su PIN en ese equipo.
- **Gestión**: dar de baja a un trabajador (no recibe más vales y conserva lo suyo hasta el vencimiento, como en las tarjetas de beneficios) y restablecer su PIN con un enlace de un solo uso, sin SMS.
- **Al entrar, el trabajador ve con qué y dónde pagar**: su vale con el saldo leído de la red, las dos formas de pago, las tiendas donde sirve y sus movimientos con comprobante.
- **Dos formas de cobrar, y el trabajador nunca escribe un monto**. Con QR: la tienda escribe el monto y muestra un QR firmado por el servidor, que caduca a los 10 minutos y se paga una sola vez; el trabajador lo escanea, ve a quién le paga y cuánto, y confirma, con PIN por encima de S/ 50. Con código: como el código de aprobación de Yape, el trabajador genera con su PIN un código de 6 números que vale 5 minutos y sirve para un solo pago, y se lo dicta a la tienda; su celular muestra el pago, o por qué no pasó, al instante.
- **Aviso en vivo** a la bodega cuando le pagan, en pantalla y en voz alta ("Recibiste 18 soles con 50 céntimos").
- **Entregas a quien la empresa elija**: un bono puede ser solo para algunos trabajadores. La prestación alimentaria se recarga una vez por mes. Dos clics en "Entregar" no emiten dos veces el vale.
- **Rubros por programa**: cada tienda tiene un rubro fijo desde que la afilian, que viaja en el memo de cada transacción. Que el programa lo cubra lo comprueba la aplicación.
- **Evidencias 9 a 18**: el ciclo completo ejecutado por la aplicación desplegada.

## Estado actual

El ciclo completo del vale está **ejecutado y verificable en Stellar Testnet** de tres formas: a mano en Stellar Lab (evidencias 1 a 8), con un script que cualquiera puede correr, y desde la aplicación desplegada (evidencias 9 a 18).

## Actores

| Rol | Clave pública |
|---|---|
| EMISOR (la empresa) | `GAUSPC2LMUGK54YV2I73RMIZG7C5DJKEDLQ7GWINUTXRPGXKHOW7T5JO` |
| TRABAJADOR (beneficiario) | `GCKDE6R2AZJXEIGPEUQDVWXKX3VSMBQLVQK4E6OCZSPWZ2TWSYWVFCA7` |
| BODEGA_A (comercio autorizado) | `GCS34UPGF3C7C4NT5MCXUKGEH6BN4ZD5VPKY4ILHVVJYHVEU42LULIHH` |
| BODEGA_B (comercio no autorizado) | `GCQPZQM3Q7AHWR4Z2ZGA2EAR4OLGAXAQXYLBX4AGW4AUHW75CIRNUWV7` |

**Activo:** `ALIM` (alimentación), emitido por EMISOR. Red: Stellar Testnet.

## Evidencias en testnet

Detalle de cada una (qué hace, por qué importa, cómo verificarla) en [`EVIDENCIAS.md`](./EVIDENCIAS.md).

| # | Qué demuestra | Operación | Ledger | Transacción |
|---|---|---|---|---|
| 1 | El emisor queda con reglas de control | `Set Options` | 4777915 | [`cc8720b1…fed4`](https://stellar.expert/explorer/testnet/tx/cc8720b10dfe15bb7e900bc2dcf7f62871dc4060fc2baa21ac995b5ffa59fed4) |
| 2 | Las tres cuentas piden poder tener el vale (nacen sin autorizar) | `Change Trust` ×3 | 4778106 · 4778182 · 4778201 | [TRABAJADOR](https://stellar.expert/explorer/testnet/tx/b4c49a2d5ea17370524a2ddb32dbb533b1b7e264c03cbe19aa8581327cccfe31) · [BODEGA_A](https://stellar.expert/explorer/testnet/tx/2bcf74c7f25211a177061bf2ac615717ea6a2b4598f17bc4ea72ecfc512705ee) · [BODEGA_B](https://stellar.expert/explorer/testnet/tx/3a5bd17ca5d14beeb689f130cee8584e43ef4ab681a6b4579a7ae058f608b160) |
| 3 | El emisor autoriza a TRABAJADOR y BODEGA_A (BODEGA_B queda sin autorizar) | `Set Trust Line Flags` ×2 | 4778493 | [`7ffe4b8c…36ec`](https://stellar.expert/explorer/testnet/tx/7ffe4b8c9117b10ba94cc898f1daeb8d521728214886590c4ba11578bba936ec) |
| 4 | Nace el vale: el emisor entrega 10 `ALIM` | `Payment` | 4779421 | [`0edf301e…8cb3`](https://stellar.expert/explorer/testnet/tx/0edf301eda1a3da072ec5300f00d01d5968786a95d9129c66a2244ea51ce8cb3) |
| 5 | **Pago aceptado** en comercio autorizado (3 `ALIM`) | `Payment` | 4779548 | [`03b7a7a7…9ca9`](https://stellar.expert/explorer/testnet/tx/03b7a7a73ceb9a80931ecde1bd97679de19faae43430597dd1ec86dccaa49ca9) |
| 6 | **Pago rechazado** en comercio no autorizado: `op_not_authorized` | `Payment` (falla) | 4779583 | [`a2a93ef5…8a4b`](https://stellar.expert/explorer/testnet/tx/a2a93ef51e1c1fcba4832655b8f53af1abb31c0e213eb001de01d15b68ee8a4b) |
| 7 | El emisor congela la cuenta del trabajador | `Set Trust Line Flags` | 4779692 | [`60269446…3181`](https://stellar.expert/explorer/testnet/tx/6026944617492a57465ac9ecd9d667d9d8c4b579a56d895424a5e4539b7f3181) |
| 7b | **Pago bloqueado** con la cuenta congelada: `op_src_not_authorized` | `Payment` (falla) | 4779763 | [`8029708f…fcf3`](https://stellar.expert/explorer/testnet/tx/8029708fdd60b8ecc1b50c622ff68d69ba2b497c04b8e48c1b6c09ae8aa3fcf3) |
| 8 | **Vencimiento:** el emisor anula los 7 `ALIM` no gastados | `Clawback` | 4779939 | [`1d75e34f…9044`](https://stellar.expert/explorer/testnet/tx/1d75e34f0f963d5fc436b693f2634a09e8b85b0730c57319546cbfe288289044) |

Las filas 6 y 7b son rechazos hechos cumplir por la red: el pago estaba bien firmado y la cuenta tenía saldo, pero el protocolo lo impidió. Ambas están en el ledger con `successful: false` y cobraron su comisión de 100 stroops, así que el rechazo se comprueba igual que una operación exitosa: con el hash, en el explorador público.

## Verificación del estado final

Estado de TRABAJADOR según Horizon, después del ciclo completo:

| Campo | Valor |
|---|---|
| Saldo `ALIM` | `0.0000000` |
| `is_authorized` | `false` |
| `is_authorized_to_maintain_liabilities` | `true` |
| `is_clawback_enabled` | `true` |

Consulta pública: <https://horizon-testnet.stellar.org/accounts/GCKDE6R2AZJXEIGPEUQDVWXKX3VSMBQLVQK4E6OCZSPWZ2TWSYWVFCA7>

BODEGA_A debe mostrar `3.0000000` de `ALIM`, y BODEGA_B `0.0000000` con `is_authorized: false`.

## Cómo ejecutarlo

### En línea, sin instalar nada

Abre <https://stellar-rail.vercel.app>: como cualquier página con cuentas, empieza pidiendo entrar o crear la cuenta de la empresa. Debajo del formulario, toca **Probar la demostración**: se crea una empresa de prueba solo para ti, con cinco cuentas, y aparecen el correo, el celular y el PIN de cada una. **Usar** completa el formulario y entras con **Entrar**. No hace falta celular ni ninguna credencial guardada en otro lado.

Para cambiar de persona, sales y entras con otra.

| Persona | Qué representa |
|---|---|
| María | Trabajadora: paga escaneando el QR de la tienda o dictando su código |
| Rosa | Trabajadora: se da de baja y conserva su saldo |
| Bodega Don Julio | Tienda para afiliar |
| Minimarket La Esquina | Tienda que **no** se afilia: la red rechaza sus pagos |
| Electro Hogar | Tienda de electrodomésticos: el vale de alimentos no la cubre |

1. **Empresa:** aprueba a María, a Rosa, a Don Julio y a Electro Hogar; deja a La Esquina sin aprobar. Cada aprobación es una transacción en la red, con su comprobante. Luego crea el programa, elige a quién entregar y entrega la recarga del mes.
2. **María** entra: ve su vale, cómo pagar y dónde usarlo.
3. **Don Julio** escribe el monto y toca **Mostrar QR**. María, en su celular, lo escanea y confirma. Don Julio ve «Te pagaron» al instante.
4. **María** toca **Mostrar mi código** y marca su PIN. **Don Julio** toca **Cobrar con su código**, escribe el monto y el código, y cobra. En una sola ventana: anota el código de María, sal y entra como Don Julio; vale 5 minutos.
5. **La Esquina** cobra con el código de María: **lo rechaza la red** (`op_not_authorized`), con su comprobante. El celular de María lo muestra.
6. **Electro Hogar** cobra: el programa de alimentos no cubre electrodomésticos. Esta regla la aplica la aplicación, no la red.
7. **Empresa:** da de baja a Rosa, que conserva su saldo; mira el gasto y el historial, y vence el programa: lo no usado se anula y la empresa ve cuánto era.

Con dos dispositivos se ve también el aviso en vivo: la tienda recibe «Te pagaron» sin recargar, y el celular de la trabajadora ve el cobro con su código. Una empresa de verdad se registra con **Crear cuenta de empresa** e invita a sus trabajadores y tiendas por enlace o QR.

### El ciclo completo desde la terminal

No necesita configuración: crea su propio emisor con Friendbot. Requiere Node 22.12 o superior.

```bash
npm install
npm run ciclo
```

### La aplicación en local

Crea un archivo `.env` en la raíz con estas tres variables. Nunca se sube: está en `.gitignore`.

| Variable | Qué es |
|---|---|
| `ISSUER_SECRET` | Clave secreta de la cuenta emisora, en testnet |
| `MASTER_SEED` | 64 caracteres hexadecimales al azar: `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` |
| `DATABASE_URL` | Cadena de conexión de una base PostgreSQL en Neon |

La red, Horizon y el código del activo ya vienen configurados para testnet.

```bash
npm run dev    # interfaz y API juntas en http://localhost:5173
npm test       # pruebas unitarias
```

`npm run dev` ejecuta las mismas funciones que Vercel, contra la base de datos y la red de pruebas reales.

### A mano, en Stellar Lab

En [Stellar Lab](https://lab.stellar.org), red Testnet:

1. Crear y fondear cuatro cuentas con Friendbot.
2. En EMISOR: `Set Options` con `AUTH_REQUIRED`, `AUTH_REVOCABLE` y `AUTH_CLAWBACK_ENABLED`, antes de crear trustlines.
3. En las otras tres: `Change Trust` hacia `ALIM` del EMISOR.
4. En EMISOR: `Set Trust Line Flags` para autorizar a TRABAJADOR y BODEGA_A.
5. EMISOR paga 10 `ALIM` a TRABAJADOR.
6. TRABAJADOR paga a BODEGA_A (funciona) y a BODEGA_B (falla).
7. EMISOR congela a TRABAJADOR y ejecuta `Clawback` por el saldo restante.

## Limitaciones

- **El clawback destruye el saldo.** No lo devuelve como tokens al emisor; el emisor recupera su respaldo en soles, que deja de estar comprometido.
- **El vencimiento no lo dispara la red.** Stellar no ejecuta tareas programadas. En el MVP lo ejecuta el emisor con un botón.
- **El trabajador necesita un celular con internet** para pagar: con él escanea el QR o genera su código.
- **La red no ve qué se compra.** Stellar controla quién puede tener el vale y dónde se gasta, no el producto: la canasta solo la ve el comercio. Es igual con las tarjetas de alimentación: restringen por tipo de comercio, y que en caja se cobren solo alimentos es responsabilidad del comercio afiliado. Aquí cada tienda tiene **un rubro fijo, asignado al afiliarla**, que viaja en el memo de cada transacción, que es público. Que un programa cubra o no ese rubro **lo comprueba la aplicación** en este MVP; hacerlo cumplir en la cadena requiere un contrato Soroban. Si una tienda cobra lo que no debe, la sanción, desafiliarla, sí la hace cumplir la red.
- **Un programa vigente por empresa a la vez.** Todos los vales son el mismo activo, `ALIM`, así que los saldos de dos programas se mezclarían en la misma cuenta. Separarlos exige un activo por programa.
- **Verificación simulada.** No se procesan datos reales de identidad.
- **El PIN protege el acceso, no la cuenta en la red.** Las cuentas las custodia el sistema (decisión del MVP); nadie ve su clave. Sin SMS ni correos de verificación: en sus versiones gratuitas solo llegan al desarrollador, así que el PIN nuevo se entrega con un enlace de un solo uso que la empresa comparte por WhatsApp o con un QR.
- **Las demostraciones son públicas.** Cualquiera puede crear una; hay un tope de 30 por hora porque cada una gasta XLM de prueba del emisor.
- **Sin cuenta distribuidora.** El emisor paga directo; en producción conviene separar ambos roles.
- **Un beneficiario autorizado podría transferir vales a otro tenedor autorizado.** Cerrarlo requiere Soroban o un esquema donde solo los comercios reciban.
- **Reservas de cuentas.** Cada trustline exige una reserva en XLM; a escala se resuelve con reservas patrocinadas.

## Fuera de alcance

- Registro ante el Ministerio de Trabajo.
- Conversión y liquidación real a soles, y retiro a soles: la Ley 28051 no permite cambiar el vale por efectivo.
- Devoluciones de una compra.
- Integración con planilla.
- KYC real con documentos.
- Segundo factor para la empresa, doble aprobación de las entregas y separar la administradora de la empresa cliente.

## Próximos pasos

1. **Un activo por programa**: cada empresa afilia a sus propios comercios en la cadena y los saldos de distintos programas dejan de mezclarse.
2. **Contrato Soroban** que haga cumplir en la red los rubros y la vigencia.
3. KYC con SEP-12.
4. Segundo factor y doble aprobación para la empresa.
5. Cobertura sin datos móviles: SMS o USSD.
6. Piloto con una empresa y bodegas de un distrito.
7. Postulación a Instawards y Stellar Community Fund.

## Fuentes

- Ley 28051: [texto en el Congreso](https://www2.congreso.gob.pe/sicr/cendocbib/con4_uibd.nsf/763AF0BB60F8052805257E230074B436/$FILE/1_LEY_28051_02_08_2003.pdf) · [reglamento en FAOLEX](https://www.fao.org/faolex/results/details/es/c/LEX-FAOC198875/) · [requisitos de las administradoras](https://actualidadlaboraldigital.com/aprueban-reglamentos-de-la-ley-de-prestaciones-alimentarias-en-beneficios-de-los-trabajadores-sujetos-al-regimen-laboral-de-la-actividad-privada/)
- Pagos en bodegas: [Gestión, marzo 2026](https://gestion.pe/economia/empresas/yape-y-plin-dominan-pagos-en-bodegas-de-lima-73-de-ventas-ya-se-realiza-con-billeteras-digitales-noticia/) · [Diario Financiero, marzo 2026](https://www.df.cl/ripe/billeteras-yape-y-plin-dominan-pagos-en-bodegas-de-lima-73-de-ventas)
- Competencia: [Pluxee Alimentación](https://www.pluxee.pe/productos/pluxee-alimentacion/) · [Edenred Alimentación](https://www.edenred.com.pe/alimentacion/)
- Cómo funciona un beneficio real: [términos de las tarjetas Pluxee Perú](https://consumidores.pluxee.pe/footer_pluxee/T%C3%A9rminos%20y%20Condiciones%20Tarjetas%20Pluxee.pdf) (vigencia y plazos de uso) · [¿se acumula el saldo?](https://www.pluxee.pe/helpcenter/beneficiario/se-acumula-saldo-tarjeta-pluxee/) · [usar la tarjeta sin trabajar en la empresa](https://www.pluxee.pe/helpcenter/beneficiario/usar-tarjeta-pluxee-sin-trabajar-en-la-empresa/) · [código de aprobación de Yape](https://www.yape.com.pe/productos/aprobar-compras)
- SEP-12: [especificación](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0012.md)

## Licencia y terceros

Licencia MIT (ver `LICENSE`).

| Librería | Uso | Licencia |
|---|---|---|
| [`@stellar/stellar-sdk`](https://github.com/stellar/js-stellar-sdk) | Operaciones en la red | Apache-2.0 |
| [`@neondatabase/serverless`](https://github.com/neondatabase/serverless) | Base de datos | MIT |
| [`vue`](https://github.com/vuejs/core) | Interfaz | MIT |
| [`qrcode`](https://github.com/soldair/node-qrcode) | Generar códigos QR | MIT |
| [`qr-scanner`](https://github.com/nimiq/qr-scanner) | Leer códigos QR con la cámara | MIT |
| [`vite`](https://github.com/vitejs/vite) y [`@vitejs/plugin-vue`](https://github.com/vitejs/vite-plugin-vue) | Compilación y servidor de desarrollo | MIT |
| [Inter](https://github.com/rsms/inter), vía Google Fonts | Tipografía de la interfaz | SIL Open Font License 1.1 |

No se usaron plantillas de terceros. El logo es provisional y está en `public/logo.svg`: para cambiarlo basta con reemplazar ese archivo.

## Equipo

| Nombre | GitHub | Responsabilidad |
|---|---|---|
| Piero De La Cruz Mancilla | `@_______` | Riel de Stellar, script del ciclo, evidencias |
| _Por completar_ | `@_______` | API, verificación, base de datos, despliegue |
| _Por completar_ | `@_______` | Interfaz: vistas de emisor, beneficiario y comercio |

