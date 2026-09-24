<script setup>
/**
 * La pantalla de la tienda.
 *
 * Dos maneras de cobrar, como con los QR que la bodega ya usa:
 *  - Con monto: la tienda escribe cuanto cobra y muestra el QR. El cliente
 *    solo confirma, sin escribir nada. Es la opcion principal: la tienda
 *    teclea montos todo el dia, el cliente quiza no.
 *  - QR fijo: se imprime y se pega en el mostrador. El cliente escribe el
 *    monto.
 *
 * Cuando le pagan, la tienda lo ve en grande y, si quiere, lo oye.
 */
import {
  computed, nextTick, onUnmounted, ref, watch,
} from 'vue';
import {
  api, escucharPagos, explorador, pagosRecibidos, saldoEnLaRed,
} from '../api.js';
import {
  estado, accion, enPalabras, hablar, montoValido, refrescarYo, soles,
} from '../estado.js';
import { agrupar, enlaceCobro, enlaceFijo } from '../enlaces.js';
import { RUBROS } from '../../lib/rubros.js';
import Icono from '../Icono.vue';
import Qr from '../Qr.vue';

defineProps({ codigo: { type: String, default: '' }, cobro: { type: String, default: '' } });

const esEmpresa = computed(() => estado.yo?.rol === 'empresa');
const elegido = ref(null);
const nuevo = ref({ nombre: '', distrito: '', telefono: '', rubro: 'alimentos' });
const trabajando = ref(false);

// La tienda de este celular, o la que elige la empresa en la demostracion.
const yo = computed(() => {
  if (!esEmpresa.value) return estado.comercios[0] ?? null;
  return estado.comercios.find((c) => c.id === elegido.value) ?? null;
});
watch(() => estado.comercios, (lista) => {
  if (esEmpresa.value && elegido.value === null && lista.length) elegido.value = lista[0].id;
}, { immediate: true, deep: true });

async function registrar() {
  trabajando.value = true;
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
    trabajando.value = false;
  }
}

// --- Cobrar con monto --------------------------------------------------------

const modo = ref('monto');
const cobroMonto = ref('');
const cobroRubro = ref('alimentos');
const cobroActivo = ref(null);    // { token, monto, rubro, expira, pagado }
const aviso = ref('');
const campoMonto = ref(null);
// Por el id, no por el objeto: si no, cada recarga pisaria el rubro elegido.
watch(() => yo.value?.id, () => { if (yo.value) cobroRubro.value = yo.value.rubro; }, { immediate: true });

const ahora = ref(Date.now());
const reloj = setInterval(() => { ahora.value = Date.now(); }, 1000);
const restante = computed(() => (cobroActivo.value
  ? Math.max(0, cobroActivo.value.venceLocal - ahora.value)
  : 0));
const vencido = computed(() => cobroActivo.value && !cobroActivo.value.pagado && restante.value === 0);
const minutos = computed(() => {
  const s = Math.floor(restante.value / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});

async function generarCobro() {
  const monto = montoValido(cobroMonto.value);
  if (!monto) {
    aviso.value = 'Escribe cuánto cobras. Por ejemplo: 18,50';
    return;
  }
  aviso.value = '';
  trabajando.value = true;
  try {
    const r = await api.cobrar({
      monto,
      rubro: cobroRubro.value,
      ...(esEmpresa.value ? { comercioId: yo.value.id } : {}),
    });
    // El contador arranca ahora mismo, no en el ultimo tic del reloj: si no,
    // empezaria mostrando 10:01.
    ahora.value = Date.now();
    cobroActivo.value = { ...r.cobro, pagado: false, venceLocal: ahora.value + r.cobro.vigencia * 1000 };
  } catch (e) {
    aviso.value = e.message;
  } finally {
    trabajando.value = false;
  }
}

async function nuevoCobro() {
  cobroActivo.value = null;
  cobroMonto.value = '';
  await nextTick();
  campoMonto.value?.focus();
}

// --- Lo recibido, leido de la red ------------------------------------------

const enLaRed = ref(null);
const recibidos = ref([]);
async function cargar() {
  if (!yo.value || !estado.yo) {
    enLaRed.value = null;
    recibidos.value = [];
    return;
  }
  const { horizon, activo, emisor } = estado.yo;
  try {
    [enLaRed.value, recibidos.value] = await Promise.all([
      saldoEnLaRed(horizon, yo.value.cuenta_publica, activo, emisor),
      pagosRecibidos(horizon, yo.value.cuenta_publica, activo, emisor, 50),
    ]);
  } catch {
    // Se conserva lo ultimo que se vio: el aviso en vivo sigue funcionando.
  }
}
const deHoy = computed(() => {
  const hoy = new Date().toDateString();
  return recibidos.value.filter((p) => new Date(p.fecha).toDateString() === hoy);
});
const totalHoy = computed(() => deHoy.value.reduce((s, p) => s + Number(p.monto), 0));

// --- Aviso en vivo, en pantalla y en voz alta ------------------------------

const leerPreferencia = () => {
  try { return localStorage.getItem('stellarrail-voz') === '1'; } catch { return false; }
};
const voz = ref(leerPreferencia());
function cambiarVoz() {
  voz.value = !voz.value;
  try { localStorage.setItem('stellarrail-voz', voz.value ? '1' : '0'); } catch { /* sin almacenamiento */ }
  // Decir algo al activarla sirve tambien para desbloquear el audio: los
  // navegadores solo dejan hablar despues de que la persona toca algo.
  if (voz.value) hablar('Listo. Te avisaré en voz alta cuando te paguen.');
}

const recibido = ref(null);
let dejarDeEscuchar = () => {};
// Por el id: si no, cada recarga de datos cortaria el flujo en vivo y
// borraria el aviso de "te pagaron".
watch(() => yo.value?.id, () => {
  const c = yo.value;
  dejarDeEscuchar();
  recibido.value = null;
  cargar();
  if (!c || !estado.yo) return;
  const { horizon, activo, emisor } = estado.yo;
  dejarDeEscuchar = escucharPagos(horizon, c.cuenta_publica, activo, emisor, (pago) => {
    recibido.value = pago;
    navigator.vibrate?.([120, 60, 120]);
    if (voz.value) hablar(`Recibiste ${enPalabras(pago.monto)}.`);
    if (cobroActivo.value && !cobroActivo.value.pagado
      && Number(pago.monto) === Number(cobroActivo.value.monto)) {
      cobroActivo.value.pagado = true;
    }
    cargar();
  });
}, { immediate: true });

onUnmounted(() => {
  dejarDeEscuchar();
  clearInterval(reloj);
});

const hora = (f) => new Date(f).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
const imprimir = () => window.print();
</script>

<template>
  <!-- La empresa, en la demostracion con un solo dispositivo. -->
  <section v-if="esEmpresa && estado.comercios.length" class="tarjeta">
    <div class="campo">
      <label for="cual">Ver como</label>
      <select id="cual" v-model="elegido">
        <option v-for="c in estado.comercios" :key="c.id" :value="c.id">{{ c.nombre }}</option>
      </select>
    </div>
  </section>

  <!--
    Registro: solo el nombre es obligatorio. Muchas bodegas de Lima no tienen
    RUC o estan en el RUS: exigirlo dejaria fuera justo al usuario que decimos
    atender.
  -->
  <section v-if="!yo || esEmpresa" class="tarjeta">
    <template v-if="!esEmpresa">
      <h2>Acepta vales en tu tienda</h2>
      <p>Sin POS y sin comisión para ti. Registra tu tienda y la empresa la revisará.</p>
    </template>
    <h2 v-else>{{ estado.comercios.length ? 'Registrar otra tienda' : 'Registrar una tienda' }}</h2>
    <form @submit.prevent="registrar">
      <div class="campo">
        <label for="cn">Nombre de la tienda</label>
        <input id="cn" v-model="nuevo.nombre" required placeholder="Bodega Don Julio">
      </div>
      <div class="campo">
        <label for="cr">¿Qué vendes más?</label>
        <select id="cr" v-model="nuevo.rubro">
          <option v-for="(n, clave) in RUBROS" :key="clave" :value="clave">{{ n }}</option>
        </select>
      </div>
      <div class="pareja">
        <div class="campo">
          <label for="cd">Distrito <span class="apagado">(si quieres)</span></label>
          <input id="cd" v-model="nuevo.distrito" placeholder="San Juan de Lurigancho">
        </div>
        <div class="campo">
          <label for="ct">Teléfono <span class="apagado">(si quieres)</span></label>
          <input id="ct" v-model="nuevo.telefono" inputmode="tel" autocomplete="tel" placeholder="999 999 999">
        </div>
      </div>
      <button :class="{ principal: !esEmpresa }" :disabled="trabajando || !nuevo.nombre.trim()">
        {{ trabajando ? 'Un momento…' : 'Registrar' }}
      </button>
    </form>
  </section>

  <template v-if="yo">
    <section class="tarjeta">
      <div class="fila" style="border:none;padding:0">
        <h2 style="margin:0">{{ yo.nombre }}</h2>
        <span :class="['etiqueta', yo.estado === 'verificado' ? 'ok'
          : yo.estado === 'rechazado' ? 'no' : 'espera']">
          {{ yo.estado === 'verificado' ? 'Afiliada'
            : yo.estado === 'rechazado' ? 'No aprobada' : 'En revisión' }}
        </span>
      </div>
      <div v-if="yo.estado === 'pendiente'" class="aviso espera">
        <strong>Todavía no puedes cobrar</strong>
        La empresa aún no aprobó tu tienda. Si alguien intenta pagarte ahora,
        el pago no pasará.
      </div>
      <div v-else-if="yo.estado === 'rechazado'" class="aviso no">
        <strong>Tu tienda no fue aprobada</strong>
        No puedes cobrar vales de esta empresa.
      </div>
    </section>

    <div v-if="recibido" class="aviso ok aviso-grande" role="alert">
      <span class="pequeno">Te pagaron</span>
      <strong>{{ soles(recibido.monto) }}</strong>
      <span class="pequeno">
        a las {{ hora(recibido.fecha) }} ·
        <a :href="explorador(recibido.hash)" target="_blank" rel="noopener">ver comprobante</a>
      </span>
    </div>

    <section class="tarjeta">
      <h2>Cobrar</h2>
      <div class="modos" role="tablist" aria-label="Forma de cobrar">
        <button role="tab" :aria-selected="modo === 'monto'" @click="modo = 'monto'">
          <Icono nombre="moneda" /> Con monto
        </button>
        <button role="tab" :aria-selected="modo === 'fijo'" @click="modo = 'fijo'">
          <Icono nombre="qr" /> QR fijo
        </button>
      </div>

      <!-- Con monto: el cliente solo confirma. -->
      <div v-if="modo === 'monto'" role="tabpanel">
        <form v-if="!cobroActivo" @submit.prevent="generarCobro">
          <label for="cm" class="pregunta">¿Cuánto cobras?</label>
          <div class="campo-monto">
            <span aria-hidden="true">S/</span>
            <input
              id="cm" ref="campoMonto" v-model="cobroMonto" class="numero-grande"
              inputmode="decimal" autocomplete="off" placeholder="0,00" required>
          </div>
          <div class="campo">
            <label for="cru">Esta venta es de</label>
            <select id="cru" v-model="cobroRubro">
              <option v-for="(n, clave) in RUBROS" :key="clave" :value="clave">{{ n }}</option>
            </select>
          </div>
          <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
          <button class="principal" :disabled="trabajando">
            <Icono nombre="qr" :tamano="28" /> Mostrar QR para cobrar
          </button>
        </form>

        <div v-else-if="cobroActivo.pagado" class="resultado ok" role="status">
          <div class="sello ok"><Icono nombre="check" :tamano="56" /></div>
          <p class="titulo-resultado">¡Te pagaron!</p>
          <p class="monto-grande">{{ soles(cobroActivo.monto) }}</p>
          <button class="principal" @click="nuevoCobro">Nuevo cobro</button>
        </div>

        <div v-else-if="vencido" class="resultado">
          <p class="titulo-resultado">Este cobro venció</p>
          <p class="apagado">Pasaron 10 minutos sin que se pagara.</p>
          <button class="principal" @click="nuevoCobro">Cobrar otra vez</button>
        </div>

        <div v-else class="cobro-activo">
          <p class="apagado" style="margin:0">Cobro de</p>
          <p class="monto-grande">{{ soles(cobroActivo.monto) }}</p>
          <p class="apagado">{{ RUBROS[cobroActivo.rubro] }}</p>
          <Qr
            :texto="enlaceCobro(cobroActivo.token)" nivel="M" :tamano="260"
            :alt="`Código QR para pagar ${soles(cobroActivo.monto)} a ${yo.nombre}`" />
          <p class="grande">Pide al cliente que lo escanee con StellarRail</p>
          <p class="esperando" aria-live="polite">
            <span class="punto" aria-hidden="true" /> Esperando el pago · vence en {{ minutos }}
          </p>
          <button class="secundario" @click="nuevoCobro"><Icono nombre="x" /> Cancelar cobro</button>
        </div>
      </div>

      <!-- QR fijo: para imprimir y pegar en el mostrador. -->
      <div v-else role="tabpanel" class="cobro-activo">
        <Qr :texto="enlaceFijo(yo.codigo_corto)" :tamano="240" :alt="`Código QR de ${yo.nombre}`" />
        <p class="apagado" style="margin-bottom:0">Código de tu tienda</p>
        <p class="codigo">{{ agrupar(yo.codigo_corto) }}</p>
        <p>El cliente lo escanea y escribe el monto. Si su cámara no funciona, díctale el código.</p>
        <button class="secundario" @click="imprimir"><Icono nombre="imprimir" /> Imprimir cartel</button>
      </div>
    </section>

    <section class="tarjeta">
      <button class="interruptor" :aria-pressed="voz" @click="cambiarVoz">
        <Icono nombre="altavoz" />
        <span>Avisarme en voz alta cuando me paguen</span>
        <span class="estado-interruptor">{{ voz ? 'Sí' : 'No' }}</span>
      </button>
    </section>

    <section class="tarjeta">
      <h2>Hoy</h2>
      <div class="cifras">
        <div class="cifra"><b>{{ soles(totalHoy) }}</b><span>Recibiste hoy</span></div>
        <div class="cifra"><b>{{ deHoy.length }}</b><span>Pagos de hoy</span></div>
      </div>
      <div v-for="p in recibidos.slice(0, 10)" :key="p.id" class="fila">
        <div>
          <div class="nombre">{{ soles(p.monto) }}</div>
          <div class="apagado pequeno">
            {{ hora(p.fecha) }}<template v-if="p.rubro"> · {{ RUBROS[p.rubro] ?? p.rubro }}</template>
          </div>
        </div>
        <a :href="explorador(p.hash)" target="_blank" rel="noopener" class="pequeno">comprobante</a>
      </div>
      <p v-if="enLaRed && !recibidos.length" class="apagado">Todavía no recibiste pagos.</p>
      <p v-if="enLaRed" class="apagado pequeno" style="margin-top:10px">
        Total en vales: {{ soles(enLaRed.saldo) }}
      </p>
    </section>

    <!-- El cartel que se imprime: solo aparece al imprimir. -->
    <div class="cartel" aria-hidden="true">
      <p class="cartel-marca">StellarRail</p>
      <p class="cartel-titulo">Paga aquí con tu vale</p>
      <p class="cartel-tienda">{{ yo.nombre }}</p>
      <Qr :texto="enlaceFijo(yo.codigo_corto)" :tamano="420" alt="" />
      <p class="cartel-codigo">{{ agrupar(yo.codigo_corto) }}</p>
      <ol class="cartel-pasos">
        <li>Abre StellarRail</li>
        <li>Toca «Pagar con QR»</li>
        <li>Escribe el monto y confirma</li>
      </ol>
    </div>
  </template>
</template>
