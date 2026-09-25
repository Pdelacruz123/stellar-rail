<script setup>
/**
 * Las cuentas del espacio de prueba: quien es quien, con su celular y su
 * PIN, y un boton para entrar como cada una en este navegador.
 *
 * Es el "modo de prueba" del producto: los datos estan a la vista porque
 * son cuentas de ejemplo, en la red de pruebas.
 */
import { ref } from 'vue';
import { api } from './api.js';
import { ponerPerfil } from './estado.js';

const props = defineProps({
  demo: { type: Object, required: true },
  compacto: { type: Boolean, default: false },
});

const trabajando = ref('');
const aviso = ref('');

/** 987654321 -> "987 654 321" */
const celular = (c) => String(c).replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');

async function entrarComo(identificador, secreto, clave) {
  trabajando.value = clave;
  aviso.value = '';
  try {
    await ponerPerfil(await api.entrar(identificador, secreto));
    window.location.hash = '#/';
  } catch (e) {
    aviso.value = e.message;
  } finally {
    trabajando.value = '';
  }
}
</script>

<template>
  <div :class="['cuentas', { compacto }]">
    <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>

    <div class="cuenta">
      <div class="cuenta-cabeza">
        <div>
          <div class="nombre">{{ props.demo.empresa.nombre.replace(' (demostración)', '') }}</div>
          <div class="apagado pequeno">Empresa · Recursos Humanos</div>
        </div>
        <button class="suave chico" :disabled="Boolean(trabajando)"
                @click="entrarComo(props.demo.empresa.correo, props.demo.empresa.contrasena, 'empresa')">
          {{ trabajando === 'empresa' ? 'Entrando…' : 'Entrar' }}
        </button>
      </div>
      <dl class="datos">
        <dt>Correo</dt><dd><code>{{ props.demo.empresa.correo }}</code></dd>
        <dt>Contraseña</dt><dd><code>{{ props.demo.empresa.contrasena }}</code></dd>
      </dl>
    </div>

    <div v-for="p in props.demo.personas" :key="p.clave" class="cuenta">
      <div class="cuenta-cabeza">
        <div>
          <div class="nombre">{{ p.nombre }}</div>
          <div class="apagado pequeno">{{ p.perfil ?? (p.rol === 'comercio' ? 'Tienda' : 'Trabajador') }}</div>
        </div>
        <button class="suave chico" :disabled="Boolean(trabajando)" @click="entrarComo(p.celular, p.pin, p.clave)">
          {{ trabajando === p.clave ? 'Entrando…' : 'Entrar' }}
        </button>
      </div>
      <dl class="datos">
        <dt>Celular</dt><dd><code>{{ celular(p.celular) }}</code></dd>
        <dt>PIN</dt><dd><code>{{ p.pin }}</code></dd>
        <template v-if="p.tarjeta"><dt>Tarjeta</dt><dd><code>{{ p.tarjeta }}</code></dd></template>
      </dl>
    </div>
  </div>
</template>
