<script setup>
/**
 * La portada: para quien todavia no entro.
 *
 * Arriba, la demostracion en un clic, para quien quiere probarlo ya. Debajo,
 * las tres entradas, cada una con el acceso que corresponde a su riesgo:
 *  - la empresa, con correo y contrasena: maneja el dinero de todos;
 *  - trabajador y tienda, con su celular y un PIN de 4 numeros, que es lo
 *    que alguien que no se maneja con la tecnologia puede recordar.
 */
import { computed, nextTick, ref } from 'vue';
import { api } from '../api.js';
import { ponerPerfil } from '../estado.js';
import { crearDemo, leerDemo } from '../demo.js';
import Icono from '../Icono.vue';
import Pin from '../Pin.vue';

const puerta = ref(null);   // null | 'empresa' | 'trabajador' | 'tienda' | 'nueva'
const identificador = ref('');
const secreto = ref('');
const empresaNueva = ref({ nombre: '', correo: '', contrasena: '' });
const trabajando = ref(false);
const aviso = ref('');
const primerCampo = ref(null);
const hayDemo = computed(() => Boolean(leerDemo()));

// Si llego desde un QR de pago sin haber entrado, se lo explicamos.
const vieneDePagar = /^#\/(pagar|cobro)\//.test(window.location.hash);

async function abrir(cual) {
  puerta.value = cual;
  aviso.value = '';
  identificador.value = '';
  secreto.value = '';
  await nextTick();
  primerCampo.value?.focus();
}

async function probarDemo() {
  trabajando.value = true;
  aviso.value = '';
  try {
    await crearDemo();
    await ponerPerfil(await api.sesion());
    window.location.hash = '#/demo';
  } catch (e) {
    aviso.value = e.message;
  } finally {
    trabajando.value = false;
  }
}

async function entrar() {
  aviso.value = '';
  trabajando.value = true;
  try {
    await ponerPerfil(await api.entrar(identificador.value, secreto.value));
    // Si venia de un QR de pago, se queda en ese enlace: el pago sigue solo.
    if (!vieneDePagar) window.location.hash = '#/';
  } catch (e) {
    aviso.value = e.message;
    secreto.value = '';
  } finally {
    trabajando.value = false;
  }
}

async function registrarEmpresa() {
  aviso.value = '';
  trabajando.value = true;
  try {
    await ponerPerfil(await api.registrarEmpresa(empresaNueva.value));
    window.location.hash = '#/';
  } catch (e) {
    aviso.value = e.message;
  } finally {
    trabajando.value = false;
  }
}

const verDemo = () => { window.location.hash = '#/demo'; };

const TITULOS = {
  empresa: 'Entrar como empresa',
  trabajador: 'Entrar como trabajador',
  tienda: 'Entrar como tienda',
  nueva: 'Registrar mi empresa',
};
</script>

<template>
  <section v-if="!puerta" class="tarjeta portada">
    <p v-if="vieneDePagar" class="aviso espera">
      <strong>Para pagar, primero entra</strong>
      Toca «Soy trabajador» y escribe tu celular y tu PIN.
    </p>
    <h2>Vales de alimentos que se pagan con el celular</h2>
    <p>
      La empresa entrega el vale, el trabajador paga en las bodegas afiliadas
      con un QR o con una tarjeta, y la red Stellar rechaza cualquier pago a
      una tienda no afiliada.
    </p>

    <div class="demo-caja">
      <h3>¿Quieres verlo funcionar?</h3>
      <p class="apagado">
        Crea en un clic una empresa de prueba con dos trabajadores y tres
        tiendas. Te mostramos el celular y el PIN de cada uno.
      </p>
      <button class="principal" :disabled="trabajando" @click="probarDemo">
        <Icono nombre="check" :tamano="26" />
        {{ trabajando ? 'Preparando… tarda unos segundos' : 'Probar la demostración' }}
      </button>
      <button v-if="hayDemo && !trabajando" class="enlace" @click="verDemo">
        Ver la demostración que ya creé
      </button>
      <p class="apagado pequeno">Todo ocurre en la red de pruebas de Stellar: no se usa dinero real.</p>
    </div>
    <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>

    <h3 style="margin-top:22px">Entrar</h3>
    <div class="puertas">
      <button class="puerta" @click="abrir('trabajador')">
        <Icono nombre="moneda" :tamano="30" />
        <span><b>Soy trabajador</b><small>Con tu celular y tu PIN</small></span>
      </button>
      <button class="puerta" @click="abrir('tienda')">
        <Icono nombre="tienda" :tamano="30" />
        <span><b>Tengo una tienda</b><small>Con tu celular y tu PIN</small></span>
      </button>
      <button class="puerta" @click="abrir('empresa')">
        <Icono nombre="teclado" :tamano="30" />
        <span><b>Soy empresa</b><small>Con tu correo y tu contraseña</small></span>
      </button>
    </div>
  </section>

  <section v-else class="tarjeta">
    <button class="enlace atras" @click="puerta = null"><Icono nombre="atras" /> Atrás</button>
    <h2>{{ TITULOS[puerta] }}</h2>

    <!-- Trabajador o tienda: celular + PIN -->
    <form v-if="puerta === 'trabajador' || puerta === 'tienda'" @submit.prevent="entrar">
      <div class="campo">
        <label for="cel" class="pregunta">Tu número de celular</label>
        <input
          id="cel" ref="primerCampo" v-model="identificador" class="numero-grande"
          type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="987 654 321" required>
      </div>
      <Pin v-model="secreto" id="pin-entrar" />
      <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
      <button class="principal" :disabled="trabajando || secreto.length !== 4">
        {{ trabajando ? 'Entrando…' : 'Entrar' }}
      </button>
      <p class="apagado pequeno" style="margin-top:12px">
        ¿Olvidaste tu PIN? Pide a tu empresa un enlace para poner uno nuevo.
        ¿Todavía no tienes cuenta? Tu empresa te envía una invitación.
      </p>
    </form>

    <!-- Empresa: correo + contrasena -->
    <form v-else-if="puerta === 'empresa'" @submit.prevent="entrar">
      <div class="campo">
        <label for="correo">Correo</label>
        <input id="correo" ref="primerCampo" v-model="identificador" type="email" autocomplete="username" required>
      </div>
      <div class="campo">
        <label for="clave">Contraseña</label>
        <input id="clave" v-model="secreto" type="password" autocomplete="current-password" required>
      </div>
      <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
      <button class="principal" :disabled="trabajando">{{ trabajando ? 'Entrando…' : 'Entrar' }}</button>
      <button type="button" class="enlace" @click="abrir('nueva')">¿Tu empresa es nueva? Regístrala</button>
    </form>

    <!-- Empresa nueva -->
    <form v-else @submit.prevent="registrarEmpresa">
      <div class="campo">
        <label for="en">Nombre de la empresa</label>
        <input id="en" ref="primerCampo" v-model="empresaNueva.nombre" autocomplete="organization" required>
      </div>
      <div class="campo">
        <label for="ec">Correo de Recursos Humanos</label>
        <input id="ec" v-model="empresaNueva.correo" type="email" autocomplete="username" required>
      </div>
      <div class="campo">
        <label for="ep">Contraseña <span class="apagado">(al menos 8 caracteres)</span></label>
        <input id="ep" v-model="empresaNueva.contrasena" type="password" autocomplete="new-password" minlength="8" required>
      </div>
      <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
      <button class="principal" :disabled="trabajando">{{ trabajando ? 'Creando…' : 'Crear mi empresa' }}</button>
      <p class="apagado pequeno" style="margin-top:12px">
        Es una red de pruebas: no pedimos datos reales ni verificamos el correo.
      </p>
    </form>
  </section>
</template>
