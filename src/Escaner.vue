<script setup>
/**
 * Escaner de QR dentro de la aplicacion.
 *
 * Muchos no saben que la camara del celular lee codigos QR: quien usa Yape
 * aprendio a escanear DENTRO de Yape. Este boton hace lo mismo.
 *
 * Si no hay camara o no se da permiso, se ofrece escribir el codigo de 6
 * numeros: nadie se queda sin poder pagar.
 */
import { onMounted, onUnmounted, ref } from 'vue';
import QrScanner from 'qr-scanner';
import { leerQr } from './enlaces.js';
import Icono from './Icono.vue';

const emit = defineEmits(['leido', 'cancelar', 'escribir']);

const video = ref(null);
const problema = ref('');   // '' | 'sin-camara' | 'permiso'
const aviso = ref('');
let escaner = null;

onMounted(async () => {
  if (!(await QrScanner.hasCamera())) {
    problema.value = 'sin-camara';
    return;
  }
  escaner = new QrScanner(video.value, (resultado) => {
    const leido = leerQr(resultado.data);
    if (!leido) {
      aviso.value = 'Este código no es de StellarRail. Busca el de la tienda.';
      return;
    }
    if (leido.tipo === 'invitacion') {
      aviso.value = 'Este código es una invitación, no un cobro.';
      return;
    }
    escaner.stop();
    navigator.vibrate?.(80);
    emit('leido', leido);
  }, {
    preferredCamera: 'environment',
    highlightScanRegion: true,
    highlightCodeOutline: true,
    returnDetailedScanResult: true,
    maxScansPerSecond: 8,
  });
  try {
    await escaner.start();
  } catch {
    problema.value = 'permiso';
  }
});

onUnmounted(() => {
  escaner?.destroy();
});
</script>

<template>
  <div class="escaner">
    <template v-if="!problema">
      <p class="pregunta">Apunta al código QR de la tienda</p>
      <div class="visor">
        <video ref="video" muted playsinline aria-label="Imagen de la cámara" />
      </div>
    </template>
    <div v-else class="aviso no" role="alert">
      <strong>{{ problema === 'permiso' ? 'No pudimos usar la cámara' : 'No encontramos una cámara' }}</strong>
      {{ problema === 'permiso'
        ? 'Permite el uso de la cámara, o escribe el código de la tienda.'
        : 'Escribe el código de 6 números que te dicen en la tienda.' }}
    </div>
    <p v-if="aviso" class="aviso espera" role="status">{{ aviso }}</p>

    <button class="secundario" @click="emit('escribir')">
      <Icono nombre="teclado" /> Escribir el código
    </button>
    <button class="enlace" @click="emit('cancelar')">Cancelar</button>
  </div>
</template>
