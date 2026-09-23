<script setup>
import { computed, onMounted, ref } from 'vue';
import { estado, arrancar } from './estado.js';
import Emisor from './views/Emisor.vue';
import Beneficiario from './views/Beneficiario.vue';
import Comercio from './views/Comercio.vue';

/**
 * Cambio de vista por el hash de la URL (#/emisor). Sin router: son tres
 * pantallas y asi no hace falta configurar nada en el servidor, ni que una
 * ruta del navegador choque con /api.
 */
const VISTAS = {
  emisor: { titulo: 'Emisor', sub: 'la empresa', comp: Emisor },
  beneficiario: { titulo: 'Beneficiario', sub: 'el trabajador', comp: Beneficiario },
  comercio: { titulo: 'Comercio', sub: 'la bodega', comp: Comercio },
};

const leerRuta = () => window.location.hash.replace('#/', '') || 'emisor';
const ruta = ref(leerRuta());
window.addEventListener('hashchange', () => { ruta.value = leerRuta(); });

// Las plantillas de Vue no tienen acceso a `location`: solo a un conjunto
// limitado de globales. Hay que pasar por una funcion del componente.
const ir = (clave) => { window.location.hash = '#/' + clave; };

const actual = computed(() => VISTAS[ruta.value] ?? VISTAS.emisor);

onMounted(arrancar);
</script>

<template>
  <div class="envoltura">
    <header class="cabecera">
      <div>
        <h1>Rail</h1>
        <p class="apagado pequeno" style="margin:0">
          Vales de alimentación como activo de Stellar · Testnet
        </p>
      </div>
      <p v-if="estado.config" class="apagado pequeno" style="margin:0">
        Activo <strong>{{ estado.config.activo }}</strong> · 1 {{ estado.config.activo }} = S/ 1
      </p>
    </header>

    <nav class="roles" aria-label="Elegir vista">
      <button
        v-for="(v, clave) in VISTAS" :key="clave"
        :aria-current="ruta === clave ? 'page' : undefined"
        @click="ir(clave)">
        {{ v.titulo }} <span class="apagado">· {{ v.sub }}</span>
      </button>
    </nav>

    <p v-if="estado.cargando" class="cargando">Cargando…</p>

    <div v-else-if="estado.error && !estado.config" class="aviso no" role="alert">
      <strong>No se pudo conectar</strong>
      {{ estado.error }}
    </div>

    <template v-else>
      <div v-if="estado.error" class="aviso no" role="alert">{{ estado.error }}</div>
      <component :is="actual.comp" />
    </template>

    <p class="apagado pequeno" style="margin-top:28px">
      Cada acción queda en el libro público de Stellar y se comprueba con su hash.
      Personas y comercios son ficticios; la verificación de identidad es simulada.
    </p>
  </div>
</template>
