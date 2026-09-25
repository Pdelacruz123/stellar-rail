<script setup>
/**
 * Escaner de QR dentro de la aplicacion.
 *
 * Muchos no saben que la camara del celular lee codigos QR: quien usa Yape
 * aprendio a escanear DENTRO de Yape. Este boton hace lo mismo.
 *
 * Nadie se queda sin poder pagar si la camara falla. Hay otras salidas:
 *  - subir una foto del QR (por ejemplo, la que llego por WhatsApp);
 *  - pegar el enlace del cobro;
 *  - escribir el codigo de 6 numeros, o el numero de la tarjeta.
 *
 * Lo usan el trabajador (lee el QR de la tienda) y la tienda (lee la
 * tarjeta impresa de quien no tiene smartphone).
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import QrScanner from 'qr-scanner';
import { leerQr } from './enlaces.js';
import Icono from './Icono.vue';

const props = defineProps({
  // 'pago': el QR de una tienda. 'tarjeta': la tarjeta impresa de un trabajador.
  busca: { type: String, default: 'pago' },
});
const emit = defineEmits(['leido', 'cancelar', 'escribir']);

const esTarjeta = computed(() => props.busca === 'tarjeta');
const video = ref(null);
const problema = ref('');   // '' | 'sin-camara' | 'permiso'
const aviso = ref('');
const pegando = ref(false);
const pegado = ref('');
let escaner = null;
let desmontado = false;

/** Comprueba lo leido. Devuelve true si sirvio. */
function probar(texto) {
  const leido = leerQr(texto);
  if (esTarjeta.value) {
    if (leido?.tipo === 'tarjeta') return entregar(leido);
    aviso.value = 'Esto no es una tarjeta de StellarRail.';
    return false;
  }
  if (!leido || leido.tipo === 'tarjeta') {
    aviso.value = 'Este código no es de una tienda de StellarRail.';
    return false;
  }
  if (leido.tipo === 'invitacion') {
    aviso.value = 'Este código es una invitación, no un cobro.';
    return false;
  }
  return entregar(leido);
}

function entregar(leido) {
  escaner?.stop();
  navigator.vibrate?.(80);
  emit('leido', leido);
  return true;
}

onMounted(async () => {
  const hayCamara = await QrScanner.hasCamera();
  // Mientras se buscaba la camara, la persona pudo ya escanear con otra
  // opcion o cancelar: entonces no queda video donde mostrarla.
  if (desmontado || !video.value) return;
  if (!hayCamara) {
    problema.value = 'sin-camara';
    return;
  }
  escaner = new QrScanner(video.value, (resultado) => { probar(resultado.data); }, {
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
  desmontado = true;
  escaner?.destroy();
});

async function subirFoto(evento) {
  const archivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!archivo) return;
  aviso.value = '';
  try {
    const r = await QrScanner.scanImage(archivo, { returnDetailedScanResult: true });
    probar(r.data);
  } catch {
    aviso.value = 'No encontramos un código QR en esa foto. Prueba con otra, más cerca y con luz.';
  }
}

function usarPegado() {
  aviso.value = '';
  if (!pegado.value.trim()) return;
  probar(pegado.value);
}
</script>

<template>
  <div class="escaner">
    <p class="pregunta">{{ esTarjeta ? 'Escanea la tarjeta del cliente' : 'Escanea el QR de la tienda' }}</p>

    <div v-if="!problema" class="visor">
      <video ref="video" muted playsinline aria-label="Imagen de la cámara" />
    </div>
    <div v-else class="aviso no" role="alert">
      <strong>{{ problema === 'permiso' ? 'No pudimos usar la cámara' : 'No encontramos una cámara' }}</strong>
      Puedes subir una foto del código o escribirlo.
    </div>
    <p v-if="aviso" class="aviso espera" role="status">{{ aviso }}</p>

    <label class="boton secundario subir">
      <Icono nombre="imprimir" /> Subir foto del QR
      <input type="file" accept="image/*" class="oculto" @change="subirFoto">
    </label>

    <template v-if="!esTarjeta">
      <button v-if="!pegando" class="secundario" @click="pegando = true">
        <Icono nombre="copiar" /> Pegar el enlace
      </button>
      <form v-else class="pegar" @submit.prevent="usarPegado">
        <label for="pegado">Pega aquí el enlace que te enviaron</label>
        <input id="pegado" v-model="pegado" autocomplete="off" placeholder="https://…/#/cobro/…">
        <button class="secundario">Usar este enlace</button>
      </form>
    </template>

    <button class="secundario" @click="emit('escribir')">
      <Icono nombre="teclado" /> {{ esTarjeta ? 'Escribir el número de la tarjeta' : 'Escribir el código' }}
    </button>
    <button class="enlace" @click="emit('cancelar')">Cancelar</button>
  </div>
</template>
