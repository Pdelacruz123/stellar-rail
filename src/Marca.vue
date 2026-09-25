<script setup>
/**
 * La marca: un simbolo simple (un riel que forma una "S") y el nombre.
 * Dibujado para este proyecto; sin logos de terceros.
 */
defineProps({
  tamano: { type: Number, default: 30 },
  soloSimbolo: { type: Boolean, default: false },
});
</script>

<template>
  <span class="marca">
    <svg
      class="marca-simbolo" :width="tamano" :height="tamano" viewBox="0 0 32 32"
      aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="var(--acento)" />
      <path d="M22 10.5h-8.2a3.2 3.2 0 000 6.4h4.4a3.2 3.2 0 010 6.4H10" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" />
      <circle cx="22.5" cy="10.5" r="1.9" fill="#fff" />
      <circle cx="9.5" cy="23.3" r="1.9" fill="#fff" />
    </svg>
    <span v-if="!soloSimbolo" class="marca-nombre">Stellar<b>Rail</b></span>
  </span>
</template>
