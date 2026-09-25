<script setup>
/**
 * Las cuentas de prueba creadas en este navegador. Se entra con cualquiera,
 * como en cualquier pagina con cuentas; para cambiar de persona, se sale y
 * se entra con otra.
 */
import { leerDemo } from '../demo.js';
import CuentasDePrueba from '../CuentasDePrueba.vue';

const demo = leerDemo();
const irA = (ruta) => { window.location.hash = ruta; };
</script>

<template>
  <section v-if="!demo" class="tarjeta pagina-angosta">
    <h1>No hay cuentas de prueba en este navegador</h1>
    <p>Créalas desde el inicio con «Probar la demostración».</p>
    <button class="principal" @click="irA('#/')">Ir al inicio</button>
  </section>

  <div v-else class="pagina-angosta">
    <h1>Cuentas de prueba</h1>
    <p class="apagado">
      {{ demo.empresa.nombre.replace(' (demostración)', '') }}, con dos trabajadoras y tres
      tiendas. Entra con cualquiera; para cambiar de persona, sal y entra con otra.
    </p>
    <section class="tarjeta">
      <CuentasDePrueba :demo="demo" />
    </section>
    <p v-if="demo.transaccion?.explorador" class="apagado pequeno">
      Las cinco cuentas se crearon en una sola operación en la red de pruebas de Stellar:
      <a :href="demo.transaccion.explorador" target="_blank" rel="noopener">ver comprobante</a>.
    </p>
  </div>
</template>
