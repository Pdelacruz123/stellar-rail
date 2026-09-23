<script setup>
/**
 * El comprobante de una accion: su hash y el enlace al explorador publico.
 *
 * Va debajo de cada operacion a proposito. Es lo que diferencia esto de una
 * base de datos: cualquiera puede abrir el enlace y comprobarlo sin
 * confiar en nosotros.
 */
import { corto } from './estado.js';

defineProps({
  tx: { type: Object, required: true },   // { ok, hash, ledger, explorador, codigo, mensaje }
});
</script>

<template>
  <p class="prueba apagado">
    <template v-if="tx.ok">Comprobante</template>
    <template v-else>La red lo rechazó: <code>{{ tx.codigo }}</code> · comprobante</template>
    <a :href="tx.explorador" target="_blank" rel="noopener">
      <code>{{ corto(tx.hash) }}</code></a>
    <template v-if="tx.ledger"> · ledger {{ tx.ledger }}</template>
  </p>
</template>
