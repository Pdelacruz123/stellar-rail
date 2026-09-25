<script setup>
import {
  computed, onMounted, onUnmounted, ref, watch,
} from 'vue';
import { api } from './api.js';
import {
  estado, arrancar, conSesion, ponerPerfil, recargar,
} from './estado.js';
import { cercano, enMarco } from './marco.js';
import Emisor from './views/Emisor.vue';
import Beneficiario from './views/Beneficiario.vue';
import Comercio from './views/Comercio.vue';
import Portada from './views/Portada.vue';
import Demo from './views/Demo.vue';
import Tres from './views/Tres.vue';
import Registro from './views/Registro.vue';
import Restablecer from './views/Restablecer.vue';

/**
 * Rutas por el hash de la URL. Sin router: no hace falta configurar nada en
 * el servidor, ni hay riesgo de que una ruta del navegador choque con /api.
 *
 *   #/                    portada, o la pantalla de quien entro
 *   #/demo                la demostracion creada: quien es quien
 *   #/tres                empresa, tienda y trabajador lado a lado
 *   #/unirse/<token>      registrarse con una invitacion
 *   #/restablecer/<token> poner un PIN nuevo
 *   #/pagar/<codigo>      QR fijo de una tienda: el trabajador escribe el monto
 *   #/cobro/<token>       QR con monto: el trabajador solo confirma
 *
 * Cada persona ve solo su pantalla: la empresa, la suya; el trabajador y la
 * tienda, la suya. Nada de pestanas para "ver como" otro.
 */
const leerRuta = () => window.location.hash.replace(/^#\/?/, '');
const ruta = ref(leerRuta());
const alCambiarHash = () => { ruta.value = leerRuta(); };
window.addEventListener('hashchange', alCambiarHash);

const partes = computed(() => ruta.value.split('/'));
const pagina = computed(() => partes.value[0]);
const token = computed(() => partes.value.slice(1).join('/'));
const codigoAPagar = computed(() => (pagina.value === 'pagar' ? token.value : ''));
const cobroAPagar = computed(() => (pagina.value === 'cobro' ? token.value : ''));

const VISTAS = { empresa: Emisor, beneficiario: Beneficiario, comercio: Comercio };
const rol = computed(() => (conSesion() ? estado.yo.rol : null));
const esEmpresa = computed(() => rol.value === 'empresa');

const subtitulo = computed(() => ({
  empresa: estado.yo?.empresa ?? 'Empresa',
  beneficiario: 'Tu vale de alimentos',
  comercio: 'Cobra con vales, sin POS',
}[rol.value] ?? 'Vales de alimentos sobre Stellar · red de pruebas'));

async function salir(todas = false) {
  await (todas ? api.cerrarTodas() : api.salir()).catch(() => {});
  await ponerPerfil(await api.sesion());
  window.location.hash = '#/';
}

// Otra pantalla de la vista triple cambio algo: se recargan los datos.
watch(() => cercano.cambios, () => { recargar().catch(() => {}); });

// Fuera de la vista triple, trabajador y tienda miran de vez en cuando si la
// empresa ya los aprobo o les entrego el vale, sin tener que recargar.
let reloj = null;
onMounted(() => {
  arrancar();
  reloj = setInterval(() => {
    if (!document.hidden && conSesion() && !esEmpresa.value) recargar().catch(() => {});
  }, 20000);
});
onUnmounted(() => {
  clearInterval(reloj);
  window.removeEventListener('hashchange', alCambiarHash);
});
</script>

<template>
  <Tres v-if="pagina === 'tres' && !enMarco" />

  <!-- Letra mas grande para trabajador y tienda: la usan en la calle, de pie. -->
  <div v-else :class="['envoltura', { sencillo: !esEmpresa }]">
    <header class="cabecera">
      <div>
        <h1>StellarRail</h1>
        <p class="apagado pequeno" style="margin:0">{{ subtitulo }}</p>
      </div>
      <div v-if="rol && !enMarco" class="acciones">
        <span class="apagado pequeno quien">{{ estado.yo.nombre ?? estado.yo.identificador }}</span>
        <button class="suave chico" @click="salir()">Salir</button>
      </div>
    </header>

    <p v-if="esEmpresa && estado.yo.demo && !enMarco" class="aviso espera pequeno">
      Estás en una empresa de demostración.
      <a href="#/demo">Ver los accesos de cada persona</a> ·
      <a href="#/tres">Abrir las tres pantallas</a>
    </p>

    <Registro v-if="pagina === 'unirse'" :token="token" />
    <Restablecer v-else-if="pagina === 'restablecer'" :token="token" />
    <Demo v-else-if="pagina === 'demo' && !enMarco" />

    <p v-else-if="estado.cargando" class="cargando">Cargando…</p>

    <div v-else-if="estado.error && !estado.yo" class="aviso no" role="alert">
      <strong>No se pudo conectar</strong>
      {{ estado.error }}
    </div>

    <div v-else-if="!rol && enMarco" class="aviso espera" role="alert">
      <strong>Esta sesión se cerró</strong>
      Pasa si se cambió el PIN o se cerró la sesión en todos los dispositivos.
      Vuelve a la demostración y entra otra vez.
    </div>

    <Portada v-else-if="!rol" />

    <template v-else>
      <div v-if="estado.error" class="aviso no" role="alert">{{ estado.error }}</div>
      <component :is="VISTAS[rol]" :codigo="codigoAPagar" :cobro="cobroAPagar" />
      <p v-if="!enMarco" style="margin-top:28px">
        <button class="enlace" @click="salir(true)">Cerrar sesión en todos mis dispositivos</button>
      </p>
    </template>

    <p v-if="esEmpresa" class="apagado pequeno" style="margin-top:12px">
      Cada acción queda en el libro público de Stellar y se comprueba con su hash.
      Personas y comercios son ficticios; la verificación de identidad es simulada.
    </p>
  </div>
</template>
