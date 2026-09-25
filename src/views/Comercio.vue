<script setup>
/**
 * La pantalla de la tienda.
 *
 * Tres maneras de cobrar:
 *  - Con monto: la tienda escribe cuanto cobra y muestra el QR. El cliente
 *    solo confirma, sin escribir nada. Tambien se le puede enviar el cobro
 *    por WhatsApp, si paga desde otro lado o la camara no le funciona.
 *  - Con tarjeta: para quien no tiene smartphone. La tienda escribe el
 *    monto, escanea la tarjeta impresa y el cliente marca su PIN aqui.
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
  estado, enPalabras, hablar, montoValido, soles,
} from '../estado.js';
import {
  agrupar, enlaceCobro, enlaceFijo, leerTarjeta,
} from '../enlaces.js';
import { anunciarQr, avisarCambio, cercano } from '../marco.js';
import { RUBROS } from '../../lib/rubros.js';
import { TOPE_DIARIO_TARJETA } from '../../lib/reglas.js';
import Escaner from '../Escaner.vue';
import Icono from '../Icono.vue';
import Pin from '../Pin.vue';
import Prueba from '../Prueba.vue';
import Qr from '../Qr.vue';

defineProps({ codigo: { type: String, default: '' }, cobro: { type: String, default: '' } });

// La tienda de este celular. La API solo le devuelve la suya.
const yo = computed(() => estado.comercios[0] ?? null);
const trabajando = ref(false);

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
    const r = await api.cobrar({ monto, rubro: cobroRubro.value });
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

/**
 * El mismo cobro, enviado por WhatsApp con un enlace wa.me: no necesita la
 * API de WhatsApp Business ni ningun servicio de pago. El cliente abre el
 * enlace y confirma, igual que si hubiera escaneado el QR.
 */
const whatsapp = computed(() => {
  if (!cobroActivo.value || !yo.value) return '';
  const texto = `Paga ${soles(cobroActivo.value.monto)} a ${yo.value.nombre} con tu vale StellarRail. `
    + `Abre este enlace y confirma (vence en 10 minutos): ${enlaceCobro(cobroActivo.value.token)}`;
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
});

// Demostracion en tres pantallas: el QR que se ve aqui queda "al alcance"
// del trabajador de al lado. Fuera de esa vista no hace nada.
watch(
  [modo, () => cobroActivo.value?.token, () => cobroActivo.value?.pagado, vencido, () => yo.value?.codigo_corto],
  () => {
    if (modo.value === 'fijo' && yo.value) anunciarQr(enlaceFijo(yo.value.codigo_corto));
    else if (modo.value === 'monto' && cobroActivo.value && !cobroActivo.value.pagado && !vencido.value) {
      anunciarQr(enlaceCobro(cobroActivo.value.token));
    } else anunciarQr(null);
  },
  { immediate: true },
);

// --- Cobrar con tarjeta ------------------------------------------------------
// monto -> leer -> escribir? -> pin -> pagando -> hecho | rechazado

const pasoTarjeta = ref('monto');
const tarjeta = ref({ monto: '', numero: '', escrito: '', pin: '' });
const resultadoTarjeta = ref(null);
const avisoTarjeta = ref('');
const campoTarjeta = ref(null);

function reiniciarTarjeta() {
  pasoTarjeta.value = 'monto';
  tarjeta.value = { monto: '', numero: '', escrito: '', pin: '' };
  resultadoTarjeta.value = null;
  avisoTarjeta.value = '';
}

function continuarTarjeta() {
  const monto = montoValido(tarjeta.value.monto);
  if (!monto) {
    avisoTarjeta.value = 'Escribe cuánto cobras. Por ejemplo: 18,50';
    return;
  }
  avisoTarjeta.value = '';
  tarjeta.value.monto = monto;
  pasoTarjeta.value = 'leer';
}

function tarjetaLeida(numero) {
  const n = leerTarjeta(numero);
  if (!n) {
    avisoTarjeta.value = 'Ese número no es de una tarjeta StellarRail. Empieza con SR.';
    return;
  }
  avisoTarjeta.value = '';
  tarjeta.value.numero = n;
  tarjeta.value.pin = '';
  pasoTarjeta.value = 'pin';
}

async function escribirTarjeta() {
  pasoTarjeta.value = 'escribir';
  await nextTick();
  campoTarjeta.value?.focus();
}

async function cobrarConTarjeta() {
  avisoTarjeta.value = '';
  pasoTarjeta.value = 'pagando';
  try {
    const r = await api.pagar({
      tarjeta: tarjeta.value.numero,
      pin: tarjeta.value.pin,
      monto: tarjeta.value.monto,
      rubro: cobroRubro.value,
    });
    resultadoTarjeta.value = r;
    pasoTarjeta.value = r.pagado ? 'hecho' : 'rechazado';
    if (r.pagado && voz.value) {
      hablar(`Pago hecho: ${enPalabras(r.monto)}. Le quedan ${enPalabras(r.saldoRestante ?? 0)}.`);
    }
    avisarCambio();
    cargar();
  } catch (e) {
    if (e.datos?.requierePin) {
      avisoTarjeta.value = e.message;
      tarjeta.value.pin = '';
      pasoTarjeta.value = 'pin';
      return;
    }
    resultadoTarjeta.value = { pagado: false, controlDe: 'error', mensaje: e.message };
    pasoTarjeta.value = 'rechazado';
  }
}

const motivoTarjeta = computed(() => {
  const r = resultadoTarjeta.value;
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
watch(() => cercano.cambios, cargar);
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
  anunciarQr(null);
});

const hora = (f) => new Date(f).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
const imprimir = () => window.print();
</script>

<template>
  <section v-if="!yo" class="tarjeta">
    <p class="cargando">Cargando tu tienda…</p>
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
      <div class="modos tres-modos" role="tablist" aria-label="Forma de cobrar">
        <button role="tab" :aria-selected="modo === 'monto'" @click="modo = 'monto'">
          <Icono nombre="moneda" /> Con QR
        </button>
        <button role="tab" :aria-selected="modo === 'tarjeta'" @click="modo = 'tarjeta'">
          <Icono nombre="teclado" /> Con tarjeta
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
          <a class="boton si ancho" :href="whatsapp" target="_blank" rel="noopener">
            <Icono nombre="mensaje" /> Enviar el cobro por WhatsApp
          </a>
          <button class="secundario" @click="nuevoCobro"><Icono nombre="x" /> Cancelar cobro</button>
        </div>
      </div>

      <!-- Con tarjeta: para quien no tiene smartphone. -->
      <div v-else-if="modo === 'tarjeta'" role="tabpanel">
        <form v-if="pasoTarjeta === 'monto'" @submit.prevent="continuarTarjeta">
          <label for="tm" class="pregunta">¿Cuánto cobras?</label>
          <div class="campo-monto">
            <span aria-hidden="true">S/</span>
            <input
              id="tm" v-model="tarjeta.monto" class="numero-grande"
              inputmode="decimal" autocomplete="off" placeholder="0,00" required>
          </div>
          <p class="apagado pequeno">Con tarjeta se pueden pagar hasta S/ {{ TOPE_DIARIO_TARJETA }} por día, y siempre con PIN.</p>
          <p v-if="avisoTarjeta" class="aviso no" role="alert">{{ avisoTarjeta }}</p>
          <button class="principal"><Icono nombre="check" :tamano="26" /> Continuar</button>
        </form>

        <template v-else-if="pasoTarjeta === 'leer'">
          <p class="destino">Cobro de {{ soles(tarjeta.monto) }}</p>
          <p v-if="avisoTarjeta" class="aviso no" role="alert">{{ avisoTarjeta }}</p>
          <Escaner
            busca="tarjeta"
            @leido="(l) => tarjetaLeida(l.numero)"
            @escribir="escribirTarjeta"
            @cancelar="reiniciarTarjeta" />
        </template>

        <form v-else-if="pasoTarjeta === 'escribir'" @submit.prevent="tarjetaLeida(tarjeta.escrito)">
          <button type="button" class="enlace atras" @click="pasoTarjeta = 'leer'"><Icono nombre="atras" /> Atrás</button>
          <label for="tn" class="pregunta">Número de la tarjeta</label>
          <p class="apagado">Está impreso en la tarjeta. Empieza con SR.</p>
          <input
            id="tn" ref="campoTarjeta" v-model="tarjeta.escrito" class="numero-grande"
            autocomplete="off" autocapitalize="characters" placeholder="SR-XXXX-XXXX" required>
          <p v-if="avisoTarjeta" class="aviso no" role="alert">{{ avisoTarjeta }}</p>
          <button class="principal">Continuar</button>
        </form>

        <form v-else-if="pasoTarjeta === 'pin'" class="confirmacion" @submit.prevent="cobrarConTarjeta">
          <p class="aviso espera"><strong>Pasa el equipo al cliente</strong>Que marque su PIN sin que nadie lo vea.</p>
          <p class="monto-grande">{{ soles(tarjeta.monto) }}</p>
          <p class="destino">a {{ yo.nombre }}</p>
          <Pin v-model="tarjeta.pin" id="pin-tarjeta" etiqueta="Cliente: marca tu PIN" teclado />
          <p v-if="avisoTarjeta" class="aviso no" role="alert">{{ avisoTarjeta }}</p>
          <button class="principal si" :disabled="tarjeta.pin.length !== 4">
            <Icono nombre="check" :tamano="28" /> Pagar
          </button>
          <button type="button" class="secundario" @click="reiniciarTarjeta"><Icono nombre="x" /> Cancelar</button>
        </form>

        <div v-else-if="pasoTarjeta === 'pagando'" class="resultado" aria-live="polite">
          <div class="girando" aria-hidden="true" />
          <p class="titulo-resultado">Cobrando…</p>
          <p class="apagado">Tarda unos segundos.</p>
        </div>

        <div v-else-if="pasoTarjeta === 'hecho'" class="resultado ok" role="status">
          <div class="sello ok"><Icono nombre="check" :tamano="56" /></div>
          <p class="titulo-resultado">¡Pago hecho!</p>
          <p class="monto-grande">{{ soles(resultadoTarjeta.monto) }}</p>
          <p>Pagó {{ resultadoTarjeta.pagador }}.</p>
          <p v-if="resultadoTarjeta.saldoRestante">Le quedan <b>{{ soles(resultadoTarjeta.saldoRestante) }}</b> en su vale.</p>
          <button class="principal" @click="reiniciarTarjeta">Nuevo cobro</button>
          <details>
            <summary>Ver comprobante</summary>
            <Prueba :tx="resultadoTarjeta.transaccion" />
          </details>
        </div>

        <div v-else-if="pasoTarjeta === 'rechazado'" class="resultado no" role="alert">
          <div class="sello no"><Icono nombre="x" :tamano="56" /></div>
          <p class="titulo-resultado">No se pudo cobrar</p>
          <p class="motivo">{{ motivoTarjeta }}</p>
          <p><b>No se le cobró nada al cliente.</b></p>
          <p v-if="resultadoTarjeta.controlDe === 'red'" class="apagado pequeno">Lo rechazó la red de pagos, no esta aplicación.</p>
          <p v-else-if="resultadoTarjeta.controlDe === 'aplicacion'" class="apagado pequeno">Es una regla del programa: no se envió ningún pago.</p>
          <button class="principal" @click="reiniciarTarjeta">Entendido</button>
          <details v-if="resultadoTarjeta.transaccion">
            <summary>Detalles</summary>
            <Prueba :tx="resultadoTarjeta.transaccion" />
          </details>
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
