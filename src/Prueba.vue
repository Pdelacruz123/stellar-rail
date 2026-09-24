<script setup>
/**
 * El comprobante de una accion: su hash y el enlace al explorador publico.
 *
 * Va debajo de cada operacion a proposito. Es lo que diferencia esto de una
 * base de datos: cualquiera puede abrir el enlace y comprobarlo sin
 * confiar en nosotros.
 */
import { computed } from 'vue';
import { corto } from './estado.js';

const props = defineProps({
  tx: { type: Object, required: true },   // { ok, hash, ledger, explorador, codigo }
});

const etiqueta = computed(() => (props.tx.ok
  ? 'Comprobante:'
  : `Código de la red: ${props.tx.codigo}. Comprobante:`));
</script>

<template>
  <p class="prueba apagado">
    <span>{{ etiqueta }}</span> <a :href="tx.explorador" target="_blank" rel="noopener"><code>{{ corto(tx.hash) }}</code></a><span v-if="tx.ledger"> · ledger {{ tx.ledger }}</span>
  </p>
</template>
