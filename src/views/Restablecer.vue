<script setup>
/**
 * Poner un PIN nuevo: #/restablecer/<token>
 *
 * La empresa genera el enlace y se lo pasa a la persona por WhatsApp o con
 * un QR en Recursos Humanos. Sin SMS: en su version gratuita solo llegan al
 * celular del desarrollador. El enlace sirve una vez y caduca en 24 horas.
 */
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import { ponerPerfil } from '../estado.js';
import Pin from '../Pin.vue';

const props = defineProps({ token: { type: String, required: true } });

const para = ref(null);   // { rol, nombre }
const error = ref('');
const pin = ref('');
const pin2 = ref('');
const aviso = ref('');
const trabajando = ref(false);

onMounted(async () => {
  try {
    para.value = await api.verRestablecer(props.token);
  } catch (e) {
    error.value = e.message;
  }
});

async function guardar() {
  aviso.value = '';
  if (pin.value !== pin2.value) {
    aviso.value = 'Los dos PIN no son iguales. Escríbelos otra vez.';
    pin.value = '';
    pin2.value = '';
    return;
  }
  trabajando.value = true;
  try {
    await ponerPerfil(await api.restablecer(props.token, pin.value));
    window.location.replace('#/');
  } catch (e) {
    aviso.value = e.message;
  } finally {
    trabajando.value = false;
  }
}
</script>

<template>
  <section class="tarjeta">
    <p v-if="error" class="aviso no" role="alert"><strong>Este enlace ya no sirve</strong>{{ error }}</p>
    <p v-else-if="!para" class="cargando">Abriendo…</p>
    <form v-else @submit.prevent="guardar">
      <h2>Hola, {{ para.nombre }}</h2>
      <p>Elige tu PIN nuevo. El anterior deja de servir.</p>
      <Pin v-model="pin" id="np" etiqueta="PIN nuevo de 4 números" />
      <Pin v-model="pin2" id="np2" etiqueta="Escríbelo otra vez" />
      <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
      <button class="principal" :disabled="trabajando || pin.length !== 4 || pin2.length !== 4">
        {{ trabajando ? 'Guardando…' : 'Guardar mi PIN' }}
      </button>
    </form>
  </section>
</template>
