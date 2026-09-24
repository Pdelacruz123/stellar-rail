<script setup>
/**
 * Un codigo QR. Lo usan las invitaciones y el cobro del comercio.
 *
 * Siempre contiene un enlace web normal. Asi lo abre la camara de cualquier
 * celular, iPhone o Android, sin instalar nada ni conceder permisos.
 */
import { ref, watch } from 'vue';
import QRCode from 'qrcode';

const props = defineProps({
  texto: { type: String, required: true },
  alt: { type: String, required: true },
  tamano: { type: Number, default: 220 },
});

const imagen = ref('');
watch(() => props.texto, async (t) => {
  imagen.value = t
    ? await QRCode.toDataURL(t, { margin: 1, width: props.tamano * 2, errorCorrectionLevel: 'M' })
    : '';
}, { immediate: true });
</script>

<template>
  <img v-if="imagen" :src="imagen" :width="tamano" :height="tamano" :alt="alt" class="qr">
</template>
