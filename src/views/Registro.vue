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
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { conSesion, estado, ponerPerfil } from '../estado.js';
import { RUBROS } from '../../lib/rubros.js';
import { REGLA_PIN, pinValido, problemaDelPin } from '../../lib/reglas.js';
import Pin from '../Pin.vue';

const props = defineProps({ token: { type: String, required: true } });

const invitacion = ref(null);   // { rol, empresa }
const error = ref('');
const datos = ref({ nombre: '', celular: '', rubro: 'alimentos', distrito: '' });
const pin = ref('');
const pin2 = ref('');
const trabajando = ref(false);
const aviso = ref('');
const problema = computed(() => problemaDelPin(pin.value, pin2.value));
const sePuede = computed(() => pinValido(pin.value) && pin.value === pin2.value);

// Registrarse inicia la sesion de la persona nueva. Si en este equipo hay
// otra cuenta abierta, se avisa y se ofrece salir primero: nunca se cambia de
// cuenta en silencio.
const otraCuenta = computed(() => (conSesion()
  ? estado.yo.nombre ?? estado.yo.empresa?.replace(' (demostración)', '') ?? estado.yo.identificador
  : ''));
async function salirYContinuar() {
  await api.salir().catch(() => {});
  await ponerPerfil(await api.sesion());
}

onMounted(async () => {
  try {
    invitacion.value = await api.verInvitacion(props.token);
  } catch (e) {
    error.value = e.message;
  }
});

async function registrar() {
  aviso.value = '';
  if (!sePuede.value) return;
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

    <div v-else-if="otraCuenta" class="aviso espera" role="alert">
      <strong>En este equipo está abierta la cuenta de {{ otraCuenta }}</strong>
      Para registrarte con esta invitación, primero hay que salir de esa cuenta.
      <div class="acciones" style="margin-top:10px">
        <button class="si" @click="salirYContinuar">Salir y continuar</button>
      </div>
    </div>

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
      <p class="apagado pequeno" style="margin-bottom:6px">Tu PIN: {{ REGLA_PIN }} No se lo digas a nadie.</p>
      <Pin v-model="pin" id="rp" etiqueta="Elige un PIN de 4 números" />
      <Pin v-model="pin2" id="rp2" etiqueta="Escríbelo otra vez" />
      <p v-if="problema" class="aviso espera" role="status">{{ problema }}</p>

      <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
      <button class="principal" :disabled="trabajando || !sePuede">
        {{ trabajando ? 'Creando tu cuenta… tarda unos segundos' : 'Registrarme' }}
      </button>
    </form>
  </section>
</template>
