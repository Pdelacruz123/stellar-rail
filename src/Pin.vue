<script setup>
/**
 * Campo para el PIN de 4 numeros.
 *
 * Con teclado en pantalla y teclas grandes: en la tienda, el cliente marca
 * su PIN en el equipo del bodeguero, quiza sin saber usarlo. Tambien se
 * puede escribir con el teclado del equipo. Los numeros nunca se muestran.
 */
import { ref } from 'vue';

const modelo = defineModel({ type: String, default: '' });
defineProps({
  etiqueta: { type: String, default: 'Tu PIN de 4 números' },
  id: { type: String, default: 'pin' },
  teclado: { type: Boolean, default: false },
  // En el equipo de la tienda la etiqueta va grande: el cliente la lee de
  // pie, quiza sin lentes. En un formulario, igual que las demas etiquetas.
  destacado: { type: Boolean, default: false },
});

const campo = ref(null);
const limpiar = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 4);
const alEscribir = (e) => { modelo.value = limpiar(e.target.value); };
const pulsar = (d) => { modelo.value = limpiar(modelo.value + d); };
const borrar = () => { modelo.value = modelo.value.slice(0, -1); };

defineExpose({ enfocar: () => campo.value?.focus() });
</script>

<template>
  <div class="pin">
    <label :for="id" :class="{ pregunta: destacado }">{{ etiqueta }}</label>
    <input
      :id="id" ref="campo" :value="modelo" class="numero-grande" type="password"
      inputmode="numeric" maxlength="4" autocomplete="off" pattern="\d{4}"
      placeholder="••••" @input="alEscribir">
    <div v-if="teclado" class="teclado" role="group" aria-label="Teclado numérico">
      <button v-for="d in ['1','2','3','4','5','6','7','8','9']" :key="d" type="button" @click="pulsar(d)">{{ d }}</button>
      <button type="button" class="suave" aria-label="Borrar el último número" @click="borrar">Borrar</button>
      <button type="button" @click="pulsar('0')">0</button>
      <span />
    </div>
  </div>
</template>
