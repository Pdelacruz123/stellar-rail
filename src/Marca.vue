<script setup>
/**
 * La marca: el logo y el nombre.
 *
 * El logo sale de un solo archivo, `public/logo.svg`. Para poner el logo
 * definitivo basta con reemplazar ese archivo; no hay que tocar codigo.
 */
defineProps({
  tamano: { type: Number, default: 32 },
  soloSimbolo: { type: Boolean, default: false },
});
</script>

<template>
  <span class="marca">
    <img class="marca-simbolo" src="/logo.svg" :width="tamano" :height="tamano" alt="">
    <span v-if="!soloSimbolo" class="marca-nombre">StellarRail</span>
  </span>
</template>
