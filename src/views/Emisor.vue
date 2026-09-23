<script setup>
import { computed, ref, watch } from 'vue';
import { api, saldoEnLaRed } from '../api.js';
import { estado, accion, recargar, soles } from '../estado.js';
import Prueba from '../Prueba.vue';

const clave = ref('');
const entrando = ref(false);
const ultima = ref(null);
const trabajando = ref('');

const en30dias = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
};
const nuevo = ref({ nombre: 'Alimentación septiembre', monto: '50', venceEl: en30dias() });

const pendientes = computed(() => [
  ...estado.beneficiarios.filter((b) => b.estado === 'pendiente')
    .map((b) => ({ ...b, tipo: 'beneficiario' })),
  ...estado.comercios.filter((c) => c.estado === 'pendiente')
    .map((c) => ({ ...c, tipo: 'comercio' })),
]);
const revisados = computed(() => [...estado.beneficiarios, ...estado.comercios]
  .filter((x) => x.estado !== 'pendiente'));
const programa = computed(() => estado.programas.at(-1) ?? null);

async function entrar() {
  entrando.value = true;
  try {
    await accion(() => api.entrar(clave.value));
    estado.config = await api.sesion();
  } finally {
    entrando.value = false;
  }
}

async function verificar(fila, aprobar) {
  trabajando.value = fila.tipo + '-' + fila.id;
  try {
    const r = await accion(() => (fila.tipo === 'beneficiario'
      ? api.verificarBeneficiario(fila.id, aprobar)
      : api.verificarComercio(fila.id, aprobar)));
    ultima.value = r.transaccion ?? null;
  } finally {
    trabajando.value = '';
  }
}

async function crear() {
  trabajando.value = 'crear';
  try {
    await accion(() => api.crearPrograma({ ...nuevo.value }));
    ultima.value = null;
  } finally {
    trabajando.value = '';
  }
}

async function ejecutar(nombre, fn) {
  trabajando.value = nombre;
  try {
    const r = await accion(fn);
    ultima.value = r.transacciones?.at(-1) ?? null;
    await cargarGasto();
  } finally {
    trabajando.value = '';
  }
}

// Gasto en vivo, leido de Horizon y no de nuestra base de datos.
const gasto = ref([]);
async function cargarGasto() {
  if (!estado.config) return;
  const { horizon, activo, emisor } = estado.config;
  const verificados = estado.beneficiarios.filter((b) => b.estado === 'verificado');
  gasto.value = await Promise.all(verificados.map(async (b) => ({
    nombre: b.nombre,
    ...(await saldoEnLaRed(horizon, b.cuenta_publica, activo, emisor)),
  })));
}
watch(() => estado.beneficiarios.length, cargarGasto, { immediate: true });

const entregado = computed(() => (programa.value
  ? Number(programa.value.monto) * gasto.value.length
  : 0));
const vigente = computed(() => gasto.value.reduce((s, g) => s + Number(g.saldo), 0));
</script>

<template>
  <!-- Puerta del panel: la URL es publica. -->
  <section v-if="!estado.config?.admin" class="tarjeta">
    <h2>Panel del emisor</h2>
    <p class="apagado pequeno">
      Desde aquí se aprueban beneficiarios, se entregan vales y se vencen
      programas. La clave está en el README del repositorio.
    </p>
    <form @submit.prevent="entrar">
      <div class="campo">
        <label for="clave">Clave del panel</label>
        <input id="clave" v-model="clave" type="password" autocomplete="current-password">
      </div>
      <button :disabled="entrando || !clave">{{ entrando ? 'Entrando…' : 'Entrar' }}</button>
    </form>
  </section>

  <template v-else>
    <section class="tarjeta">
      <h2>Verificaciones</h2>
      <p class="apagado pequeno">
        Aprobar no es marcar una casilla: ejecuta una transacción que autoriza
        la cuenta en la red. Sin ella, el protocolo no le deja tener el vale.
      </p>

      <p v-if="!pendientes.length" class="apagado">No hay nada pendiente.</p>
      <div v-for="f in pendientes" :key="f.tipo + '-' + f.id" class="fila">
        <div>
          <div class="nombre">{{ f.nombre }}</div>
          <div class="apagado pequeno">
            {{ f.tipo === 'beneficiario' ? 'Trabajador' : 'Comercio' }}
            <template v-if="f.distrito">· {{ f.distrito }}</template>
          </div>
        </div>
        <div class="acciones">
          <button class="si chico" :disabled="trabajando === f.tipo + '-' + f.id"
                  @click="verificar(f, true)">Aprobar y autorizar</button>
          <button class="no chico" :disabled="trabajando === f.tipo + '-' + f.id"
                  @click="verificar(f, false)">Rechazar</button>
        </div>
      </div>

      <div class="bloque">
        <h3>Ya revisados</h3>
        <p v-if="!revisados.length" class="apagado pequeno">Todavía ninguno.</p>
        <div v-for="f in revisados" :key="f.cuenta_publica" class="fila">
          <span>{{ f.nombre }}</span>
          <span :class="['etiqueta', f.estado === 'verificado' ? 'ok' : 'no']">
            {{ f.estado === 'verificado' ? 'Autorizado en la red' : 'Rechazado' }}
          </span>
        </div>
      </div>
    </section>

    <section class="tarjeta">
      <h2>Programa</h2>

      <form v-if="!programa" @submit.prevent="crear">
        <div class="campo">
          <label for="pn">Nombre</label>
          <input id="pn" v-model="nuevo.nombre" required>
        </div>
        <div class="pareja">
          <div class="campo">
            <label for="pm">Monto por trabajador (S/)</label>
            <input id="pm" v-model="nuevo.monto" type="number" min="1" step="0.5" required>
          </div>
          <div class="campo">
            <label for="pv">Vence el</label>
            <input id="pv" v-model="nuevo.venceEl" type="date" required>
          </div>
        </div>
        <button :disabled="trabajando === 'crear'">Crear programa</button>
      </form>

      <template v-else>
        <div class="fila">
          <div>
            <div class="nombre">{{ programa.nombre }}</div>
            <div class="apagado pequeno">
              {{ soles(programa.monto) }} por trabajador · vence el
              {{ String(programa.vence_el).slice(0, 10) }}
            </div>
          </div>
          <span :class="['etiqueta', programa.estado === 'vigente' ? 'ok' : 'no']">
            {{ programa.estado === 'vigente' ? 'Vigente' : 'Vencido' }}
          </span>
        </div>

        <div class="acciones" style="margin-top:12px">
          <button :disabled="programa.estado !== 'vigente' || trabajando === 'entregar'"
                  @click="ejecutar('entregar', () => api.entregar(programa.id))">
            {{ trabajando === 'entregar' ? 'Entregando…' : 'Entregar vales' }}
          </button>
          <button class="suave" :disabled="programa.estado !== 'vigente' || trabajando === 'vencer'"
                  @click="ejecutar('vencer', () => api.vencer(programa.id))">
            {{ trabajando === 'vencer' ? 'Venciendo…' : 'Vencer programa' }}
          </button>
        </div>

        <p v-if="programa.estado === 'vencido'" class="aviso ok">
          El saldo no gastado se anuló en la red. El clawback lo destruye: la
          empresa recupera su respaldo en soles, que deja de estar comprometido.
        </p>
      </template>

      <Prueba v-if="ultima" :tx="ultima" />
    </section>

    <section class="tarjeta">
      <h2>Gasto en vivo</h2>
      <p class="apagado pequeno">
        Leído directamente de Horizon, no de nuestra base de datos. Es la misma
        fuente que puede consultar cualquiera.
      </p>
      <div class="cifras">
        <div class="cifra"><b>{{ soles(entregado) }}</b><span>Entregado</span></div>
        <div class="cifra"><b>{{ soles(entregado - vigente) }}</b><span>Gastado</span></div>
        <div class="cifra"><b>{{ soles(vigente) }}</b><span>Saldo vigente</span></div>
      </div>
      <div v-for="g in gasto" :key="g.nombre" class="fila" style="margin-top:8px">
        <span>{{ g.nombre }}</span>
        <span>
          {{ soles(g.saldo) }}
          <span v-if="g.congelado" class="etiqueta no">Congelado</span>
        </span>
      </div>
      <p v-if="!gasto.length" class="apagado pequeno">
        Todavía no hay beneficiarios verificados.
      </p>
    </section>

    <section class="tarjeta">
      <h2>Historial en la red</h2>
      <p v-if="!estado.eventos.length" class="apagado pequeno">Sin operaciones todavía.</p>
      <div v-for="e in estado.eventos" :key="e.id" class="fila">
        <div>
          <div class="nombre">{{ e.etiqueta }}</div>
          <div v-if="!e.exitosa" class="apagado pequeno">
            Rechazada por la red: <code>{{ e.codigo_error }}</code>
          </div>
        </div>
        <a :href="e.explorador" target="_blank" rel="noopener" class="pequeno">ver comprobante</a>
      </div>
    </section>
  </template>
</template>
