<script setup>
import { computed, ref, watch } from 'vue';
import { api, saldoEnLaRed } from '../api.js';
import { estado, accion, soles } from '../estado.js';
import Prueba from '../Prueba.vue';

const elegido = ref(null);
const nombre = ref('');
const trabajando = ref('');

const pago = ref({ codigo: '', monto: '' });
const resultado = ref(null);

const yo = computed(() => estado.beneficiarios.find((b) => b.id === elegido.value) ?? null);
const afiliados = computed(() => estado.comercios.filter((c) => c.estado === 'verificado'));

// Si solo hay uno, no tiene sentido pedir que elija.
watch(() => estado.beneficiarios, (lista) => {
  if (elegido.value === null && lista.length) elegido.value = lista[0].id;
}, { immediate: true, deep: true });

// El saldo se lee de Horizon cada vez. Nunca lo guardamos.
const enLaRed = ref(null);
async function cargarSaldo() {
  if (!yo.value || !estado.config) { enLaRed.value = null; return; }
  const { horizon, activo, emisor } = estado.config;
  enLaRed.value = await saldoEnLaRed(horizon, yo.value.cuenta_publica, activo, emisor);
}
watch([yo, () => estado.eventos.length], cargarSaldo, { immediate: true });

async function registrarme() {
  trabajando.value = 'registro';
  try {
    const r = await accion(() => api.registrarBeneficiario(nombre.value.trim()));
    elegido.value = r.beneficiario.id;
    nombre.value = '';
  } finally {
    trabajando.value = '';
  }
}

async function pagarAhora() {
  trabajando.value = 'pago';
  resultado.value = null;
  try {
    const r = await accion(() => api.pagar({
      beneficiarioId: yo.value.id,
      codigo: pago.value.codigo.trim(),
      monto: pago.value.monto,
    }));
    resultado.value = r;
    if (r.pagado) pago.value = { codigo: '', monto: '' };
    await cargarSaldo();
  } catch {
    // El mensaje ya quedo en estado.error y lo muestra App.vue.
  } finally {
    trabajando.value = '';
  }
}
</script>

<template>
  <!-- Registro. Un solo campo: el nombre. -->
  <section v-if="!estado.beneficiarios.length" class="tarjeta">
    <h2>Recibe tu vale de alimentación</h2>
    <p class="apagado pequeno">
      Regístrate y la empresa revisará tu solicitud. No necesitas instalar
      nada ni tener saldo previo.
    </p>
    <form @submit.prevent="registrarme">
      <div class="campo">
        <label for="nom">Tu nombre</label>
        <input id="nom" v-model="nombre" required placeholder="María Quispe">
      </div>
      <button :disabled="trabajando === 'registro' || !nombre.trim()">
        {{ trabajando === 'registro' ? 'Registrando…' : 'Registrarme' }}
      </button>
    </form>
  </section>

  <template v-else>
    <section class="tarjeta">
      <div class="campo" v-if="estado.beneficiarios.length > 1">
        <label for="quien">Estás viendo a</label>
        <select id="quien" v-model="elegido">
          <option v-for="b in estado.beneficiarios" :key="b.id" :value="b.id">{{ b.nombre }}</option>
        </select>
      </div>

      <template v-if="yo">
        <h2>Hola, {{ yo.nombre }}</h2>

        <div v-if="yo.estado === 'pendiente'" class="aviso espera">
          <strong>Tu registro está en revisión</strong>
          Cuando la empresa te apruebe podrás recibir y usar tu vale.
        </div>
        <div v-else-if="yo.estado === 'rechazado'" class="aviso no">
          <strong>Tu registro fue rechazado</strong>
          Consulta con Recursos Humanos.
        </div>

        <div v-if="enLaRed" class="cifras">
          <div class="cifra">
            <b>{{ soles(enLaRed.saldo) }}</b>
            <span>Tu vale{{ enLaRed.congelado ? ' (congelado)' : '' }}</span>
          </div>
          <div class="cifra">
            <b>{{ afiliados.length }}</b>
            <span>Dónde usarlo</span>
          </div>
        </div>
        <p v-else class="cargando">Consultando la red…</p>

        <p v-if="enLaRed?.congelado" class="aviso no">
          <strong>Tu vale está congelado</strong>
          El programa venció. La red ya no permite mover este saldo.
        </p>
      </template>
    </section>

    <section v-if="yo" class="tarjeta">
      <h2>Dónde usarlo</h2>
      <p v-if="!afiliados.length" class="apagado pequeno">
        Todavía no hay comercios afiliados a tu programa.
      </p>
      <div v-for="c in afiliados" :key="c.id" class="fila">
        <div>
          <div class="nombre">{{ c.nombre }}</div>
          <div class="apagado pequeno">
            <template v-if="c.distrito">{{ c.distrito }} · </template>
            código {{ c.codigo_corto }}
          </div>
        </div>
        <button class="suave chico" @click="pago.codigo = c.codigo_corto">Usar este</button>
      </div>
    </section>

    <section v-if="yo" class="tarjeta">
      <h2>Pagar</h2>
      <p class="apagado pequeno">
        Escanea el QR de la caja o escribe el código de 6 dígitos que muestra
        el comercio.
      </p>
      <form @submit.prevent="pagarAhora">
        <div class="pareja">
          <div class="campo">
            <label for="cod">Código del comercio</label>
            <input id="cod" v-model="pago.codigo" inputmode="numeric" maxlength="6"
                   placeholder="000000" required>
          </div>
          <div class="campo">
            <label for="mon">Monto (S/)</label>
            <input id="mon" v-model="pago.monto" type="number" min="0.1" step="0.5"
                   placeholder="18.50" required>
          </div>
        </div>
        <button :disabled="trabajando === 'pago' || yo.estado !== 'verificado'">
          {{ trabajando === 'pago' ? 'Enviando…' : 'Pagar' }}
        </button>
        <p v-if="yo.estado !== 'verificado'" class="apagado pequeno" style="margin-top:8px">
          Necesitas estar verificado para pagar.
        </p>
      </form>

      <!--
        El resultado del rechazo se muestra igual de claro que el del exito.
        No lo decidio nuestro codigo: lo decidio la red, y por eso lleva
        su hash comprobable.
      -->
      <div v-if="resultado" :class="['aviso', resultado.pagado ? 'ok' : 'no']" role="status">
        <template v-if="resultado.pagado">
          <strong>Pago confirmado</strong>
          Se pagó a {{ resultado.comercio.nombre }}. Confirmado en segundos.
        </template>
        <template v-else>
          <strong>{{ resultado.transaccion.mensaje }}</strong>
          El pago no se hizo y tu saldo no cambió. Lo rechazó la red, no esta aplicación.
        </template>
        <Prueba :tx="resultado.transaccion" />
      </div>
    </section>
  </template>
</template>
