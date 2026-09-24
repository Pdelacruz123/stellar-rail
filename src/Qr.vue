<script setup>
/**
 * Un codigo QR, pensado para que lo lea una camara barata con mala luz.
 *
 * - Margen de 4 modulos, el que exige la norma. Con menos, muchas camaras
 *   no encuentran el codigo, y sobre fondo oscuro fallan casi siempre.
 * - SVG en vez de imagen: se ve nitido a cualquier tamano, tambien impreso
 *   en un cartel grande.
 * - Correccion de errores "Q" por defecto (25 %): un cartel pegado en un
 *   mostrador se ensucia y se raya, y aun asi tiene que leerse.
 * - Siempre negro sobre blanco, tambien en modo oscuro.
 */
import { ref, watch } from 'vue';
import QRCode from 'qrcode';

const props = defineProps({
  texto: { type: String, required: true },
  alt: { type: String, required: true },
  tamano: { type: Number, default: 240 },
  nivel: { type: String, default: 'Q' },
});

const svg = ref('');
watch(() => [props.texto, props.nivel], async ([texto, nivel]) => {
  svg.value = texto
    ? await QRCode.toString(texto, {
      type: 'svg',
      margin: 4,
      errorCorrectionLevel: nivel,
      color: { dark: '#000000', light: '#ffffff' },
    })
    : '';
}, { immediate: true });
</script>

<template>
  <div
    class="qr" role="img" :aria-label="alt"
    :style="{ width: `${tamano}px`, height: `${tamano}px` }"
    v-html="svg" />
</template>
