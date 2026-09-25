<script setup>
/**
 * La tarjeta de quien no tiene smartphone.
 *
 * Lleva un QR con su numero, que la tienda escanea, y el numero impreso por
 * si la camara falla. No lleva el PIN ni ningun dato de la cuenta: sin el
 * PIN no paga, y la empresa la puede anular si se pierde.
 */
import Qr from './Qr.vue';

defineProps({
  numero: { type: String, required: true },
  nombre: { type: String, required: true },
  empresa: { type: String, default: '' },
});
</script>

<template>
  <div class="tarjeta-impresa">
    <div class="tarjeta-impresa-texto">
      <p class="tarjeta-impresa-marca">StellarRail · vale de alimentos</p>
      <p class="tarjeta-impresa-nombre">{{ nombre }}</p>
      <p v-if="empresa" class="tarjeta-impresa-empresa">{{ empresa }}</p>
      <p class="tarjeta-impresa-numero">{{ numero }}</p>
      <p class="tarjeta-impresa-nota">Muéstrala en la tienda y marca tu PIN. Nunca digas tu PIN a nadie.</p>
    </div>
    <Qr :texto="numero" :tamano="132" :alt="`Código QR de la tarjeta ${numero}`" />
  </div>
</template>
