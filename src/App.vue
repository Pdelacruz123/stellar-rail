<script setup>
import { computed, onMounted, ref } from 'vue';
import { estado, arrancar } from './estado.js';
import Emisor from './views/Emisor.vue';
import Beneficiario from './views/Beneficiario.vue';
import Comercio from './views/Comercio.vue';

/**
 * Rutas por el hash de la URL. Sin router: no hace falta configurar nada en
 * el servidor, ni hay riesgo de que una ruta del navegador choque con /api.
 *
 *   #/unirse/<token>   entrar con una invitacion (lo resuelve estado.js)
 *   #/pagar/<codigo>   lo abre la camara del celular al escanear un QR de caja
 *   #/emisor, #/beneficiario, #/comercio   pestanas, solo para la empresa
 */
const VISTAS = {
  emisor: { titulo: 'Empresa', comp: Emisor },
  beneficiario: { titulo: 'Trabajador', comp: Beneficiario },
  comercio: { titulo: 'Comercio', comp: Comercio },
};

const leerRuta = () => window.location.hash.replace(/^#\/?/, '');
const ruta = ref(leerRuta());
window.addEventListener('hashchange', () => { ruta.value = leerRuta(); });

// Las plantillas de Vue no tienen acceso a `location`: solo a unos pocos
// globales. Hay que pasar por una funcion del componente.
const ir = (clave) => { window.location.hash = `#/${clave}`; };

const partes = computed(() => ruta.value.split('/'));
const codigoAPagar = computed(() => (partes.value[0] === 'pagar' ? partes.value[1] ?? '' : ''));

const rol = computed(() => estado.yo?.rol);
const esEmpresa = computed(() => rol.value === 'empresa');

/**
 * Un trabajador o un comercio solo ven su pantalla: nada de pestanas ni de
 * menus que no les sirven. La empresa ve las tres, para poder recorrer toda
 * la demostracion desde un solo dispositivo.
 */
const vista = computed(() => {
  if (rol.value === 'beneficiario') return 'beneficiario';
  if (rol.value === 'comercio') return 'comercio';
  if (partes.value[0] === 'pagar') return 'beneficiario';
  return VISTAS[partes.value[0]] ? partes.value[0] : 'emisor';
});

const subtitulo = computed(() => ({
  empresa: 'Vales de alimentación como activo de Stellar · red de pruebas',
  beneficiario: 'Tu vale de alimentación',
  comercio: 'Cobra con vales, sin POS',
}[rol.value] ?? ''));

onMounted(arrancar);
</script>

<template>
  <div class="envoltura">
    <header class="cabecera">
      <div>
        <h1>Rail</h1>
        <p class="apagado pequeno" style="margin:0">{{ subtitulo }}</p>
      </div>
    </header>

    <nav v-if="esEmpresa" class="roles" aria-label="Elegir pantalla">
      <button
        v-for="(v, clave) in VISTAS" :key="clave"
        :aria-current="vista === clave ? 'page' : undefined"
        @click="ir(clave)">
        {{ v.titulo }}
      </button>
    </nav>
    <p v-if="esEmpresa && vista !== 'emisor'" class="aviso espera pequeno">
      Estás viendo esta pantalla como la empresa, para probar todo desde aquí.
      En la vida real cada persona usa su propio celular: invítalas desde la
      pestaña Empresa.
    </p>

    <p v-if="estado.cargando" class="cargando">Cargando…</p>

    <div v-else-if="estado.error && !estado.yo" class="aviso no" role="alert">
      <strong>No se pudo conectar</strong>
      {{ estado.error }}
    </div>

    <template v-else>
      <div v-if="estado.error" class="aviso no" role="alert">{{ estado.error }}</div>
      <component :is="VISTAS[vista].comp" :codigo="codigoAPagar" />
    </template>

    <p v-if="esEmpresa" class="apagado pequeno" style="margin-top:28px">
      Cada acción queda en el libro público de Stellar y se comprueba con su hash.
      Personas y comercios son ficticios; la verificación de identidad es simulada.
    </p>
  </div>
</template>
