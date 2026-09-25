<script setup>
import { computed, ref, watch } from 'vue';
import { api, saldoEnLaRed } from '../api.js';
import {
  estado, accion, fecha, montoValido, programaVigente, soles,
} from '../estado.js';
import { RUBROS, TIPOS } from '../../lib/rubros.js';
import Prueba from '../Prueba.vue';
import Qr from '../Qr.vue';
import TarjetaImpresa from '../TarjetaImpresa.vue';
import { enlaceRestablecer } from '../enlaces.js';

defineProps({ codigo: { type: String, default: '' }, cobro: { type: String, default: '' } });

const ultima = ref(null);
const trabajando = ref('');
const copiado = ref('');

// --- Invitaciones -----------------------------------------------------------

const MENSAJES = {
  beneficiario: 'Hola. Te invitamos a recibir tu vale de alimentos. Regístrate con tu celular y elige un PIN:',
  comercio: 'Hola. Te invitamos a aceptar vales de alimentos en tu negocio, sin POS y sin comisión. Regístrate aquí:',
};

const invitaciones = computed(() => {
  const tokens = estado.yo?.invitaciones ?? {};
  return ['beneficiario', 'comercio'].filter((rol) => tokens[rol]).map((rol) => {
    const enlace = `${window.location.origin}/#/unirse/${tokens[rol]}`;
    return {
      rol,
      titulo: rol === 'beneficiario' ? 'Invitar trabajadores' : 'Invitar comercios',
      detalle: rol === 'beneficiario'
        ? 'Cada trabajador abre el enlace, escribe su nombre y su celular, y elige un PIN. Después tú lo apruebas.'
        : 'La bodega abre el enlace, registra su negocio y elige un PIN. Después tú la afilias.',
      enlace,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(`${MENSAJES[rol]} ${enlace}`)}`,
    };
  });
});

const puedeCompartir = typeof navigator !== 'undefined' && Boolean(navigator.share);

async function copiar(inv) {
  try {
    await navigator.clipboard.writeText(inv.enlace);
    copiado.value = inv.rol;
    setTimeout(() => { copiado.value = ''; }, 2500);
  } catch {
    estado.error = 'No se pudo copiar. Mantén presionado el enlace para copiarlo.';
  }
}

async function compartir(inv) {
  try {
    await navigator.share({ title: 'StellarRail', text: MENSAJES[inv.rol], url: inv.enlace });
  } catch {
    // La persona cerro el menu de compartir: no es un error.
  }
}

// --- Verificaciones ---------------------------------------------------------

const pendientes = computed(() => [
  ...estado.beneficiarios.filter((b) => b.estado === 'pendiente')
    .map((b) => ({ ...b, tipo: 'beneficiario' })),
  ...estado.comercios.filter((c) => c.estado === 'pendiente')
    .map((c) => ({ ...c, tipo: 'comercio' })),
]);

async function verificar(fila, aprobar) {
  trabajando.value = `${fila.tipo}-${fila.id}`;
  try {
    const r = await accion(() => (fila.tipo === 'beneficiario'
      ? api.verificarBeneficiario(fila.id, aprobar)
      : api.verificarComercio(fila.id, aprobar)));
    ultima.value = r.transaccion ?? null;
  } finally {
    trabajando.value = '';
  }
}

// --- Personas: tarjeta, PIN nuevo, baja --------------------------------------

const hoja = ref(null);   // { tipo:'pin', nombre, enlace } | { tipo:'tarjeta', nombre, numero }
const confirmarBaja = ref(null);

async function darTarjeta(b) {
  trabajando.value = `tarjeta-${b.id}`;
  try {
    const r = await accion(() => api.darTarjeta(b.id));
    hoja.value = { tipo: 'tarjeta', nombre: r.nombre, numero: r.tarjeta };
  } finally {
    trabajando.value = '';
  }
}

async function anularTarjeta(b) {
  trabajando.value = `anular-${b.id}`;
  try {
    await accion(() => api.anularTarjeta(b.id));
    if (hoja.value?.tipo === 'tarjeta' && hoja.value.numero === b.tarjeta) hoja.value = null;
  } finally {
    trabajando.value = '';
  }
}

/** Sin SMS: la empresa le pasa el enlace por WhatsApp o con un QR en RR. HH. */
async function nuevoPin(tabla, fila) {
  trabajando.value = `pin-${tabla}-${fila.id}`;
  try {
    const r = await accion(() => api.nuevoPin(tabla, fila.id));
    const enlace = enlaceRestablecer(r.token);
    hoja.value = {
      tipo: 'pin',
      nombre: r.nombre,
      enlace,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(`Hola, ${r.nombre}. Con este enlace eliges tu PIN nuevo de StellarRail. Sirve una sola vez, durante 24 horas: ${enlace}`)}`,
    };
  } finally {
    trabajando.value = '';
  }
}

/** Congela y anula su saldo en una sola transaccion, como al vencer. */
async function darDeBaja(b) {
  trabajando.value = `baja-${b.id}`;
  try {
    const r = await accion(() => api.darDeBaja(b.id));
    ultima.value = r.transaccion ?? null;
    confirmarBaja.value = null;
    await cargarGasto();
  } finally {
    trabajando.value = '';
  }
}

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    copiado.value = 'hoja';
    setTimeout(() => { copiado.value = ''; }, 2500);
  } catch {
    estado.error = 'No se pudo copiar. Mantén presionado el enlace para copiarlo.';
  }
}
const imprimir = () => window.print();

const ESTADOS = {
  pendiente: ['espera', 'Pendiente'],
  verificado: ['ok', 'Autorizado en la red'],
  rechazado: ['no', 'Rechazado'],
  baja: ['no', 'De baja'],
};

// --- Programa ---------------------------------------------------------------

const en30dias = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
};
const nuevo = ref({
  nombre: 'Alimentación septiembre',
  monto: '50',
  venceEl: en30dias(),
  tipo: 'alimentaria',
  rubros: ['alimentos'],
});
const rubrosFijos = computed(() => TIPOS[nuevo.value.tipo].fijo);
watch(() => nuevo.value.tipo, (tipo) => {
  if (TIPOS[tipo].fijo) nuevo.value.rubros = [...TIPOS[tipo].rubros];
});

const programa = computed(() => estado.programas.at(-1) ?? null);
const vigente = computed(() => programaVigente());

async function crear() {
  const monto = montoValido(nuevo.value.monto);
  if (!monto) {
    estado.error = 'Escribe un monto válido, por ejemplo 50 o 45,50.';
    return;
  }
  trabajando.value = 'crear';
  try {
    await accion(() => api.crearPrograma({ ...nuevo.value, monto }));
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

// --- Gasto en vivo, leido de Horizon y no de nuestra base de datos ----------

const gasto = ref([]);     // lo que le queda a cada trabajador
const tiendas = ref([]);   // lo que recibio cada tienda
const errorGasto = ref('');
async function cargarGasto() {
  if (!estado.yo) return;
  const { horizon, activo, emisor } = estado.yo;
  const leer = async (fila) => ({
    nombre: fila.nombre,
    ...(await saldoEnLaRed(horizon, fila.cuenta_publica, activo, emisor)),
  });
  try {
    [gasto.value, tiendas.value] = await Promise.all([
      Promise.all(estado.beneficiarios.filter((b) => b.estado === 'verificado').map(leer)),
      Promise.all(estado.comercios.filter((c) => c.estado === 'verificado').map(leer)),
    ]);
    errorGasto.value = '';
  } catch (e) {
    errorGasto.value = e.message;
  }
}
watch(
  () => `${estado.beneficiarios.length}|${estado.comercios.length}|${estado.eventos.length}`,
  cargarGasto,
  { immediate: true },
);

const suma = (lista) => lista.reduce((s, x) => s + Number(x.saldo), 0);
// "Entregado" cuenta vales emitidos de verdad, cada uno con su hash: no una
// estimacion por cuantos trabajadores estan verificados.
const entregado = computed(() => (programa.value
  ? Number(programa.value.monto) * (programa.value.entregados ?? 0)
  : 0));
const saldoVigente = computed(() => suma(gasto.value));
const gastado = computed(() => suma(tiendas.value));
const anulado = computed(() => Math.max(0, entregado.value - gastado.value - saldoVigente.value));

const verificados = computed(() => estado.beneficiarios.filter((b) => b.estado === 'verificado').length);
const porEntregar = computed(() => (programa.value
  ? Math.max(0, verificados.value - (programa.value.entregados ?? 0))
  : 0));
</script>

<template>
  <section class="tarjeta">
    <h2>Invitar</h2>
    <p class="apagado pequeno">
      Nadie necesita instalar nada. Comparte el enlace por WhatsApp o muestra
      el código: cada persona se registra con su celular y un PIN de 4 números,
      y con eso entra después.
    </p>
    <div class="invitaciones">
      <article v-for="inv in invitaciones" :key="inv.rol" class="invitacion">
        <h3>{{ inv.titulo }}</h3>
        <p class="apagado pequeno">{{ inv.detalle }}</p>
        <!-- Se lee desde una pantalla: basta la correccion media, que da un codigo menos denso. -->
        <Qr :texto="inv.enlace" nivel="M" :alt="`Código QR para ${inv.titulo.toLowerCase()}`" :tamano="190" />
        <div class="acciones" style="margin-top:10px">
          <a class="boton si" :href="inv.whatsapp" target="_blank" rel="noopener">Enviar por WhatsApp</a>
          <button v-if="puedeCompartir" class="suave" @click="compartir(inv)">Compartir</button>
          <button class="suave" @click="copiar(inv)">
            {{ copiado === inv.rol ? 'Copiado' : 'Copiar enlace' }}
          </button>
        </div>
      </article>
    </div>
  </section>

  <section class="tarjeta">
    <h2>Verificaciones</h2>
    <p class="apagado pequeno">
      Aprobar no es marcar una casilla: ejecuta una transacción que autoriza
      la cuenta en la red. Sin ella, el protocolo no le deja tener el vale.
    </p>

    <p v-if="!pendientes.length" class="apagado">No hay nada pendiente.</p>
    <div v-for="f in pendientes" :key="`${f.tipo}-${f.id}`" class="fila">
      <div>
        <div class="nombre">{{ f.nombre }}</div>
        <div class="apagado pequeno">
          {{ f.tipo === 'beneficiario' ? 'Trabajador' : `Comercio · ${RUBROS[f.rubro] ?? ''}` }}
          <template v-if="f.distrito"> · {{ f.distrito }}</template>
        </div>
      </div>
      <div class="acciones">
        <button class="si chico" :disabled="trabajando === `${f.tipo}-${f.id}`"
                @click="verificar(f, true)">Aprobar y autorizar</button>
        <button class="no chico" :disabled="trabajando === `${f.tipo}-${f.id}`"
                @click="verificar(f, false)">Rechazar</button>
      </div>
    </div>

    <Prueba v-if="ultima" :tx="ultima" />
  </section>

  <section class="tarjeta">
    <h2>Personas</h2>
    <h3>Trabajadores</h3>
    <p v-if="!estado.beneficiarios.length" class="apagado pequeno">Todavía nadie se registró.</p>
    <div v-for="b in estado.beneficiarios" :key="`b-${b.id}`" class="fila">
      <div>
        <div class="nombre">{{ b.nombre }}</div>
        <div class="apagado pequeno">
          <template v-if="b.celular">Celular {{ b.celular }}</template>
          <template v-if="b.tarjeta"> · Tarjeta {{ b.tarjeta }}</template>
        </div>
        <span :class="['etiqueta', ESTADOS[b.estado]?.[0]]">{{ ESTADOS[b.estado]?.[1] ?? b.estado }}</span>
      </div>
      <div v-if="b.estado !== 'baja'" class="acciones">
        <button v-if="b.estado !== 'rechazado'" class="suave chico" :disabled="Boolean(trabajando)" @click="darTarjeta(b)">
          {{ b.tarjeta ? 'Nueva tarjeta' : 'Dar tarjeta' }}
        </button>
        <button v-if="b.tarjeta" class="suave chico" :disabled="Boolean(trabajando)" @click="anularTarjeta(b)">Anular tarjeta</button>
        <button v-if="b.celular" class="suave chico" :disabled="Boolean(trabajando)" @click="nuevoPin('beneficiarios', b)">Nuevo PIN</button>
        <button class="no chico" :disabled="Boolean(trabajando)" @click="confirmarBaja = b">Dar de baja</button>
      </div>
      <div v-if="confirmarBaja?.id === b.id" class="aviso no" role="alertdialog" style="flex-basis:100%">
        <strong>¿Dar de baja a {{ b.nombre }}?</strong>
        Su saldo se congela y se anula en una sola transacción, y su tarjeta
        deja de servir. No se puede deshacer.
        <div class="acciones" style="margin-top:8px">
          <button class="no chico" :disabled="trabajando === `baja-${b.id}`" @click="darDeBaja(b)">
            {{ trabajando === `baja-${b.id}` ? 'Dando de baja…' : 'Sí, dar de baja' }}
          </button>
          <button class="suave chico" @click="confirmarBaja = null">No</button>
        </div>
      </div>
    </div>

    <h3 style="margin-top:16px">Tiendas</h3>
    <p v-if="!estado.comercios.length" class="apagado pequeno">Todavía ninguna tienda se registró.</p>
    <div v-for="c in estado.comercios" :key="`c-${c.id}`" class="fila">
      <div>
        <div class="nombre">{{ c.nombre }}</div>
        <div class="apagado pequeno">
          {{ RUBROS[c.rubro] ?? '' }}<template v-if="c.celular"> · Celular {{ c.celular }}</template>
        </div>
        <span :class="['etiqueta', ESTADOS[c.estado]?.[0]]">
          {{ c.estado === 'verificado' ? 'Afiliada en la red' : ESTADOS[c.estado]?.[1] }}
        </span>
      </div>
      <button v-if="c.celular" class="suave chico" :disabled="Boolean(trabajando)" @click="nuevoPin('comercios', c)">Nuevo PIN</button>
    </div>

    <!-- Lo que se le entrega a la persona: su tarjeta o su enlace de PIN nuevo. -->
    <div v-if="hoja" class="bloque hoja">
      <template v-if="hoja.tipo === 'tarjeta'">
        <h3>Tarjeta de {{ hoja.nombre }}</h3>
        <p class="apagado pequeno">
          Imprímela y entrégasela. Paga en las tiendas afiliadas marcando su PIN,
          hasta S/ 100 por día. La anterior, si tenía, ya no sirve.
        </p>
        <TarjetaImpresa :numero="hoja.numero" :nombre="hoja.nombre" :empresa="estado.yo?.empresa ?? ''" />
        <div class="acciones" style="margin-top:10px">
          <button class="si" @click="imprimir">Imprimir tarjeta</button>
          <button class="suave" @click="hoja = null">Cerrar</button>
        </div>
      </template>
      <template v-else>
        <h3>PIN nuevo para {{ hoja.nombre }}</h3>
        <p class="apagado pequeno">
          Envíale este enlace o que escanee el código. Sirve una sola vez,
          durante 24 horas. Al usarlo se cierran sus sesiones abiertas.
        </p>
        <Qr :texto="hoja.enlace" nivel="M" :tamano="190" :alt="`Código QR para que ${hoja.nombre} elija su PIN nuevo`" />
        <div class="acciones" style="margin-top:10px">
          <a class="boton si" :href="hoja.whatsapp" target="_blank" rel="noopener">Enviar por WhatsApp</a>
          <button class="suave" @click="copiarTexto(hoja.enlace)">{{ copiado === 'hoja' ? 'Copiado' : 'Copiar enlace' }}</button>
          <button class="suave" @click="hoja = null">Cerrar</button>
        </div>
      </template>
    </div>
  </section>

  <section class="tarjeta">
    <h2>Programa</h2>

    <form v-if="!vigente" @submit.prevent="crear">
      <p v-if="programa" class="apagado pequeno">
        El programa anterior venció. Puedes crear uno nuevo.
      </p>
      <fieldset class="campo">
        <legend>Tipo de programa</legend>
        <label v-for="(t, clave) in TIPOS" :key="clave" class="opcion">
          <input v-model="nuevo.tipo" type="radio" name="tipo" :value="clave"> {{ t.nombre }}
        </label>
      </fieldset>

      <fieldset class="campo">
        <legend>Dónde se puede gastar</legend>
        <p v-if="rubrosFijos" class="apagado pequeno" style="margin:0 0 6px">
          La Ley 28051 exige que la prestación alimentaria se use solo en
          alimentos: estos rubros no los elige la empresa.
        </p>
        <label v-for="(nombre, clave) in RUBROS" :key="clave" class="opcion">
          <input v-model="nuevo.rubros" type="checkbox" :value="clave" :disabled="rubrosFijos">
          {{ nombre }}
        </label>
      </fieldset>

      <div class="campo">
        <label for="pn">Nombre</label>
        <input id="pn" v-model="nuevo.nombre" required>
      </div>
      <div class="pareja">
        <div class="campo">
          <label for="pm">Monto por trabajador (S/)</label>
          <input id="pm" v-model="nuevo.monto" type="text" inputmode="decimal" autocomplete="off" required>
        </div>
        <div class="campo">
          <label for="pv">Vence el</label>
          <input id="pv" v-model="nuevo.venceEl" type="date" required>
        </div>
      </div>
      <button :disabled="trabajando === 'crear' || !nuevo.rubros.length">Crear programa</button>
    </form>

    <template v-if="programa">
      <div class="fila">
        <div>
          <div class="nombre">{{ programa.nombre }}</div>
          <div class="apagado pequeno">
            {{ TIPOS[programa.tipo]?.nombre ?? programa.tipo }} ·
            {{ soles(programa.monto) }} por trabajador ·
            vence el {{ fecha(programa.vence_el) }}
          </div>
          <div class="apagado pequeno">
            Rubros: {{ (programa.rubros ?? []).map((r) => RUBROS[r] ?? r).join(', ') }}
          </div>
        </div>
        <span :class="['etiqueta', programa.estado === 'vigente' ? 'ok' : 'no']">
          {{ programa.estado === 'vigente' ? 'Vigente' : 'Vencido' }}
        </span>
      </div>

      <div v-if="programa.estado === 'vigente'" class="acciones" style="margin-top:12px">
        <button :disabled="trabajando === 'entregar' || !porEntregar"
                @click="ejecutar('entregar', () => api.entregar(programa.id))">
          {{ trabajando === 'entregar' ? 'Entregando…'
            : porEntregar ? `Entregar vale a ${porEntregar} ${porEntregar === 1 ? 'trabajador' : 'trabajadores'}`
              : 'Todos recibieron su vale' }}
        </button>
        <button class="suave" :disabled="trabajando === 'vencer'"
                @click="ejecutar('vencer', () => api.vencer(programa.id))">
          {{ trabajando === 'vencer' ? 'Venciendo…' : 'Vencer programa' }}
        </button>
      </div>

      <p v-if="programa.estado === 'vencido'" class="aviso ok">
        El saldo no gastado se anuló en la red. El clawback lo destruye: la
        empresa recupera su respaldo en soles, que deja de estar comprometido.
      </p>
    </template>
  </section>

  <section class="tarjeta">
    <h2>Gasto en vivo</h2>
    <p class="apagado pequeno">
      Leído directamente de Horizon, no de nuestra base de datos. Es la misma
      fuente que puede consultar cualquiera.
    </p>
    <div class="cifras">
      <div class="cifra"><b>{{ soles(entregado) }}</b><span>Entregado</span></div>
      <div class="cifra"><b>{{ soles(gastado) }}</b><span>Gastado en tiendas</span></div>
      <div class="cifra"><b>{{ soles(saldoVigente) }}</b><span>Saldo vigente</span></div>
      <div v-if="programa?.estado === 'vencido'" class="cifra">
        <b>{{ soles(anulado) }}</b><span>Anulado al vencer</span>
      </div>
    </div>
    <p v-if="errorGasto" class="aviso espera">{{ errorGasto }}</p>
    <div v-for="g in gasto" :key="g.nombre" class="fila" style="margin-top:8px">
      <span>{{ g.nombre }}</span>
      <span>
        {{ soles(g.saldo) }}
        <span v-if="g.congelado" class="etiqueta no">Congelado</span>
      </span>
    </div>
    <p v-if="!gasto.length" class="apagado pequeno">Todavía no hay trabajadores verificados.</p>
  </section>

  <div v-if="hoja?.tipo === 'tarjeta'" class="cartel" aria-hidden="true">
    <TarjetaImpresa :numero="hoja.numero" :nombre="hoja.nombre" :empresa="estado.yo?.empresa ?? ''" />
  </div>

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
