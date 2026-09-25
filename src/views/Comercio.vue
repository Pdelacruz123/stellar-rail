<script setup>
/**
 * La pantalla de la tienda.
 *
 * Cobrar funciona como un vale de alimentos real: el cajero escribe el monto
 * y elige como paga el cliente.
 *  - Con su celular: se muestra un QR de cobro con un codigo de 6 numeros
 *    debajo. El cliente lo escanea o escribe el codigo, y confirma en su
 *    celular. Cuando paga, aqui se ve "¡Te pagaron!".
 *  - Con tarjeta (quien no tiene smartphone): se escanea o escribe el numero
 *    de su tarjeta y el cliente marca su PIN en este equipo.
 *
 * El rubro de la tienda se fija al afiliarla: no se elige en cada venta. Que
 * con el vale se compren solo productos permitidos es responsabilidad del
 * cajero, como con cualquier tarjeta de alimentos.
 */
import {
  computed, nextTick, onUnmounted, ref, watch,
} from 'vue';
import {
  api, escucharPagos, explorador, pagosRecibidos, saldoEnLaRed,
} from '../api.js';
import {
  estado, enPalabras, hablar, montoValido, soles,
} from '../estado.js';
import { agrupar, enlaceCobro, leerQr, leerTarjeta } from '../enlaces.js';
import { RUBROS } from '../../lib/rubros.js';
import { TOPE_DIARIO_TARJETA } from '../../lib/reglas.js';
import Escaner from '../Escaner.vue';
import Icono from '../Icono.vue';
import Pin from '../Pin.vue';
import Prueba from '../Prueba.vue';
import Qr from '../Qr.vue';

// La tienda de este equipo. La API solo le devuelve la suya.
const yo = computed(() => estado.comercios[0] ?? null);
const puedeCobrar = computed(() => yo.value && yo.value.estado !== 'rechazado');

// --- Cobrar -----------------------------------------------------------------
// monto -> qr (espera el pago) | tarjeta -> pin -> cobrando -> hecho | rechazado

const paso = ref('monto');
const monto = ref('');
const aviso = ref('');
const trabajando = ref(false);
const cobroActivo = ref(null);    // { token, codigo, monto, venceLocal, pagado }
const tarjeta = ref({ numero: '', escrito: '', pin: '' });
const hayCamara = ref(true);
const resultado = ref(null);
const campoMonto = ref(null);
const campoTarjeta = ref(null);

const ahora = ref(Date.now());
const reloj = setInterval(() => { ahora.value = Date.now(); }, 1000);
const restante = computed(() => (cobroActivo.value ? Math.max(0, cobroActivo.value.venceLocal - ahora.value) : 0));
const vencido = computed(() => paso.value === 'qr' && cobroActivo.value && !cobroActivo.value.pagado && restante.value === 0);
const minutos = computed(() => {
  const s = Math.floor(restante.value / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});

async function nuevoCobro() {
  paso.value = 'monto';
  monto.value = '';
  aviso.value = '';
  cobroActivo.value = null;
  tarjeta.value = { numero: '', escrito: '', pin: '' };
  resultado.value = null;
  await nextTick();
  campoMonto.value?.focus();
}

function montoListo() {
  const m = montoValido(monto.value);
  if (!m) {
    aviso.value = 'Escribe cuánto cobras. Por ejemplo: 18,50';
    return null;
  }
  aviso.value = '';
  monto.value = m;
  return m;
}

/** El cliente paga con su celular: se genera el QR con su codigo de 6 numeros. */
async function cobrarConQr() {
  const m = montoListo();
  if (!m) return;
  trabajando.value = true;
  try {
    const r = await api.cobrar({ monto: m });
    // La cuenta atras arranca ahora mismo, sin comparar relojes con el servidor.
    ahora.value = Date.now();
    cobroActivo.value = { ...r.cobro, pagado: false, venceLocal: ahora.value + r.cobro.vigencia * 1000 };
    paso.value = 'qr';
  } catch (e) {
    aviso.value = e.message;
  } finally {
    trabajando.value = false;
  }
}

/** El cliente tiene tarjeta: se lee su numero y marca su PIN aqui. */
async function cobrarConTarjeta() {
  if (!montoListo()) return;
  hayCamara.value = true;
  tarjeta.value = { numero: '', escrito: '', pin: '' };
  paso.value = 'tarjeta';
  await nextTick();
  campoTarjeta.value?.focus();
}

function tarjetaLeida(texto) {
  const n = leerTarjeta(texto) ?? (leerQr(texto)?.tipo === 'tarjeta' ? leerQr(texto).numero : null);
  if (!n) {
    aviso.value = 'Ese número no es de una tarjeta StellarRail. Empieza con SR.';
    return;
  }
  aviso.value = '';
  tarjeta.value.numero = n;
  tarjeta.value.pin = '';
  paso.value = 'pin';
}

async function pagarConTarjeta() {
  aviso.value = '';
  paso.value = 'cobrando';
  try {
    const r = await api.pagar({ tarjeta: tarjeta.value.numero, pin: tarjeta.value.pin, monto: monto.value });
    resultado.value = r;
    paso.value = r.pagado ? 'hecho' : 'rechazado';
    if (r.pagado && voz.value) {
      hablar(`Cobro hecho: ${enPalabras(r.monto)}. Le quedan ${enPalabras(r.saldoRestante ?? 0)}.`);
    }
    cargar();
  } catch (e) {
    if (e.datos?.requierePin) {
      aviso.value = e.message;
      tarjeta.value.pin = '';
      paso.value = 'pin';
      return;
    }
    resultado.value = { pagado: false, controlDe: 'error', mensaje: e.message };
    paso.value = 'rechazado';
  }
}

const motivo = computed(() => {
  const r = resultado.value;
  if (!r) return '';
  if (r.controlDe === 'red') return r.transaccion?.mensaje ?? 'El pago no pasó.';
  return r.mensaje;
});

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

let dejarDeEscuchar = () => {};
// Por el id: si no, cada recarga de datos cortaria el flujo en vivo.
watch(() => yo.value?.id, () => {
  const c = yo.value;
  dejarDeEscuchar();
  cargar();
  if (!c || !estado.yo) return;
  const { horizon, activo, emisor } = estado.yo;
  dejarDeEscuchar = escucharPagos(horizon, c.cuenta_publica, activo, emisor, (pago) => {
    navigator.vibrate?.([120, 60, 120]);
    if (voz.value) hablar(`Recibiste ${enPalabras(pago.monto)}.`);
    if (paso.value === 'qr' && cobroActivo.value && !cobroActivo.value.pagado
      && Number(pago.monto) === Number(cobroActivo.value.monto)) {
      cobroActivo.value.pagado = true;
      cobroActivo.value.hash = pago.hash;
    }
    cargar();
  });
}, { immediate: true });

onUnmounted(() => {
  dejarDeEscuchar();
  clearInterval(reloj);
});

const hora = (f) => new Date(f).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <section v-if="!yo" class="tarjeta">
    <p class="cargando">Cargando tu tienda…</p>
  </section>

  <template v-if="yo">
    <!-- En computadora, dos columnas: cobrar a la izquierda, lo del dia a la derecha. -->
    <div :class="['columnas', { sola: yo.estado === 'rechazado' }]">
      <div class="columna">
        <section class="tarjeta">
          <div class="fila" style="border:none;padding:0">
            <div>
              <h2 style="margin:0">{{ yo.nombre }}</h2>
              <p class="apagado pequeno" style="margin:0">{{ RUBROS[yo.rubro] ?? '' }}<template v-if="yo.distrito"> · {{ yo.distrito }}</template></p>
            </div>
            <span :class="['etiqueta', yo.estado === 'verificado' ? 'ok' : yo.estado === 'rechazado' ? 'no' : 'espera']">
              {{ yo.estado === 'verificado' ? 'Afiliada' : yo.estado === 'rechazado' ? 'No aprobada' : 'En revisión' }}
            </span>
          </div>
          <div v-if="yo.estado === 'pendiente'" class="aviso espera">
            <strong>Tu tienda aún no está afiliada</strong>
            Mientras la empresa no la apruebe, la red de pagos rechazará los cobros.
          </div>
          <div v-else-if="yo.estado === 'rechazado'" class="aviso no">
            <strong>Tu tienda no fue aprobada</strong>
            No puedes cobrar vales de esta empresa.
          </div>
        </section>

        <section v-if="puedeCobrar" class="tarjeta">
          <h2>Cobrar</h2>

          <!-- ============ MONTO ============ -->
          <form v-if="paso === 'monto'" @submit.prevent="cobrarConQr">
            <label for="cm" class="pregunta">¿Cuánto cobras?</label>
            <div class="campo-monto">
              <span aria-hidden="true">S/</span>
              <input
                id="cm" ref="campoMonto" v-model="monto" class="numero-grande"
                inputmode="decimal" autocomplete="off" placeholder="0,00" required>
            </div>
            <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
            <button class="principal" :disabled="trabajando">
              <Icono nombre="qr" :tamano="28" /> {{ trabajando ? 'Generando…' : 'Cobrar con QR' }}
            </button>
            <button type="button" class="secundario" @click="cobrarConTarjeta">
              <Icono nombre="tarjeta" /> El cliente tiene tarjeta
            </button>
            <p class="apagado pequeno" style="margin-top:12px">
              Con el vale solo se pueden cobrar los productos que cubre el programa de la
              empresa, por ejemplo alimentos. Cobrar solo esos productos es tu responsabilidad.
            </p>
          </form>

          <!-- ============ QR DE COBRO ============ -->
          <template v-else-if="paso === 'qr'">
            <div v-if="cobroActivo.pagado" class="resultado ok" role="status">
              <div class="sello ok"><Icono nombre="check" :tamano="56" /></div>
              <p class="titulo-resultado">¡Te pagaron!</p>
              <p class="monto-grande">{{ soles(cobroActivo.monto) }}</p>
              <p v-if="cobroActivo.hash" class="pequeno"><a :href="explorador(cobroActivo.hash)" target="_blank" rel="noopener">ver comprobante</a></p>
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
              <Qr
                :texto="enlaceCobro(cobroActivo.token)" nivel="M" :tamano="240"
                :alt="`Código QR para pagar ${soles(cobroActivo.monto)} a ${yo.nombre}`" />
              <p class="apagado" style="margin-bottom:0">Si no puede escanear, que escriba este código:</p>
              <p class="codigo">{{ agrupar(cobroActivo.codigo) }}</p>
              <p class="esperando" aria-live="polite">
                <span class="punto" aria-hidden="true" /> Esperando el pago · vence en {{ minutos }}
              </p>
              <button class="secundario" @click="nuevoCobro"><Icono nombre="x" /> Cancelar cobro</button>
            </div>
          </template>

          <!-- ============ TARJETA: leer su numero ============ -->
          <template v-else-if="paso === 'tarjeta'">
            <button class="enlace atras" @click="nuevoCobro"><Icono nombre="atras" /> Atrás</button>
            <p class="destino">Cobro de {{ soles(monto) }} con tarjeta</p>
            <Escaner v-if="hayCamara" etiqueta="Cámara para escanear la tarjeta" @leido="tarjetaLeida" @sin-camara="hayCamara = false" />
            <form @submit.prevent="tarjetaLeida(tarjeta.escrito)">
              <label for="tn">{{ hayCamara ? 'Escanea la tarjeta o escribe su número' : 'Número de la tarjeta (empieza con SR)' }}</label>
              <input
                id="tn" ref="campoTarjeta" v-model="tarjeta.escrito" class="numero-grande"
                autocomplete="off" autocapitalize="characters" placeholder="SR-XXXX-XXXX">
              <p class="apagado pequeno">Con tarjeta se pueden pagar hasta S/ {{ TOPE_DIARIO_TARJETA }} por día, siempre con PIN.</p>
              <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
              <button class="principal">Continuar</button>
            </form>
          </template>

          <!-- ============ TARJETA: PIN del cliente ============ -->
          <form v-else-if="paso === 'pin'" class="confirmacion" @submit.prevent="pagarConTarjeta">
            <p class="aviso espera"><strong>Pasa el equipo al cliente</strong>Que marque su PIN sin que nadie lo vea.</p>
            <p class="monto-grande">{{ soles(monto) }}</p>
            <p class="destino">a {{ yo.nombre }}</p>
            <Pin v-model="tarjeta.pin" id="pin-tarjeta" etiqueta="Cliente: marca tu PIN" teclado destacado />
            <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
            <button class="principal si" :disabled="tarjeta.pin.length !== 4">
              <Icono nombre="check" :tamano="28" /> Pagar
            </button>
            <button type="button" class="secundario" @click="nuevoCobro"><Icono nombre="x" /> Cancelar</button>
          </form>

          <div v-else-if="paso === 'cobrando'" class="resultado" aria-live="polite">
            <div class="girando" aria-hidden="true" />
            <p class="titulo-resultado">Cobrando…</p>
            <p class="apagado">Tarda unos segundos.</p>
          </div>

          <div v-else-if="paso === 'hecho'" class="resultado ok" role="status">
            <div class="sello ok"><Icono nombre="check" :tamano="56" /></div>
            <p class="titulo-resultado">¡Pago hecho!</p>
            <p class="monto-grande">{{ soles(resultado.monto) }}</p>
            <p>Pagó {{ resultado.pagador }}.</p>
            <p v-if="resultado.saldoRestante">Le quedan <b>{{ soles(resultado.saldoRestante) }}</b> en su vale.</p>
            <button class="principal" @click="nuevoCobro">Nuevo cobro</button>
            <details>
              <summary>Ver comprobante</summary>
              <Prueba :tx="resultado.transaccion" />
            </details>
          </div>

          <div v-else-if="paso === 'rechazado'" class="resultado no" role="alert">
            <div class="sello no"><Icono nombre="x" :tamano="56" /></div>
            <p class="titulo-resultado">No se pudo cobrar</p>
            <p class="motivo">{{ motivo }}</p>
            <p><b>No se le cobró nada al cliente.</b></p>
            <p v-if="resultado.controlDe === 'red'" class="apagado pequeno">Lo rechazó la red de pagos, no esta aplicación.</p>
            <p v-else-if="resultado.controlDe === 'aplicacion'" class="apagado pequeno">Es una regla del programa: no se envió ningún pago.</p>
            <button class="principal" @click="nuevoCobro">Entendido</button>
            <details v-if="resultado.transaccion">
              <summary>Detalles</summary>
              <Prueba :tx="resultado.transaccion" />
            </details>
          </div>
        </section>
      </div>

      <div v-if="puedeCobrar" class="columna">
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
              <div class="apagado pequeno">{{ hora(p.fecha) }}</div>
            </div>
            <a :href="explorador(p.hash)" target="_blank" rel="noopener" class="pequeno">comprobante</a>
          </div>
          <p v-if="enLaRed && recibidos.length" class="apagado pequeno" style="margin-top:10px">
            Total recibido en vales: {{ soles(enLaRed.saldo) }}
          </p>
        </section>
      </div>
    </div>
  </template>
</template>
