<script setup>
import {
  computed, onMounted, onUnmounted, ref, watch,
} from 'vue';
import { api } from './api.js';
import {
  estado, arrancar, conSesion, ponerPerfil, recargar,
} from './estado.js';
import { cercano, enMarco } from './marco.js';
import Marca from './Marca.vue';
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
 *   #/                    el sitio y el acceso, o la pantalla de quien entro
 *   #/tres                vista en vivo del espacio de prueba
 *   #/demo                cuentas del espacio de prueba
 *   #/unirse/<token>      registrarse con una invitacion
 *   #/restablecer/<token> poner un PIN nuevo
 *   #/pagar/<codigo>      QR fijo de una tienda: el trabajador escribe el monto
 *   #/cobro/<token>       QR con monto: el trabajador solo confirma
 *
 * Cada persona ve solo su pantalla: la empresa, la suya; el trabajador y la
 * tienda, la suya.
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
const conPagina = computed(() => ['unirse', 'restablecer', 'demo'].includes(pagina.value));
const esPortada = computed(() => !estado.cargando && !rol.value && !enMarco && !conPagina.value);

const quien = computed(() => ({
  empresa: estado.yo?.empresa?.replace(' (demostración)', '') ?? 'Empresa',
  beneficiario: estado.yo?.nombre ?? '',
  comercio: estado.yo?.nombre ?? '',
}[rol.value] ?? ''));

async function salir(todas = false) {
  await (todas ? api.cerrarTodas() : api.salir()).catch(() => {});
  await ponerPerfil(await api.sesion());
  window.location.hash = '#/';
}
const irA = (r) => { window.location.hash = r; };

// Otra pantalla de la vista en vivo cambio algo: se recargan los datos.
watch(() => cercano.cambios, () => { recargar().catch(() => {}); });

// Fuera de la vista en vivo, trabajador y tienda miran de vez en cuando si
// la empresa ya los aprobo o les entrego el vale, sin tener que recargar.
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
  <Portada v-else-if="esPortada" />
  <!-- La empresa trabaja en computadora: panel a pantalla completa, con su barra lateral. -->
  <Emisor v-else-if="esEmpresa && !conPagina" />

  <template v-else>
    <header :class="['app-barra', { 'app-barra-movil': !esEmpresa }]">
      <div class="app-barra-dentro">
        <button class="sin-estilo" aria-label="StellarRail, ir al inicio" @click="irA('#/')"><Marca :tamano="28" /></button>
        <div v-if="rol" class="app-cuenta">
          <span class="app-quien">
            {{ quien }}
            <span v-if="estado.yo.demo" class="insignia">Prueba</span>
          </span>
          <button v-if="!enMarco" class="suave chico" @click="salir()">Salir</button>
        </div>
      </div>
    </header>

    <!-- Letra mas grande para trabajador y tienda: la usan en la calle, de pie. -->
    <div :class="['envoltura', { sencillo: !esEmpresa }]">
      <Registro v-if="pagina === 'unirse'" :token="token" />
      <Restablecer v-else-if="pagina === 'restablecer'" :token="token" />
      <Demo v-else-if="pagina === 'demo' && !enMarco" />

      <p v-else-if="estado.cargando" class="cargando">Cargando…</p>

      <div v-else-if="estado.error && !estado.yo" class="aviso no" role="alert">
        <strong>No se pudo conectar</strong>
        {{ estado.error }}
      </div>

      <div v-else-if="!rol" class="aviso espera" role="alert">
        <strong>Tu sesión se cerró</strong>
        Vuelve a entrar con tu celular y tu PIN.
      </div>

      <template v-else>
        <div v-if="estado.error" class="aviso no" role="alert">{{ estado.error }}</div>
        <component :is="VISTAS[rol]" :codigo="codigoAPagar" :cobro="cobroAPagar" />
        <p v-if="!enMarco" style="margin-top:28px">
          <button class="enlace" @click="salir(true)">Cerrar sesión en todos mis dispositivos</button>
        </p>
      </template>
    </div>
  </template>
</template>
