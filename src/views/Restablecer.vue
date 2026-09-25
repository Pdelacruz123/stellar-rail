<script setup>
/**
 * Poner un PIN nuevo: #/restablecer/<token>
 *
 * La empresa genera el enlace y se lo pasa a la persona por WhatsApp o con
 * un QR en Recursos Humanos. Sin SMS: en su version gratuita solo llegan al
 * celular del desarrollador. El enlace sirve una vez y caduca en 24 horas.
 *
 * Guardar el PIN no inicia sesion: el enlace puede abrirse en el equipo de
 * Recursos Humanos, con la cuenta de la empresa abierta, y no debe cambiarla.
 * La persona entra despues con su celular y su PIN nuevo.
 */
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { conSesion } from '../estado.js';
import { REGLA_PIN, pinValido, problemaDelPin } from '../../lib/reglas.js';
import Pin from '../Pin.vue';

const props = defineProps({ token: { type: String, required: true } });

const para = ref(null);   // { rol, nombre }
const error = ref('');
const pin = ref('');
const pin2 = ref('');
const aviso = ref('');
const trabajando = ref(false);
const listo = ref(false);

const problema = computed(() => problemaDelPin(pin.value, pin2.value));
const sePuede = computed(() => pinValido(pin.value) && pin.value === pin2.value);

onMounted(async () => {
  try {
    para.value = await api.verRestablecer(props.token);
  } catch (e) {
    error.value = e.message;
  }
});

async function guardar() {
  aviso.value = '';
  if (!sePuede.value) return;
  trabajando.value = true;
  try {
    await api.restablecer(props.token, pin.value);
    listo.value = true;
  } catch (e) {
    aviso.value = e.message;
    pin.value = '';
    pin2.value = '';
  } finally {
    trabajando.value = false;
  }
}

const irA = (r) => { window.location.hash = r; };
</script>

<template>
  <section class="tarjeta">
    <p v-if="error" class="aviso no" role="alert"><strong>Este enlace ya no sirve</strong>{{ error }}</p>
    <p v-else-if="!para" class="cargando">Abriendo…</p>

    <div v-else-if="listo" class="resultado ok" role="status">
      <div class="sello ok"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
      <p class="titulo-resultado">Listo, {{ para.nombre }}</p>
      <p>Tu PIN nuevo ya sirve. Entra con tu celular y tu PIN nuevo.</p>
      <button class="principal" @click="irA('#/')">{{ conSesion() ? 'Volver' : 'Ir a entrar' }}</button>
    </div>

    <form v-else @submit.prevent="guardar">
      <h2>Hola, {{ para.nombre }}</h2>
      <p>Elige tu PIN nuevo. El anterior deja de servir.</p>
      <p class="apagado pequeno">{{ REGLA_PIN }}</p>
      <Pin v-model="pin" id="np" etiqueta="PIN nuevo de 4 números" />
      <Pin v-model="pin2" id="np2" etiqueta="Escríbelo otra vez" />
      <p v-if="problema" class="aviso espera" role="status">{{ problema }}</p>
      <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
      <button class="principal" :disabled="trabajando || !sePuede">
        {{ trabajando ? 'Guardando…' : 'Guardar mi PIN' }}
      </button>
    </form>
  </section>
</template>
