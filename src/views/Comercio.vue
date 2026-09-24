<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import {
  api, escucharPagos, explorador, pagosRecibidos, saldoEnLaRed,
} from '../api.js';
import { estado, accion, refrescarYo, soles } from '../estado.js';
import { RUBROS } from '../../lib/rubros.js';
import Qr from '../Qr.vue';

defineProps({ codigo: { type: String, default: '' } });

const esEmpresa = computed(() => estado.yo?.rol === 'empresa');
const elegido = ref(null);
const nuevo = ref({ nombre: '', distrito: '', telefono: '', rubro: 'alimentos' });
const trabajando = ref('');

// El comercio de este celular, o el que elige la empresa en la demostracion.
const yo = computed(() => {
  if (!esEmpresa.value) return estado.comercios[0] ?? null;
  return estado.comercios.find((c) => c.id === elegido.value) ?? null;
});
watch(() => estado.comercios, (lista) => {
  if (esEmpresa.value && elegido.value === null && lista.length) elegido.value = lista[0].id;
}, { immediate: true, deep: true });

/**
 * El QR lleva un enlace web normal, no un formato especial. La camara de
 * cualquier celular lo abre directo en la pantalla de pago con este comercio
 * ya puesto: el cliente solo escribe el monto. Es estatico, asi que se puede
 * imprimir y pegar en el mostrador, como el de Yape.
 */
const enlaceDeCobro = computed(() => (yo.value
  ? `${window.location.origin}/#/pagar/${yo.value.codigo_corto}`
  : ''));

// --- Lo recibido, leido de Horizon ------------------------------------------

const enLaRed = ref(null);
const recibidos = ref([]);
async function cargar() {
  if (!yo.value || !estado.yo) {
    enLaRed.value = null;
    recibidos.value = [];
    return;
  }
  const { horizon, activo, emisor } = estado.yo;
  [enLaRed.value, recibidos.value] = await Promise.all([
    saldoEnLaRed(horizon, yo.value.cuenta_publica, activo, emisor),
    pagosRecibidos(horizon, yo.value.cuenta_publica, activo, emisor),
  ]);
}

// --- Aviso en vivo: lo que el bodeguero necesita en caja ---------------------

const aviso = ref(null);
let dejarDeEscuchar = () => {};
watch(yo, (c) => {
  dejarDeEscuchar();
  aviso.value = null;
  cargar();
  if (!c || !estado.yo) return;
  const { horizon, activo, emisor } = estado.yo;
  dejarDeEscuchar = escucharPagos(horizon, c.cuenta_publica, activo, emisor, (pago) => {
    aviso.value = pago;
    navigator.vibrate?.([120, 60, 120]);
    cargar();
  });
}, { immediate: true });
onUnmounted(() => dejarDeEscuchar());

async function registrar() {
  trabajando.value = 'registro';
  try {
    const r = await accion(() => api.registrarComercio({
      nombre: nuevo.value.nombre.trim(),
      distrito: nuevo.value.distrito.trim(),
      telefono: nuevo.value.telefono.trim(),
      rubro: nuevo.value.rubro,
    }));
    if (esEmpresa.value) elegido.value = r.comercio.id;
    else await refrescarYo();
    nuevo.value = { nombre: '', distrito: '', telefono: '', rubro: 'alimentos' };
  } finally {
    trabajando.value = '';
  }
}

const hora = (f) => new Date(f).toLocaleString('es-PE', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});
const imprimir = () => window.print();
</script>

<template>
  <!--
    Registro: solo el nombre es obligatorio. Muchas bodegas de Lima no tienen
    RUC o estan en el RUS: exigirlo dejaria fuera justo al usuario que decimos
    atender.
  -->
  <section v-if="(!yo && !esEmpresa) || esEmpresa" class="tarjeta">
    <template v-if="esEmpresa && estado.comercios.length">
      <div class="campo">
        <label for="cual">Ver como</label>
        <select id="cual" v-model="elegido">
          <option v-for="c in estado.comercios" :key="c.id" :value="c.id">{{ c.nombre }}</option>
        </select>
      </div>
      <h3 class="bloque">Registrar otro comercio</h3>
    </template>
    <template v-else-if="!esEmpresa">
      <h2>Acepta vales en tu negocio</h2>
      <p class="apagado pequeno">
        Sin POS y sin comisión para ti. Registra tu negocio y la empresa
        revisará tu solicitud.
      </p>
    </template>
    <template v-else>
      <h2>Registrar un comercio</h2>
    </template>

    <form @submit.prevent="registrar">
      <div class="campo">
        <label for="cn">Nombre del negocio</label>
        <input id="cn" v-model="nuevo.nombre" required placeholder="Bodega Don Julio">
      </div>
      <div class="campo">
        <label for="cr">Qué vendes principalmente</label>
        <select id="cr" v-model="nuevo.rubro">
          <option v-for="(n, clave) in RUBROS" :key="clave" :value="clave">{{ n }}</option>
        </select>
      </div>
      <div class="pareja">
        <div class="campo">
          <label for="cd">Distrito <span class="apagado">(opcional)</span></label>
          <input id="cd" v-model="nuevo.distrito" placeholder="San Juan de Lurigancho">
        </div>
        <div class="campo">
          <label for="ct">Teléfono <span class="apagado">(opcional)</span></label>
          <input id="ct" v-model="nuevo.telefono" inputmode="tel" autocomplete="tel" placeholder="999 999 999">
        </div>
      </div>
      <button :disabled="trabajando === 'registro' || !nuevo.nombre.trim()">
        {{ trabajando === 'registro' ? 'Registrando…' : 'Registrar' }}
      </button>
    </form>
  </section>

  <template v-if="yo">
    <section class="tarjeta">
      <h2>{{ yo.nombre }}</h2>
      <div class="fila">
        <span class="apagado pequeno">{{ RUBROS[yo.rubro] ?? '' }}</span>
        <span :class="['etiqueta', yo.estado === 'verificado' ? 'ok'
          : yo.estado === 'rechazado' ? 'no' : 'espera']">
          {{ yo.estado === 'verificado' ? 'Afiliado'
            : yo.estado === 'rechazado' ? 'Rechazado' : 'En revisión' }}
        </span>
      </div>
      <div v-if="yo.estado === 'pendiente'" class="aviso espera">
        <strong>Todavía no puedes cobrar</strong>
        La empresa aún no aprobó tu registro. Si un cliente intenta pagarte
        ahora, el pago no pasará.
      </div>
      <div v-else-if="yo.estado === 'rechazado'" class="aviso no">
        <strong>Tu registro fue rechazado</strong>
        No puedes cobrar vales de este programa.
      </div>
    </section>

    <div v-if="aviso" class="aviso ok aviso-grande" role="alert">
      <strong>Recibiste {{ soles(aviso.monto) }}</strong>
      <span class="pequeno">
        {{ hora(aviso.fecha) }} ·
        <a :href="explorador(aviso.hash)" target="_blank" rel="noopener">ver comprobante</a>
      </span>
    </div>

    <section class="tarjeta imprimible">
      <h2>Cobrar</h2>
      <p class="apagado pequeno no-imprimir">
        El cliente apunta la cámara de su celular a este código y paga. Puedes
        imprimirlo y pegarlo en el mostrador.
      </p>
      <div class="cobro">
        <Qr :texto="enlaceDeCobro" :alt="`Código QR para pagar a ${yo.nombre}`" :tamano="220" />
        <div>
          <p class="solo-imprimir nombre-impreso">{{ yo.nombre }}</p>
          <p class="solo-imprimir">Paga aquí con tu vale: escanea con la cámara.</p>
          <p class="apagado pequeno" style="margin-bottom:2px">Si no puede escanear, dicte este código:</p>
          <p class="codigo">{{ yo.codigo_corto }}</p>
        </div>
      </div>
      <button class="suave no-imprimir" style="margin-top:12px" @click="imprimir">Imprimir mi QR</button>
    </section>

    <section class="tarjeta">
      <h2>Lo recibido</h2>
      <div v-if="enLaRed" class="cifras">
        <div class="cifra"><b>{{ soles(enLaRed.saldo) }}</b><span>Total en vales</span></div>
        <div class="cifra"><b>{{ recibidos.length }}</b><span>Cobros recientes</span></div>
      </div>
      <p v-else class="cargando">Consultando…</p>
      <div v-for="p in recibidos" :key="p.id" class="fila">
        <div>
          <div class="nombre">{{ soles(p.monto) }}</div>
          <div class="apagado pequeno">
            {{ hora(p.fecha) }}<template v-if="p.rubro"> · {{ RUBROS[p.rubro] ?? p.rubro }}</template>
          </div>
        </div>
        <a :href="explorador(p.hash)" target="_blank" rel="noopener" class="pequeno">ver comprobante</a>
      </div>
      <p v-if="enLaRed && !recibidos.length" class="apagado pequeno">Todavía no recibiste cobros.</p>
    </section>
  </template>
</template>
