<script setup>
import {
  computed, onMounted, onUnmounted, ref,
} from 'vue';
import { api } from './api.js';
import {
  estado, arrancar, conSesion, ponerPerfil, recargar,
} from './estado.js';
import { leerDemo } from './demo.js';
import Marca from './Marca.vue';
import Emisor from './views/Emisor.vue';
import Beneficiario from './views/Beneficiario.vue';
import Comercio from './views/Comercio.vue';
import Portada from './views/Portada.vue';
import Demo from './views/Demo.vue';
import Registro from './views/Registro.vue';
import Restablecer from './views/Restablecer.vue';

/**
 * Rutas por el hash de la URL. Sin router: no hace falta configurar nada en
 * el servidor, ni hay riesgo de que una ruta del navegador choque con /api.
 *
 *   #/                    el sitio y el acceso, o la pantalla de quien entro
 *   #/demo                las cuentas de prueba: entrar con cualquiera
 *   #/unirse/<token>      registrarse con una invitacion
 *   #/restablecer/<token> poner un PIN nuevo
 *   #/pagar/<codigo>      QR fijo de una tienda: el trabajador escribe el monto
 *   #/cobro/<token>       QR con monto: el trabajador solo confirma
 *
 * Como cualquier pagina con cuentas: cada persona entra con la suya y ve solo
 * su pantalla. Para cambiar de persona, se sale y se entra con otra.
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

const VISTAS = { beneficiario: Beneficiario, comercio: Comercio };
const rol = computed(() => (conSesion() ? estado.yo.rol : null));
const esEmpresa = computed(() => rol.value === 'empresa');
const conPagina = computed(() => ['unirse', 'restablecer', 'demo'].includes(pagina.value));
const esPortada = computed(() => !estado.cargando && !rol.value && !conPagina.value);

async function salir(todas = false) {
  // Una cuenta de prueba vuelve a la lista de cuentas: asi se entra con otra.
  const aCuentas = estado.yo?.demo && leerDemo();
  await (todas ? api.cerrarTodas() : api.salir()).catch(() => {});
  await ponerPerfil(await api.sesion());
  window.location.hash = aCuentas ? '#/demo' : '#/';
}
const irA = (r) => { window.location.hash = r; };

// Trabajador y tienda miran de vez en cuando si la empresa ya los aprobo o
// les entrego el vale, sin tener que recargar la pagina.
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
  <Portada v-if="esPortada" />
  <!-- La empresa: panel con cabecera y pestanas. -->
  <Emisor v-else-if="esEmpresa && !conPagina" />

  <template v-else>
    <header class="app-barra">
      <div class="app-barra-dentro">
        <button class="sin-estilo" aria-label="StellarRail, ir al inicio" @click="irA('#/')"><Marca :tamano="28" /></button>
        <div v-if="rol" class="app-cuenta">
          <span class="app-quien">
            {{ estado.yo.nombre ?? estado.yo.identificador }}
            <span v-if="estado.yo.demo" class="insignia">Prueba</span>
          </span>
          <button class="suave chico" @click="salir()">Salir</button>
        </div>
      </div>
    </header>

    <!-- Trabajador y tienda: letra mas grande. En computadora, dos columnas;
         en celular, una. -->
    <main :class="['envoltura', { persona: rol }]">
      <Registro v-if="pagina === 'unirse'" :token="token" />
      <Restablecer v-else-if="pagina === 'restablecer'" :token="token" />
      <Demo v-else-if="pagina === 'demo'" />

      <p v-else-if="estado.cargando" class="cargando">Cargando…</p>

      <div v-else-if="estado.error && !estado.yo" class="aviso no" role="alert">
        <strong>No se pudo conectar</strong>
        {{ estado.error }}
      </div>

      <template v-else-if="rol">
        <div v-if="estado.error" class="aviso no" role="alert">{{ estado.error }}</div>
        <component :is="VISTAS[rol]" :codigo="codigoAPagar" :cobro="cobroAPagar" />
        <p class="pie-persona">
          <button class="enlace" @click="salir(true)">Cerrar sesión en todos mis dispositivos</button>
        </p>
      </template>
    </main>
  </template>
</template>
