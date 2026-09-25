<script setup>
/**
 * Las cuentas del espacio de prueba creado en este navegador.
 */
import { leerDemo } from '../demo.js';
import CuentasDePrueba from '../CuentasDePrueba.vue';
import Icono from '../Icono.vue';

const demo = leerDemo();
const irA = (ruta) => { window.location.hash = ruta; };
</script>

<template>
  <section v-if="!demo" class="tarjeta">
    <h2>No hay un espacio de prueba en este navegador</h2>
    <button class="principal" @click="irA('#/')">Ir al inicio</button>
  </section>

  <template v-else>
    <section class="tarjeta">
      <div class="fila" style="border:none;padding:0">
        <div>
          <h2 style="margin:0">Cuentas de prueba</h2>
          <p class="apagado pequeno" style="margin:0">{{ demo.empresa.nombre.replace(' (demostración)', '') }} · red de pruebas</p>
        </div>
        <button class="si" @click="irA('#/tres')"><Icono nombre="qr" /> Vista en vivo</button>
      </div>
    </section>
    <section class="tarjeta">
      <CuentasDePrueba :demo="demo" />
      <p v-if="demo.transaccion?.explorador" class="apagado pequeno" style="margin-top:12px">
        Las cinco cuentas se crearon en una sola transacción:
        <a :href="demo.transaccion.explorador" target="_blank" rel="noopener">ver comprobante</a>.
      </p>
    </section>
  </template>
</template>
