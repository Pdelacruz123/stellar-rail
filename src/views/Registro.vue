<script setup>
/**
 * Registrarse con una invitacion: #/unirse/<token>
 *
 * Lo minimo: nombre, celular y un PIN. La tienda dice ademas que vende y,
 * si quiere, su distrito. Nada de RUC: muchas bodegas de Lima no lo tienen
 * o estan en el RUS, y exigirlo dejaria fuera a quien decimos atender.
 *
 * Registrarse no aprueba a nadie: la persona queda pendiente hasta que la
 * empresa la verifica, y esa verificacion es una transaccion en la red.
 */
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import { ponerPerfil } from '../estado.js';
import { RUBROS } from '../../lib/rubros.js';
import Pin from '../Pin.vue';

const props = defineProps({ token: { type: String, required: true } });

const invitacion = ref(null);   // { rol, empresa }
const error = ref('');
const datos = ref({ nombre: '', celular: '', rubro: 'alimentos', distrito: '' });
const pin = ref('');
const pin2 = ref('');
const trabajando = ref(false);
const aviso = ref('');

onMounted(async () => {
  try {
    invitacion.value = await api.verInvitacion(props.token);
  } catch (e) {
    error.value = e.message;
  }
});

async function registrar() {
  aviso.value = '';
  if (pin.value !== pin2.value) {
    aviso.value = 'Los dos PIN no son iguales. Escríbelos otra vez.';
    pin.value = '';
    pin2.value = '';
    return;
  }
  trabajando.value = true;
  try {
    const cuerpo = { invitacion: props.token, ...datos.value, pin: pin.value };
    await (invitacion.value.rol === 'comercio'
      ? api.registrarComercio(cuerpo)
      : api.registrarBeneficiario(cuerpo));
    await ponerPerfil(await api.sesion());
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
    <p v-if="error" class="aviso no" role="alert"><strong>No pudimos abrir la invitación</strong>{{ error }}</p>
    <p v-else-if="!invitacion" class="cargando">Abriendo la invitación…</p>

    <form v-else @submit.prevent="registrar">
      <h2>{{ invitacion.rol === 'comercio' ? 'Acepta vales en tu tienda' : 'Recibe tu vale de alimentos' }}</h2>
      <p>
        <b>{{ invitacion.empresa }}</b> te invitó.
        {{ invitacion.rol === 'comercio'
          ? 'Sin POS y sin comisión para ti.'
          : 'Después de registrarte, tu empresa te aprueba.' }}
      </p>

      <div class="campo">
        <label for="rn">{{ invitacion.rol === 'comercio' ? 'Nombre de la tienda' : 'Tu nombre' }}</label>
        <input id="rn" v-model="datos.nombre" :autocomplete="invitacion.rol === 'comercio' ? 'organization' : 'name'" required>
      </div>
      <template v-if="invitacion.rol === 'comercio'">
        <div class="campo">
          <label for="rr">¿Qué vendes más?</label>
          <select id="rr" v-model="datos.rubro">
            <option v-for="(n, clave) in RUBROS" :key="clave" :value="clave">{{ n }}</option>
          </select>
        </div>
        <div class="campo">
          <label for="rd">Distrito <span class="apagado">(si quieres)</span></label>
          <input id="rd" v-model="datos.distrito">
        </div>
      </template>
      <div class="campo">
        <label for="rc">Tu número de celular</label>
        <input id="rc" v-model="datos.celular" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="987 654 321" required>
        <p class="apagado pequeno" style="margin:4px 0 0">Con este número entrarás. No te enviaremos mensajes.</p>
      </div>
      <Pin v-model="pin" id="rp" etiqueta="Elige un PIN de 4 números" />
      <Pin v-model="pin2" id="rp2" etiqueta="Escríbelo otra vez" />
      <p class="apagado pequeno">No uses 1234 ni el mismo número repetido. No se lo digas a nadie.</p>

      <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
      <button class="principal" :disabled="trabajando || pin.length !== 4 || pin2.length !== 4">
        {{ trabajando ? 'Creando tu cuenta… tarda unos segundos' : 'Registrarme' }}
      </button>
    </form>
  </section>
</template>
