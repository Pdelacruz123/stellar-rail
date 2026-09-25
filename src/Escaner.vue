<script setup>
/**
 * La camara para leer un codigo QR, dentro de la aplicacion.
 *
 * Solo la camara: si no hay camara o no se da permiso (por ejemplo, en una
 * computadora), no muestra nada y avisa con `sinCamara`. La pantalla que lo
 * usa siempre ofrece escribir el codigo a mano, asi que nadie se queda sin
 * poder pagar o cobrar.
 *
 * Emite `leido` con el texto del QR; quien lo usa decide si le sirve.
 */
import { onMounted, onUnmounted, ref } from 'vue';
import QrScanner from 'qr-scanner';

const emit = defineEmits(['leido', 'sinCamara']);
defineProps({ etiqueta: { type: String, default: 'Imagen de la cámara' } });

const video = ref(null);
const activa = ref(true);
let escaner = null;
let desmontado = false;

onMounted(async () => {
  const hayCamara = await QrScanner.hasCamera().catch(() => false);
  if (desmontado || !video.value) return;
  if (!hayCamara) {
    activa.value = false;
    emit('sinCamara');
    return;
  }
  escaner = new QrScanner(video.value, (resultado) => {
    navigator.vibrate?.(80);
    emit('leido', resultado.data);
  }, {
    preferredCamera: 'environment',
    highlightScanRegion: true,
    highlightCodeOutline: true,
    returnDetailedScanResult: true,
    maxScansPerSecond: 4,
  });
  try {
    await escaner.start();
  } catch {
    activa.value = false;
    emit('sinCamara');
  }
});

onUnmounted(() => {
  desmontado = true;
  escaner?.destroy();
});

defineExpose({ detener: () => escaner?.stop() });
</script>

<template>
  <div v-if="activa" class="visor">
    <video ref="video" muted playsinline :aria-label="etiqueta" />
  </div>
</template>
