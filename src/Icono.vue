<script setup>
/**
 * Iconos simples, dibujados para este proyecto.
 *
 * Siempre acompanan a una palabra, nunca la reemplazan: un icono solo no lo
 * entiende todo el mundo, pero junto al texto ayuda a quien lee con
 * dificultad a encontrar el boton correcto de un vistazo.
 */
defineProps({
  nombre: { type: String, required: true },
  tamano: { type: Number, default: 24 },
});

const TRAZOS = {
  camara: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18h2"/>',
  teclado: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  tienda: '<path d="M4 10h16M5 10l1.5-5h11L19 10M6 10v9h12v-9M10 19v-5h4v5"/>',
  altavoz: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>',
  imprimir: '<path d="M7 9V4h10v5M7 17H5a1 1 0 01-1-1v-6a1 1 0 011-1h14a1 1 0 011 1v6a1 1 0 01-1 1h-2"/><rect x="7" y="14" width="10" height="6"/>',
  reloj: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  atras: '<path d="M15 5l-7 7 7 7"/>',
  mensaje: '<path d="M5 18l1.2-3.6A7 7 0 1112 19a7 7 0 01-3.4-.9z"/>',
  copiar: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 011-1h9"/>',
  moneda: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.8-2.5 1.8s1 1.5 2.5 1.8 2.5.8 2.5 1.9-1.1 1.9-2.5 1.9c-1.1 0-2-.4-2.5-1.2M12 7v1.3M12 15.7V17"/>',
};
</script>

<template>
  <svg
    :width="tamano" :height="tamano" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false" class="icono" v-html="TRAZOS[nombre]" />
</template>
