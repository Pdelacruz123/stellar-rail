<script setup>
import { computed, ref, watch } from 'vue';
import QRCode from 'qrcode';
import { api, saldoEnLaRed } from '../api.js';
import { estado, accion, soles } from '../estado.js';

const elegido = ref(null);
const nuevo = ref({ nombre: '', distrito: '', telefono: '' });
const trabajando = ref('');

const yo = computed(() => estado.comercios.find((c) => c.id === elegido.value) ?? null);

watch(() => estado.comercios, (lista) => {
  if (elegido.value === null && lista.length) elegido.value = lista[0].id;
}, { immediate: true, deep: true });

/**
 * El QR lleva un URI del estandar SEP-7, no un formato inventado.
 * Nuestra aplicacion lo entiende, y tambien lo entenderia cualquier
 * billetera de Stellar el dia que el comercio use la suya.
 */
const qr = ref('');
const uri = computed(() => {
  if (!yo.value || !estado.config) return '';
  const p = new URLSearchParams({
    destination: yo.value.cuenta_publica,
    asset_code: estado.config.activo,
    asset_issuer: estado.config.emisor,
    msg: yo.value.nombre,
  });
  return `web+stellar:pay?${p}`;
});
watch(uri, async (valor) => {
  qr.value = valor
    ? await QRCode.toDataURL(valor, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
    : '';
}, { immediate: true });

// Lo recibido se lee de Horizon, no de nuestra base.
const enLaRed = ref(null);
async function cargarRecibido() {
  if (!yo.value || !estado.config) { enLaRed.value = null; return; }
  const { horizon, activo, emisor } = estado.config;
  enLaRed.value = await saldoEnLaRed(horizon, yo.value.cuenta_publica, activo, emisor);
}
watch([yo, () => estado.eventos.length], cargarRecibido, { immediate: true });

async function registrarme() {
  trabajando.value = 'registro';
  try {
    const r = await accion(() => api.registrarComercio({
      nombre: nuevo.value.nombre.trim(),
      distrito: nuevo.value.distrito.trim(),
      telefono: nuevo.value.telefono.trim(),
    }));
    elegido.value = r.comercio.id;
    nuevo.value = { nombre: '', distrito: '', telefono: '' };
  } finally {
    trabajando.value = '';
  }
}
</script>

<template>
  <!--
    Tres campos y solo el nombre obligatorio. Muchas bodegas de Lima no
    tienen RUC o estan en el RUS: exigirlo dejaria fuera justo al usuario
    que decimos atender.
  -->
  <section v-if="!estado.comercios.length" class="tarjeta">
    <h2>Acepta vales en tu negocio</h2>
    <p class="apagado pequeno">
      Sin POS y sin comisión para ti. Regístrate y la empresa revisará tu
      solicitud.
    </p>
    <form @submit.prevent="registrarme">
      <div class="campo">
        <label for="cn">Nombre del negocio</label>
        <input id="cn" v-model="nuevo.nombre" required placeholder="Bodega Don Julio">
      </div>
      <div class="pareja">
        <div class="campo">
          <label for="cd">Distrito <span class="apagado">(opcional)</span></label>
          <input id="cd" v-model="nuevo.distrito" placeholder="San Juan de Lurigancho">
        </div>
        <div class="campo">
          <label for="ct">Teléfono <span class="apagado">(opcional)</span></label>
          <input id="ct" v-model="nuevo.telefono" inputmode="tel" placeholder="999 999 999">
        </div>
      </div>
      <button :disabled="trabajando === 'registro' || !nuevo.nombre.trim()">
        {{ trabajando === 'registro' ? 'Registrando…' : 'Registrar mi negocio' }}
      </button>
    </form>
  </section>

  <template v-else>
    <section class="tarjeta">
      <div class="campo" v-if="estado.comercios.length > 1">
        <label for="cual">Estás viendo</label>
        <select id="cual" v-model="elegido">
          <option v-for="c in estado.comercios" :key="c.id" :value="c.id">{{ c.nombre }}</option>
        </select>
      </div>

      <template v-if="yo">
        <h2>{{ yo.nombre }}</h2>
        <div class="fila">
          <span class="apagado pequeno">Estado para los vales de la empresa</span>
          <span :class="['etiqueta', yo.estado === 'verificado' ? 'ok'
            : yo.estado === 'rechazado' ? 'no' : 'espera']">
            {{ yo.estado === 'verificado' ? 'Afiliado'
              : yo.estado === 'rechazado' ? 'Rechazado' : 'En revisión' }}
          </span>
        </div>

        <div v-if="yo.estado === 'pendiente'" class="aviso espera">
          <strong>Todavía no puedes cobrar</strong>
          La empresa aún no aprobó tu registro. Si un cliente intenta pagarte
          ahora, la red rechazará el pago.
        </div>
        <div v-else-if="yo.estado === 'rechazado'" class="aviso no">
          <strong>Tu registro fue rechazado</strong>
          No puedes cobrar vales de este programa.
        </div>
      </template>
    </section>

    <section v-if="yo" class="tarjeta">
      <h2>Cobrar</h2>
      <p class="apagado pequeno">
        Muestra esto en caja. El cliente lo escanea con su aplicación y el
        pago llega en segundos, sin POS.
      </p>

      <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center">
        <img v-if="qr" :src="qr" width="200" height="200"
             :alt="`Código QR de cobro de ${yo.nombre}`"
             style="border-radius:8px;background:#fff;padding:8px;flex:none">
        <div>
          <p class="apagado pequeno" style="margin-bottom:2px">
            Si la cámara falla, dicta este código:
          </p>
          <p style="font-size:2.2rem;font-weight:700;letter-spacing:.12em;margin:0">
            {{ yo.codigo_corto }}
          </p>
        </div>
      </div>
    </section>

    <section v-if="yo" class="tarjeta">
      <h2>Lo recibido</h2>
      <div v-if="enLaRed" class="cifras">
        <div class="cifra">
          <b>{{ soles(enLaRed.saldo) }}</b>
          <span>Total en vales</span>
        </div>
        <div class="cifra">
          <b>{{ enLaRed.autorizado ? 'Sí' : 'No' }}</b>
          <span>Puede cobrar</span>
        </div>
      </div>
      <p v-else class="cargando">Consultando la red…</p>
      <p class="apagado pequeno" style="margin-top:10px">
        Leído de Horizon, la red pública. Este número no sale de nuestra base
        de datos: cualquiera puede comprobarlo.
      </p>
    </section>
  </template>
</template>
