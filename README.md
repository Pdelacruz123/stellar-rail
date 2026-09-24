# StellarRail — vales programables sobre Stellar

**Stellar Odyssey Perú** · Track 03: Real-World Assets & Compliant Rails

> Stellar Rail.

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
2. **Entrega:** la empresa asigna saldo a sus trabajadores verificados.
3. **Pago:** el trabajador paga a un comercio autorizado. Si el comercio no está autorizado, **la red rechaza el pago**.
4. **Vencimiento:** al vencer el programa, el emisor congela el saldo y lo anula.

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

Aclaración: el vencimiento no es un requisito de la ley. Es una regla que el emisor define en su programa.

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
| API | Funciones serverless de Vercel (Node) | Firmar y enviar transacciones; registro y verificación |
| Riel | SDK de JavaScript de Stellar | Emisión, autorización, pago, congelado, anulación |
| Datos | Neon (PostgreSQL) | Programas, comercios, beneficiarios, estado de verificación y eventos. **Nunca saldos** |
| Red | Stellar Testnet vía Horizon | Fuente de verdad de saldos y autorizaciones |

**Decisión del MVP:** el backend custodia las claves de las cuentas de demo y firma por ellas. Lo verificable no es la custodia, sino que las reglas son públicas y las hace cumplir la red. En producción, cada usuario tendría su propia billetera.

## Construido durante la ventana del evento

Proyecto nuevo, iniciado el 19 de septiembre de 2026. No parte de código previo.

<!-- Completar al cierre: lista de lo implementado durante la semana -->

## Estado actual

El ciclo completo del vale está **ejecutado y verificable en Stellar Testnet**, hecho manualmente con Stellar Lab. La aplicación web, la automatización y la verificación simulada están en desarrollo.

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

**Reproducir el ciclo a mano** en [Stellar Lab](https://lab.stellar.org), red Testnet:

1. Crear y fondear cuatro cuentas con Friendbot.
2. En EMISOR: `Set Options` con `AUTH_REQUIRED`, `AUTH_REVOCABLE` y `AUTH_CLAWBACK_ENABLED`, antes de crear trustlines.
3. En las otras tres: `Change Trust` hacia `ALIM` del EMISOR.
4. En EMISOR: `Set Trust Line Flags` para autorizar a TRABAJADOR y BODEGA_A.
5. EMISOR paga 10 `ALIM` a TRABAJADOR.
6. TRABAJADOR paga a BODEGA_A (funciona) y a BODEGA_B (falla).
7. EMISOR congela a TRABAJADOR y ejecuta `Clawback` por el saldo restante.

**Aplicación y script:** en construcción.

<!-- Completar: requisitos, variables de entorno, npm install, npm run dev, node scripts/ciclo.js, URL pública -->

## Limitaciones

- **El clawback destruye el saldo.** No lo devuelve como tokens al emisor; el emisor recupera su respaldo en soles, que deja de estar comprometido.
- **El vencimiento no lo dispara la red.** Stellar no ejecuta tareas programadas. En el MVP lo ejecuta el emisor con un botón.
- **Las categorías de gasto no son nativas.** Stellar controla quién puede tener el activo, no el rubro. La propuesta es un activo por categoría (`ALIM`, `TRAN`). Un contrato Soroban que valide categoría y vigencia es un siguiente paso.
- **Verificación simulada.** No se procesan datos reales de identidad.
- **Sin cuenta distribuidora.** El emisor paga directo; en producción conviene separar ambos roles.
- **Un beneficiario autorizado podría transferir vales a otro tenedor autorizado.** Cerrarlo requiere Soroban o un esquema donde solo los comercios reciban.
- **Reservas de cuentas.** Cada trustline exige una reserva en XLM; a escala se resuelve con reservas patrocinadas.

## Fuera de alcance

- Registro ante el Ministerio de Trabajo.
- Conversión y liquidación real a soles.
- Integración con planilla.
- KYC real con documentos.

## Próximos pasos

1. Script que reproduce el ciclo con un comando.
2. Aplicación web con verificación, entrega, pago por QR y vencimiento.
3. KYC con SEP-12.
4. Contrato Soroban para categorías y vigencia.
5. Piloto con una empresa y bodegas de un distrito.
6. Postulación a Instawards y Stellar Community Fund.

## Fuentes

- Ley 28051: [texto en el Congreso](https://www2.congreso.gob.pe/sicr/cendocbib/con4_uibd.nsf/763AF0BB60F8052805257E230074B436/$FILE/1_LEY_28051_02_08_2003.pdf) · [reglamento en FAOLEX](https://www.fao.org/faolex/results/details/es/c/LEX-FAOC198875/) · [requisitos de las administradoras](https://actualidadlaboraldigital.com/aprueban-reglamentos-de-la-ley-de-prestaciones-alimentarias-en-beneficios-de-los-trabajadores-sujetos-al-regimen-laboral-de-la-actividad-privada/)
- Pagos en bodegas: [Gestión, marzo 2026](https://gestion.pe/economia/empresas/yape-y-plin-dominan-pagos-en-bodegas-de-lima-73-de-ventas-ya-se-realiza-con-billeteras-digitales-noticia/) · [Diario Financiero, marzo 2026](https://www.df.cl/ripe/billeteras-yape-y-plin-dominan-pagos-en-bodegas-de-lima-73-de-ventas)
- Competencia: [Pluxee Alimentación](https://www.pluxee.pe/productos/pluxee-alimentacion/) · [Edenred Alimentación](https://www.edenred.com.pe/alimentacion/)
- SEP-12: [especificación](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0012.md)

## Licencia y terceros

Licencia MIT (ver `LICENSE`).

<!-- Completar: librerías y plantillas de terceros con su licencia -->

## Equipo

| Nombre | GitHub | Responsabilidad |
|---|---|---|
| Piero De La Cruz Mancilla | `@_______` | Riel de Stellar, script del ciclo, evidencias |
| _Por completar_ | `@_______` | API, verificación, base de datos, despliegue |
| _Por completar_ | `@_______` | Interfaz: vistas de emisor, beneficiario y comercio |

