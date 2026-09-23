# Evidencias en Stellar Testnet

Cada entrada es una transacción real y pública en la red de pruebas de Stellar. Cualquiera puede comprobarla con el hash, sin confiar en este documento.

**Red:** Stellar Testnet (`Test SDF Network ; September 2015`)
**Activo:** `ALIM` (alimentación), emitido por la cuenta EMISOR

## Cuentas (solo claves públicas)

| Rol | Clave pública |
|---|---|
| EMISOR | `GAUSPC2LMUGK54YV2I73RMIZG7C5DJKEDLQ7GWINUTXRPGXKHOW7T5JO` |
| TRABAJADOR | `GCKDE6R2AZJXEIGPEUQDVWXKX3VSMBQLVQK4E6OCZSPWZ2TWSYWVFCA7` |
| BODEGA_A (autorizada) | `GCS34UPGF3C7C4NT5MCXUKGEH6BN4ZD5VPKY4ILHVVJYHVEU42LULIHH` |
| BODEGA_B (no autorizada) | `GCQPZQM3Q7AHWR4Z2ZGA2EAR4OLGAXAQXYLBX4AGW4AUHW75CIRNUWV7` |

---

## Evidencia 1: el emisor queda configurado con reglas de control

| Campo | Valor |
|---|---|
| Fecha | 2026-09-20 |
| Operación | `Set Options` |
| Hash | `cc8720b10dfe15bb7e900bc2dcf7f62871dc4060fc2baa21ac995b5ffa59fed4` |
| Ledger | 4777915 |
| Firmó | EMISOR |
| Comisión | 100 stroops (0.00001 XLM) |
| Resultado | Exitoso |

**Qué hace.** Activa tres flags sobre la cuenta emisora (valor combinado 11):

| Flag | Valor | Efecto sobre los vales |
|---|---|---|
| `AUTH_REQUIRED` | 1 | Una cuenta solo puede tener el vale si el emisor la aprueba. Esto es la afiliación de comercios y beneficiarios. |
| `AUTH_REVOCABLE` | 2 | El emisor puede congelar el saldo de una cuenta. |
| `AUTH_CLAWBACK_ENABLED` | 8 | El emisor puede anular saldos. Esto es el vencimiento. |

No se activó `AUTH_IMMUTABLE`, que habría bloqueado estas reglas para siempre.

**Por qué importa.** Sin este paso, un vale emitido sería dinero libre: cualquiera podría recibirlo y gastarlo en cualquier lugar. Con este paso, las restricciones pasan a ser una propiedad del activo, hecha cumplir por la red y no por un servidor.

**Cómo verificarlo**

- Transacción: https://stellar.expert/explorer/testnet/tx/cc8720b10dfe15bb7e900bc2dcf7f62871dc4060fc2baa21ac995b5ffa59fed4
- Horizon (JSON): https://horizon-testnet.stellar.org/transactions/cc8720b10dfe15bb7e900bc2dcf7f62871dc4060fc2baa21ac995b5ffa59fed4
- Estado de la cuenta: https://horizon-testnet.stellar.org/accounts/GAUSPC2LMUGK54YV2I73RMIZG7C5DJKEDLQ7GWINUTXRPGXKHOW7T5JO

En la respuesta de la cuenta, el bloque `flags` debe mostrar:

```json
"flags": {
  "auth_required": true,
  "auth_revocable": true,
  "auth_immutable": false,
  "auth_clawback_enabled": true
}
```

---

## Evidencia 2: las tres cuentas piden poder tener el vale

Cada cuenta abre una trustline hacia `ALIM`, firmada con su propia clave. Como el emisor exige autorización, las tres nacen **sin autorizar**: existen, pero no pueden recibir vales todavía.

| Cuenta | Hash | Ledger |
|---|---|---|
| TRABAJADOR | `b4c49a2d5ea17370524a2ddb32dbb533b1b7e264c03cbe19aa8581327cccfe31` | 4778106 |
| BODEGA_A | `2bcf74c7f25211a177061bf2ac615717ea6a2b4598f17bc4ea72ecfc512705ee` | 4778182 |
| BODEGA_B | `3a5bd17ca5d14beeb689f130cee8584e43ef4ab681a6b4579a7ae058f608b160` | 4778201 |

Operación: `Change Trust` · Activo: `ALIM` (Alphanumeric 4) · Límite: por defecto · Comisión: 100 stroops cada una · Resultado: exitoso.

**Por qué importa.** Demuestra que tener el vale requiere dos voluntades: la de la cuenta que lo pide y la del emisor que lo aprueba.

**Cómo verificarlo:** https://stellar.expert/explorer/testnet/tx/HASH (reemplazar HASH). En Horizon, la cuenta debe mostrar una entrada en `balances` para `ALIM` con `is_authorized: false`.

---

## Evidencia 3: afiliación de comercio y beneficiario

| Campo | Valor |
|---|---|
| Fecha | 2026-09-20 |
| Operación | `Set Trust Line Flags` (×2: TRABAJADOR y BODEGA_A), en una sola transacción |
| Hash | `7ffe4b8c9117b10ba94cc898f1daeb8d521728214886590c4ba11578bba936ec` |
| Ledger | 4778493 |
| Firmó | EMISOR |
| Comisión | 200 stroops (100 por operación) |
| Resultado | Exitoso |

**Qué hace.** El emisor autoriza a TRABAJADOR y a BODEGA_A a tener `ALIM`. BODEGA_B se deja sin autorizar a propósito, para mostrar el rechazo.

**Por qué importa.** Esta aprobación es la afiliación del comercio: no la decide un servidor ni una base de datos, queda registrada en la red y cualquiera puede comprobarla.

**Cómo verificarlo**

- Transacción: https://stellar.expert/explorer/testnet/tx/7ffe4b8c9117b10ba94cc898f1daeb8d521728214886590c4ba11578bba936ec
- En Horizon, la entrada de `ALIM` en `balances` debe mostrar `is_authorized: true` para TRABAJADOR y BODEGA_A, y `false` para BODEGA_B.

---

## Evidencia 4: nacimiento y entrega del vale

| Campo | Valor |
|---|---|
| Fecha | 2026-09-20 |
| Operación | `Payment` del EMISOR al TRABAJADOR |
| Monto | 10 `ALIM` |
| Hash | `0edf301eda1a3da072ec5300f00d01d5968786a95d9129c66a2244ea51ce8cb3` |
| Ledger | 4779421 |
| Firmó | EMISOR |
| Comisión | 100 stroops |
| Resultado | Exitoso |

**Qué hace.** El emisor paga 10 `ALIM` a TRABAJADOR. Como el pago sale de la cuenta emisora, el vale se crea en ese momento.

**Por qué importa.** Solo pudo recibirlo porque el emisor había autorizado antes su trustline (evidencia 3). Una cuenta sin esa autorización, como BODEGA_B, no habría podido.

**Cómo verificarlo**

- Transacción: https://stellar.expert/explorer/testnet/tx/0edf301eda1a3da072ec5300f00d01d5968786a95d9129c66a2244ea51ce8cb3
- En Horizon, la cuenta de TRABAJADOR debe mostrar `ALIM` con saldo `10.0000000` y `is_authorized: true`.

**Nota.** No hay cuenta distribuidora en el MVP: el emisor paga directo. Como mejora futura, separar emisor y distribuidora.

---

## Evidencia 5: pago aceptado en comercio autorizado

| Campo | Valor |
|---|---|
| Fecha | 2026-09-20 |
| Operación | `Payment` TRABAJADOR → BODEGA_A |
| Monto | 3 `ALIM` |
| Hash | `03b7a7a73ceb9a80931ecde1bd97679de19faae43430597dd1ec86dccaa49ca9` |
| Ledger | 4779548 |
| Firmó | TRABAJADOR |
| Comisión | 100 stroops |
| Resultado | Exitoso |

**Qué hace.** El trabajador paga 3 `ALIM` a una bodega afiliada.

**Por qué importa.** El pago se ejecuta porque BODEGA_A fue autorizada por el emisor (evidencia 3). Es el caso feliz del vale: liquidación en segundos y sin intermediarios.

**Cómo verificarlo**

- Transacción: https://stellar.expert/explorer/testnet/tx/03b7a7a73ceb9a80931ecde1bd97679de19faae43430597dd1ec86dccaa49ca9
- En Horizon, BODEGA_A debe mostrar `ALIM` con saldo `3.0000000` y TRABAJADOR `7.0000000`.

---

## Evidencia 6: pago rechazado en comercio no autorizado

| Campo | Valor |
|---|---|
| Fecha | 2026-09-20 |
| Operación | `Payment` TRABAJADOR → BODEGA_B |
| Monto | 1 `ALIM` |
| Resultado | **Rechazado** por la red |
| Códigos de error | `tx_failed` · `op_not_authorized` |
| Hash | `a2a93ef51e1c1fcba4832655b8f53af1abb31c0e213eb001de01d15b68ee8a4b` |
| Ledger | 4779583 |
| Comisión | 100 stroops (la red cobró igual) |
| Firmó | TRABAJADOR |

**Qué hace.** El trabajador intenta pagar 1 `ALIM` a BODEGA_B, un comercio que el emisor nunca autorizó.

**Por qué importa.** Es la prueba central del proyecto. El pago estaba bien firmado y el trabajador tenía saldo, pero la red lo rechazó porque el destino no está autorizado por el emisor. No lo rechazó un servidor ni una regla de la aplicación: lo rechazó el propio protocolo. Comparar con la evidencia 5, donde el mismo pago hacia BODEGA_A sí se ejecutó.

**Cómo verificarlo**

- Estado de BODEGA_B en Horizon: la entrada de `ALIM` debe mostrar `is_authorized: false` y saldo `0.0000000`.
- Transacción en Horizon: https://horizon-testnet.stellar.org/transactions/a2a93ef51e1c1fcba4832655b8f53af1abb31c0e213eb001de01d15b68ee8a4b. **Comprobado el 2026-09-21:** responde `200` con `successful: false`, ledger 4779583 y 100 stroops de comisión. La transacción sí quedó en el libro público: el rechazo es tan verificable como una operación exitosa.

**Captura del error (guardar):** `extras.result_codes: {"transaction":"tx_failed","operations":["op_not_authorized"]}`

**Nota.** Un rechazo a nivel de operación, como este, normalmente sí queda en el ledger con su comisión. Un rechazo previo, como `tx_bad_auth`, no queda registrado.

---

## Evidencia 7: congelado previo al vencimiento

| Campo | Valor |
|---|---|
| Fecha | 2026-09-20 |
| Operación | `Set Trust Line Flags` sobre TRABAJADOR |
| Hash | `6026944617492a57465ac9ecd9d667d9d8c4b579a56d895424a5e4539b7f3181` |
| Ledger | 4779692 |
| Firmó | EMISOR |
| Comisión | 100 stroops |
| Resultado | Exitoso |

**Qué hace.** Quita la autorización normal (`Authorized`) de la trustline del trabajador y pone `Authorized to maintain liabilities`. No se tocó el flag de clawback.

**Por qué importa.** Es el primer paso del vencimiento. La cuenta conserva su saldo, pero ya no puede gastarlo: el vale queda suspendido hasta que el emisor ejecute la anulación.

**Cómo verificarlo**

- Transacción: https://stellar.expert/explorer/testnet/tx/6026944617492a57465ac9ecd9d667d9d8c4b579a56d895424a5e4539b7f3181
- En Horizon, la entrada de `ALIM` de TRABAJADOR debe mostrar saldo `7.0000000`, `is_authorized: false` e `is_authorized_to_maintain_liabilities: true`.

---

## Evidencia 7b: un vale congelado no se puede gastar

| Campo | Valor |
|---|---|
| Fecha | 2026-09-20 |
| Operación | `Payment` TRABAJADOR → BODEGA_A |
| Monto | 1 `ALIM` |
| Resultado | **Rechazado** por la red |
| Códigos de error | `tx_failed` · `op_src_not_authorized` |
| Hash | `8029708fdd60b8ecc1b50c622ff68d69ba2b497c04b8e48c1b6c09ae8aa3fcf3` |
| Ledger | 4779763 |
| Comisión | 100 stroops (la red cobró igual) |
| Firmó | TRABAJADOR |

**Qué hace.** Con la trustline congelada (evidencia 7), el trabajador intenta pagar a una bodega autorizada.

**Por qué importa.** Es el mismo pago que funcionó en la evidencia 5, hacia el mismo comercio. Ahora falla porque la cuenta de origen fue congelada por el emisor. Demuestra que un vale suspendido o vencido no se puede gastar.

**Cómo verificarlo:** https://horizon-testnet.stellar.org/transactions/8029708fdd60b8ecc1b50c622ff68d69ba2b497c04b8e48c1b6c09ae8aa3fcf3. **Comprobado el 2026-09-21:** responde `200` con `successful: false`, ledger 4779763 y 100 stroops de comisión.

**Captura del error (guardar):** `extras.result_codes: {"transaction":"tx_failed","operations":["op_src_not_authorized"]}`

---

## Evidencia 8: saldo vencido anulado

| Campo | Valor |
|---|---|
| Fecha | 2026-09-20 |
| Operación | `Clawback` |
| Activo | `ALIM` |
| Desde | TRABAJADOR |
| Monto anulado | 7 `ALIM` |
| Hash | `1d75e34f0f963d5fc436b693f2634a09e8b85b0730c57319546cbfe288289044` |
| Ledger | 4779939 |
| Firmó | EMISOR |
| Comisión | 100 stroops |
| Resultado | Exitoso |

**Qué hace.** El emisor anula el saldo que el trabajador no gastó. Los 3 `ALIM` que ya había pagado a BODEGA_A no se tocan.

**Por qué importa.** Es el vencimiento. No depende de que el trabajador devuelva nada ni de que un sistema externo lo procese: el emisor lo ejecuta y la red lo aplica. Se hizo sobre la trustline congelada en la evidencia 7, así que el trabajador no pudo gastar mientras se ejecutaba.

**Cómo verificarlo**

- Transacción: https://stellar.expert/explorer/testnet/tx/1d75e34f0f963d5fc436b693f2634a09e8b85b0730c57319546cbfe288289044
- En Horizon, TRABAJADOR debe mostrar `ALIM` con saldo `0.0000000` y BODEGA_A `3.0000000`.

**Nota.** El clawback destruye el saldo; no lo transfiere al emisor. El emisor recupera su respaldo en soles, no los tokens.

**Nota sobre el vencimiento automático.** Stellar no ejecuta tareas programadas. En este MVP el clawback se envía manualmente desde Lab; en la aplicación lo ejecutará un proceso del backend al llegar la fecha de vencimiento.

---

## Evidencias 9 a 18: el ciclo completo ejecutado por la aplicación desplegada

Las evidencias 1 a 8 se hicieron a mano en Stellar Lab. Estas las generó **la aplicación en producción**, en <https://stellar-rail.vercel.app>, recorriendo el flujo por HTTP como lo haría cualquier visitante: registro, verificación, entrega, pago, rechazo y vencimiento.

Fecha: 2026-09-22. Un solo recorrido, ledgers 4819984 a 4819993, consecutivos.

| # | Qué hizo la aplicación | Operación | Resultado | Ledger | Transacción |
|---|---|---|---|---|---|
| 9 | Registra a la beneficiaria: crea su cuenta y su trustline, con las reservas a cargo del emisor | `Begin Sponsoring` + `Create Account` + `Change Trust` + `End Sponsoring` | exitosa | 4819984 | [`2d6f14b0…`](https://stellar.expert/explorer/testnet/tx/2d6f14b0680987e0b58029a7c4df0e9c0f0642e72ea39f65e137e376e0a707cc) |
| 10 | Registra la Bodega Don Julio | ídem | exitosa | 4819985 | [`321975b3…`](https://stellar.expert/explorer/testnet/tx/321975b34daaec24bc2a6f3336fdc862b75fea2af1a5645632df8247185451d3) |
| 11 | Registra el Minimarket La Esquina, que **no se afiliará** | ídem | exitosa | 4819986 | [`fd51c7e7…`](https://stellar.expert/explorer/testnet/tx/fd51c7e72184e26fe818d48bdcd834cfee1d7120837c6d0c8d4adff42d0fb52d) |
| 12 | **El emisor aprueba a la beneficiaria.** Esta transacción *es* la verificación | `Set Trust Line Flags` | exitosa | 4819987 | [`1f0fd708…`](https://stellar.expert/explorer/testnet/tx/1f0fd708c9ad8b4c3ccc3918476e42536a771aea8c50e01beab62ee8299e99fc) |
| 13 | El emisor afilia la Bodega Don Julio | `Set Trust Line Flags` | exitosa | 4819988 | [`e1573eb4…`](https://stellar.expert/explorer/testnet/tx/e1573eb4f3d1fbcb071bb2901c4915d647ab80b6bc77ea6de14be3c21eef0e93) |
| 14 | Entrega el vale: 50 `ALIM` | `Payment` | exitosa | 4819989 | [`d9fca0da…`](https://stellar.expert/explorer/testnet/tx/d9fca0da71b1b49a4cdd4f6be52f842a3a57a09b433501d48c760b936b37ab05) |
| 15 | **Pago aceptado** de 18,50 `ALIM` en la bodega afiliada, con el código de 6 dígitos | `Payment` | exitosa | 4819990 | [`22cd8fa5…`](https://stellar.expert/explorer/testnet/tx/22cd8fa5641549e0a46c1ceb5cfb99ca91348f2583c649268892f057142b3ac4) |
| 16 | **Pago rechazado** por la red en el comercio no afiliado | `Payment` | `op_not_authorized` | 4819991 | [`a0a3c4d2…`](https://stellar.expert/explorer/testnet/tx/a0a3c4d2ef35aa161cafd05f1ad1b7c9a339485f5ec7668cea500b1a359c237b) |
| 17 | **Vencimiento:** congela y anula el saldo en una sola transacción atómica | `Set Trust Line Flags` + `Clawback` | exitosa | 4819992 | [`c766fdab…`](https://stellar.expert/explorer/testnet/tx/c766fdab0893bac13bcfb7b2c3019ee18e8c5d137a683df722cae6924076d358) |
| 18 | **Pago bloqueado** con el vale ya vencido | `Payment` | `op_src_not_authorized` | 4819993 | [`48c8e6c2…`](https://stellar.expert/explorer/testnet/tx/48c8e6c2c74833aa2cabf3816edf95c9d2b8477a45999be5e5155f60c0989a96) |

**Las dos comparaciones que importan.** La 15 y la 16 son el mismo pago, del mismo monto, firmado por la misma cuenta, con el mismo saldo. La única diferencia es que el emisor afilió a un comercio y al otro no, y por eso una se ejecutó y la otra la rechazó el protocolo. La 15 y la 18 van hacia el mismo comercio afiliado: la segunda falla porque entre medias venció el programa.

**Los rechazos también son comprobables.** Las evidencias 16 y 18 están en el ledger, con `successful: false` y 100 stroops de comisión cada una. Se verifican con su hash igual que cualquier operación exitosa.

**Sobre las reservas.** Las altas 9, 10 y 11 usan reservas patrocinadas: el emisor paga el depósito de 1,5 XLM que la red exige por cada cuenta. La beneficiaria queda con un saldo mínimo exigido de cero y no necesita conseguir XLM para cobrar su vale.

---

## Reglas para este archivo

- Nunca escribir claves secretas (`S...`) aquí ni en ningún archivo del repositorio.
- Las claves públicas (`G...`) y los hashes son públicos y pueden ir libremente.
- Cada evidencia debe poder verificarse con solo el hash y un enlace.
