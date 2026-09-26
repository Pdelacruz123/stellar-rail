<script setup>
/**
 * La pantalla del trabajador: su vale, como pagar y donde usarlo.
 *
 * Paga como en las apps de vales de verdad, y nunca escribe un monto:
 *  - Escanear QR: la tienda escribe el monto y le muestra un QR. Lo escanea,
 *    ve a quien le paga y cuanto, y confirma (con su PIN si pasa de S/ 50).
 *  - Mi codigo: como el codigo de aprobacion de Yape. Con su PIN genera un
 *    codigo de 6 numeros que vale unos minutos y sirve para un solo pago, y
 *    se lo dicta a la tienda. Aqui ve al instante cuando le cobran.
 *
 * Pensada para alguien que no se maneja bien con el celular: lo importante a
 * la vista al entrar, botones grandes con icono y palabra, el resultado a
 * pantalla completa, nada tecnico y todo se puede escuchar.
 */
import {
  computed, nextTick, onUnmounted, ref, watch,
} from 'vue';
import {
  api, explorador, movimientosDelVale, saldoEnLaRed,
} from '../api.js';
import {
  estado, enPalabras, fecha, hablar, programaVigente, recargar, soles,
} from '../estado.js';
import { agrupar, leerQr } from '../enlaces.js';
import { RUBROS, TIPOS } from '../../lib/rubros.js';
import { UMBRAL_PIN } from '../../lib/reglas.js';
import Escaner from '../Escaner.vue';
import Icono from '../Icono.vue';
import Pin from '../Pin.vue';
import Prueba from '../Prueba.vue';

const props = defineProps({
  // Un cobro abierto con la camara del celular: #/cobro/<token>
  cobro: { type: String, default: '' },
});

// El trabajador de este celular. La API solo le devuelve a el.
const yo = computed(() => estado.beneficiarios[0] ?? null);

const primerNombre = computed(() => (yo.value?.nombre ?? '').split(' ')[0]);
const programa = computed(() => programaVigente());
const rubrosDelPrograma = computed(() => (programa.value?.rubros ?? [])
  .map((r) => RUBROS[r] ?? r).join(', ').toLowerCase());
// Donde sirve el vale: tiendas afiliadas y del rubro que cubre el programa.
const afiliados = computed(() => estado.comercios.filter((c) => c.afiliado
  && (!programa.value || (programa.value.rubros ?? []).includes(c.rubro))));
// --- Saldo y movimientos, leidos de la red cada vez. Nunca los guardamos. --

const enLaRed = ref(null);
const errorSaldo = ref('');
const movimientos = ref([]);
async function cargarSaldo() {
  if (!yo.value || !estado.yo) { enLaRed.value = null; return; }
  const { horizon, activo, emisor } = estado.yo;
  try {
    [enLaRed.value, movimientos.value] = await Promise.all([
      saldoEnLaRed(horizon, yo.value.cuenta_publica, activo, emisor),
      movimientosDelVale(horizon, yo.value.cuenta_publica, activo, emisor, 8).catch(() => movimientos.value),
    ]);
    errorSaldo.value = '';
  } catch (e) {
    errorSaldo.value = e.message;
  }
}
// Aprobado, o dado de baja con lo que ya recibio: lo puede seguir usando.
const tieneVale = computed(() => yo.value?.estado === 'verificado'
  || (yo.value?.estado === 'baja' && Number(enLaRed.value?.saldo ?? 0) > 0));

// Que tarjeta del vale mostrar. Quien se dio de baja la ve mientras se lee
// su saldo ("Viendo tu saldo…") y despues solo si le queda algo.
const mostrarVale = computed(() => {
  if (yo.value?.estado === 'baja') return enLaRed.value === null || tieneVale.value;
  return tieneVale.value;
});

const recibioElVale = computed(() => (programa.value?.recibieron ?? []).includes(yo.value?.id));
watch([() => yo.value?.id, () => yo.value?.estado, recibioElVale], cargarSaldo, { immediate: true });

// Aprobado, pero la empresa todavia no le entrego el vale.
const sinValeAun = computed(() => yo.value?.estado === 'verificado' && enLaRed.value
  && !enLaRed.value.congelado && Number(enLaRed.value.saldo) === 0 && !recibioElVale.value
  && !movimientos.value.length);
// Solo se ofrece pagar si hay con que.
const puedePagar = computed(() => tieneVale.value && !enLaRed.value?.congelado
  && Number(enLaRed.value?.saldo ?? 0) > 0);

/** A quien se le pago o de quien vino, en palabras. */
function describir(m) {
  if (m.entra) return m.contraparte === estado.yo?.emisor ? 'Te entregaron tu vale' : 'Recibiste';
  const tienda = estado.comercios.find((c) => c.cuenta_publica === m.contraparte);
  return tienda ? `Pagaste en ${tienda.nombre}` : 'Pagaste en una tienda';
}
const cuando = (f) => new Date(f).toLocaleString('es-PE', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const iniciales = (n) => String(n ?? '').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

function escucharSaldo() {
  if (!enLaRed.value) return;
  hablar(enLaRed.value.congelado
    ? 'Tu vale venció y ya no se puede usar.'
    : `Tienes ${enPalabras(enLaRed.value.saldo)} en tu vale.`);
}

// --- Pagar ------------------------------------------------------------------
// inicio -> escanear -> confirmar -> pagando -> hecho | rechazado
// inicio -> codigo (PIN -> codigo en pantalla, esperando) -> hecho

const pantalla = ref('inicio');
const cobro = ref(null);       // { cobro, monto, rubro, comercio, cubierto, yaPagado, requierePin }
const pin = ref('');
const aviso = ref('');
const pago = ref(null);        // lo que se muestra al final: { monto, tienda, transaccion, pagado, controlDe, mensaje }
const hayCamara = ref(true);
// Si la persona vuelve al inicio mientras se busca un cobro, la respuesta
// que llega tarde se descarta: no reabre una pantalla que ella ya cerro.
let vuelta = 0;

function reiniciar() {
  vuelta += 1;
  pararEspera();
  pantalla.value = 'inicio';
  cobro.value = null;
  codigo.value = null;
  pin.value = '';
  aviso.value = '';
  pago.value = null;
  // Se limpia el enlace del QR: si se recarga la pagina, no vuelve a abrirlo.
  if (props.cobro) window.location.hash = '#/';
}

function abrirEscaner() {
  aviso.value = '';
  hayCamara.value = true;
  pantalla.value = 'escanear';
}

/** Busca el cobro del QR y lo muestra para confirmar. */
async function verCobro(token) {
  const mia = ++vuelta;
  aviso.value = '';
  try {
    const c = await api.verCobro(token);
    if (mia !== vuelta) return;
    cobro.value = c;
    pin.value = '';
    pantalla.value = 'confirmar';
  } catch (e) {
    if (mia !== vuelta) return;
    aviso.value = e.message;
  }
}

function alLeerQr(texto) {
  const leido = leerQr(texto);
  if (leido?.tipo !== 'cobro') {
    aviso.value = 'Ese QR no es un cobro de StellarRail. Escanea el que te muestra la tienda.';
    return;
  }
  verCobro(leido.token);
}

// Un cobro abierto con la camara del celular. Espera a saber quien es y
// cuanto tiene; se atiende una sola vez, y si no se puede pagar se dice por que.
let enlaceAtendido = '';
watch(
  [() => props.cobro, () => yo.value?.id, () => enLaRed.value !== null],
  ([enlace, id, saldoListo]) => {
    if (!enlace || enlace === enlaceAtendido || !id || !saldoListo) return;
    enlaceAtendido = enlace;
    if (!tieneVale.value) aviso.value = 'Todavía no puedes pagar: tu empresa aún no te aprueba.';
    else if (enLaRed.value.congelado) aviso.value = 'No se puede pagar: tu vale venció.';
    else if (!puedePagar.value) aviso.value = 'No tienes saldo en tu vale para pagar.';
    else verCobro(enlace);
  },
  { immediate: true },
);

const necesitaPin = computed(() => Boolean(cobro.value?.requierePin));
const alcanza = computed(() => !cobro.value || Number(enLaRed.value?.saldo ?? 0) >= Number(cobro.value.monto));

async function confirmar() {
  aviso.value = '';
  pantalla.value = 'pagando';
  try {
    const r = await api.pagar({
      cobro: cobro.value.cobro,
      ...(necesitaPin.value ? { pin: pin.value } : {}),
    });
    pago.value = {
      pagado: r.pagado,
      controlDe: r.controlDe,
      mensaje: r.controlDe === 'red' && !r.pagado ? r.transaccion?.mensaje : r.mensaje,
      monto: cobro.value.monto,
      tienda: cobro.value.comercio.nombre,
      transaccion: r.transaccion,
    };
    await cargarSaldo();
    pantalla.value = r.pagado ? 'hecho' : 'rechazado';
  } catch (e) {
    if (e.datos?.requierePin) {
      // PIN equivocado o bloqueado: se queda en la confirmacion para reintentar.
      aviso.value = e.message;
      pin.value = '';
      pantalla.value = 'confirmar';
      return;
    }
    pago.value = { pagado: false, controlDe: 'error', mensaje: e.message };
    pantalla.value = 'rechazado';
  }
  await recargar();
}

// --- Mi codigo de pago --------------------------------------------------------

const codigo = ref(null);      // { codigo, venceLocal }
const generando = ref(false);
const intento = ref(null);     // el ultimo cobro con el codigo que no paso
const ahora = ref(Date.now());
let reloj = null;
let espera = null;

function pararEspera() {
  clearInterval(reloj);
  clearInterval(espera);
  reloj = null;
  espera = null;
}
onUnmounted(pararEspera);

const restante = computed(() => (codigo.value ? Math.max(0, codigo.value.venceLocal - ahora.value) : 0));
const codigoVencido = computed(() => Boolean(codigo.value) && restante.value === 0);
const minutos = computed(() => {
  const seg = Math.floor(restante.value / 1000);
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
});

function abrirCodigo() {
  aviso.value = '';
  pin.value = '';
  codigo.value = null;
  intento.value = null;
  pantalla.value = 'codigo';
}

async function generarCodigo() {
  aviso.value = '';
  generando.value = true;
  try {
    const r = await api.miCodigo(pin.value);
    pin.value = '';
    intento.value = null;
    // La cuenta atras arranca ahora mismo, sin comparar relojes con el servidor.
    ahora.value = Date.now();
    codigo.value = { codigo: r.codigo, venceLocal: ahora.value + r.vigencia * 1000 };
    pararEspera();
    reloj = setInterval(() => { ahora.value = Date.now(); }, 1000);
    espera = setInterval(revisarCodigo, 2000);
    await nextTick();
    hablar(`Tu código es ${r.codigo.split('').join(' ')}.`);
  } catch (e) {
    aviso.value = e.message;
    pin.value = '';
  } finally {
    generando.value = false;
  }
}

/** Mira si la tienda ya cobro con el codigo, o si lo intento y no paso. */
async function revisarCodigo() {
  if (!codigo.value || pantalla.value !== 'codigo') return;
  if (codigoVencido.value) { pararEspera(); return; }
  let r;
  try { r = await api.estadoCodigo(codigo.value.codigo); } catch { return; }
  const u = r.ultimo;
  if (r.usado && u?.pagado) {
    pararEspera();
    pago.value = {
      pagado: true,
      monto: u.monto,
      tienda: u.comercio?.nombre,
      transaccion: u.hash ? { ok: true, hash: u.hash, explorador: explorador(u.hash) } : null,
    };
    await cargarSaldo();
    pantalla.value = 'hecho';
    await recargar();
    return;
  }
  if (u && !u.pagado && u.fecha !== intento.value?.fecha) {
    intento.value = u;
    hablar(`${u.comercio?.nombre ?? 'Una tienda'} intentó cobrarte y no se pudo. No se te cobró nada.`);
  }
}

// --- Resultado ----------------------------------------------------------------

function escucharResultado() {
  if (pago.value?.pagado) {
    hablar(`Pagaste ${enPalabras(pago.value.monto)} a ${pago.value.tienda}. `
      + `Te quedan ${enPalabras(enLaRed.value?.saldo ?? 0)}.`);
  } else {
    hablar(`No se pudo pagar. ${pago.value?.mensaje ?? ''} No se te cobró nada.`);
  }
}
</script>

<template>
  <section v-if="!yo" class="tarjeta">
    <p class="cargando">Cargando tu vale…</p>
  </section>

  <template v-if="yo">
    <!-- ============ INICIO: con que y donde pagar ============ -->
    <div v-if="pantalla === 'inicio'" class="columnas">
      <div class="columna">
        <p class="saludo">Hola, {{ primerNombre }}</p>

        <div v-if="yo.estado === 'pendiente'" class="aviso espera">
          <strong>Tu registro está en revisión</strong>
          Te avisaremos aquí cuando tu empresa te apruebe.
        </div>
        <div v-else-if="yo.estado === 'rechazado'" class="aviso no">
          <strong>Tu registro no fue aprobado</strong>
          Consulta con Recursos Humanos.
        </div>
        <div v-else-if="yo.estado === 'baja'" class="aviso espera">
          <strong>Ya no recibes vales nuevos de esta empresa</strong>
          <template v-if="tieneVale && programa">Lo que te queda es tuyo: úsalo hasta el {{ fecha(programa.vence_el) }}.</template>
        </div>
        <div v-else-if="sinValeAun" class="aviso ok">
          <strong>Tu registro fue aprobado</strong>
          Cuando tu empresa te entregue el vale, lo verás aquí.
        </div>

        <!-- El vale, como una tarjeta de verdad -->
        <template v-if="!mostrarVale || sinValeAun" />
        <div v-else-if="enLaRed" :class="['vale', { congelado: enLaRed.congelado }]">
          <div class="vale-arriba">
            <span class="vale-programa">{{ enLaRed.congelado ? 'Tu vale venció' : (programa?.nombre ?? 'Tu vale') }}</span>
            <img class="vale-logo" src="/logo.svg" alt="">
          </div>
          <span class="vale-etiqueta">{{ enLaRed.congelado ? 'Ya no se puede usar' : 'Disponible' }}</span>
          <b class="vale-saldo">{{ soles(enLaRed.saldo) }}</b>
          <div v-if="!enLaRed.congelado && programa" class="vale-abajo">
            <span>Hasta el {{ fecha(programa.vence_el) }}</span>
            <span class="vale-rubro">{{ rubrosDelPrograma }}</span>
          </div>
          <span v-if="!enLaRed.congelado && TIPOS[programa?.tipo]?.recargable" class="vale-nota">
            Tu empresa lo recarga cada mes. Lo que no usas se acumula.
          </span>
        </div>
        <div v-else-if="errorSaldo" class="aviso espera" role="alert">
          <strong>No pudimos ver tu saldo</strong>
          Tu dinero está bien: es solo la conexión.
          <button class="secundario" @click="cargarSaldo">Intentar otra vez</button>
        </div>
        <p v-else class="cargando">Viendo tu saldo…</p>

        <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>

        <!-- Como pagar: las dos formas, grandes y a la vista -->
        <section v-if="puedePagar" class="formas-pago" aria-labelledby="como-pagar">
          <h2 id="como-pagar" class="seccion-titulo">¿Cómo quieres pagar?</h2>
          <div class="formas">
            <button class="forma principal-forma" @click="abrirEscaner">
              <span class="forma-icono"><Icono nombre="qr" :tamano="30" /></span>
              <span class="forma-texto"><b>Escanear QR</b><span>La tienda te muestra un QR con el monto</span></span>
            </button>
            <button class="forma" @click="abrirCodigo">
              <span class="forma-icono"><Icono nombre="codigo" :tamano="30" /></span>
              <span class="forma-texto"><b>Mostrar mi código</b><span>Díctaselo a la tienda y ella te cobra</span></span>
            </button>
          </div>
        </section>
        <button v-if="tieneVale && !sinValeAun && enLaRed" class="enlace" @click="escucharSaldo">
          <Icono nombre="altavoz" /> Escuchar mi saldo
        </button>
      </div>

      <div v-if="tieneVale && !enLaRed?.congelado" class="columna">
        <section class="tarjeta">
          <h2><Icono nombre="tienda" /> Dónde usar tu vale</h2>
          <p v-if="programa" class="apagado pequeno">Sirve para {{ rubrosDelPrograma }}, en estas tiendas:</p>
          <p v-if="!afiliados.length" class="apagado">Todavía no hay tiendas afiliadas.</p>
          <ul class="lista-tiendas">
            <li v-for="c in afiliados" :key="c.id">
              <span class="av av-tienda" aria-hidden="true">{{ iniciales(c.nombre) }}</span>
              <span class="lista-tiendas-texto">
                <b>{{ c.nombre }}</b>
                <span class="apagado pequeno">{{ RUBROS[c.rubro] ?? '' }}<template v-if="c.distrito"> · {{ c.distrito }}</template></span>
              </span>
            </li>
          </ul>
        </section>

        <section v-if="movimientos.length" class="tarjeta">
          <h2><Icono nombre="historial" /> Tus movimientos</h2>
          <ul class="movimientos">
            <li v-for="m in movimientos" :key="m.id">
              <span :class="['mov-icono', m.entra ? 'entra' : 'sale']" aria-hidden="true">
                <Icono :nombre="m.entra ? 'abajo' : 'arriba'" :tamano="18" />
              </span>
              <span class="mov-texto">
                <b>{{ describir(m) }}</b>
                <span class="apagado pequeno">{{ cuando(m.fecha) }}</span>
              </span>
              <span class="mov-lado">
                <b :class="['mov-monto', { entra: m.entra }]">{{ m.entra ? '+' : '−' }} {{ soles(m.monto) }}</b>
                <a class="pequeno" :href="explorador(m.hash)" target="_blank" rel="noopener">comprobante</a>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <!-- ============ ESCANEAR EL QR DE LA TIENDA ============ -->
    <section v-else-if="pantalla === 'escanear'" class="tarjeta">
      <button class="enlace atras" @click="reiniciar"><Icono nombre="atras" /> Atrás</button>
      <p class="pregunta">Escanea el QR de la tienda</p>
      <Escaner v-if="hayCamara" etiqueta="Cámara para escanear el QR de la tienda" @leido="alLeerQr" @sin-camara="hayCamara = false" />
      <div v-else class="aviso espera">
        <strong>No podemos usar la cámara</strong>
        Tu celular no dio permiso. Puedes pagar dictándole tu código a la tienda.
      </div>
      <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
      <button :class="hayCamara ? 'secundario' : 'principal'" @click="abrirCodigo">
        <Icono nombre="codigo" /> Mejor, mostrar mi código
      </button>
    </section>

    <!-- ============ CONFIRMAR EL COBRO DEL QR ============ -->
    <section v-else-if="pantalla === 'confirmar'" class="tarjeta confirmacion">
      <p class="pregunta">¿Pagar?</p>
      <p class="monto-grande">{{ soles(cobro.monto) }}</p>
      <p class="destino">a {{ cobro.comercio.nombre }}</p>
      <p class="apagado">
        {{ RUBROS[cobro.rubro] ?? '' }}<template v-if="cobro.comercio.distrito"> · {{ cobro.comercio.distrito }}</template>
      </p>

      <div v-if="cobro.yaPagado" class="aviso no" role="alert">
        <strong>Este cobro ya fue pagado</strong>
        Pide a la tienda que genere otro.
      </div>
      <div v-else-if="!cobro.cubierto" class="aviso no" role="alert">
        <strong>Tu vale no sirve en esta tienda</strong>
        Es de {{ (RUBROS[cobro.rubro] ?? '').toLowerCase() }}, y tu vale solo se puede usar en {{ rubrosDelPrograma }}.
      </div>
      <div v-else-if="!alcanza" class="aviso no" role="alert">
        <strong>No te alcanza</strong>
        Tienes {{ soles(enLaRed?.saldo ?? 0) }} en tu vale.
      </div>

      <form v-else @submit.prevent="confirmar">
        <template v-if="necesitaPin">
          <p class="apagado">Es más de S/ {{ UMBRAL_PIN }}: para cuidarte, escribe tu PIN.</p>
          <Pin v-model="pin" id="pin-pagar" />
        </template>
        <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
        <button class="principal si" :disabled="necesitaPin && pin.length !== 4">
          <Icono nombre="check" :tamano="28" /> Sí, pagar
        </button>
      </form>
      <button class="secundario" @click="reiniciar">
        <Icono nombre="x" /> {{ cobro.cubierto && !cobro.yaPagado && alcanza ? 'No, cancelar' : 'Volver' }}
      </button>
    </section>

    <!-- ============ MI CODIGO DE PAGO ============ -->
    <section v-else-if="pantalla === 'codigo'" class="tarjeta confirmacion">
      <button class="enlace atras" @click="reiniciar"><Icono nombre="atras" /> Atrás</button>

      <form v-if="!codigo" @submit.prevent="generarCodigo">
        <p class="pregunta">Tu código de pago</p>
        <p class="apagado">Para verlo, marca tu PIN. Así nadie más puede pagar con tu vale.</p>
        <Pin v-model="pin" id="pin-codigo" />
        <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
        <button class="principal" :disabled="pin.length !== 4 || generando">
          {{ generando ? 'Generando…' : 'Ver mi código' }}
        </button>
      </form>

      <template v-else-if="!codigoVencido">
        <p class="pregunta">Díctale este código a la tienda</p>
        <p class="codigo-pago" aria-live="polite">{{ agrupar(codigo.codigo) }}</p>
        <p class="apagado">La tienda escribe el monto y este código, y listo. Sirve para un solo pago.</p>
        <p class="esperando" aria-live="polite">
          <span class="punto" aria-hidden="true" /> Esperando el cobro · vence en {{ minutos }}
        </p>
        <div v-if="intento" class="aviso no" role="alert">
          <strong>{{ intento.comercio?.nombre ?? 'Una tienda' }} intentó cobrarte {{ soles(intento.monto) }} y no se pudo</strong>
          {{ intento.mensaje }}
          <span class="pequeno">{{ intento.controlDe === 'red' ? 'Lo rechazó la red de pagos.' : 'Es una regla de tu programa.' }} No se te cobró nada; tu código sigue sirviendo.</span>
        </div>
        <button class="secundario" @click="hablar(`Tu código es ${codigo.codigo.split('').join(' ')}.`)">
          <Icono nombre="altavoz" /> Escuchar el código
        </button>
      </template>

      <template v-else>
        <p class="pregunta">Tu código venció</p>
        <p class="apagado">Pasaron los minutos sin que la tienda lo usara. No se te cobró nada.</p>
        <button class="principal" @click="abrirCodigo">Generar otro código</button>
      </template>
    </section>

    <!-- ============ PAGANDO ============ -->
    <section v-else-if="pantalla === 'pagando'" class="tarjeta resultado" aria-live="polite">
      <div class="girando" aria-hidden="true" />
      <p class="titulo-resultado">Pagando…</p>
      <p class="apagado">Tarda unos segundos. No cierres esta pantalla.</p>
    </section>

    <!-- ============ HECHO ============ -->
    <section v-else-if="pantalla === 'hecho'" class="tarjeta resultado ok" role="status">
      <div class="sello ok"><Icono nombre="check" :tamano="56" /></div>
      <p class="titulo-resultado">¡Pago hecho!</p>
      <p class="monto-grande">{{ soles(pago.monto) }}</p>
      <p class="destino">a {{ pago.tienda }}</p>
      <p v-if="enLaRed">Te quedan <b>{{ soles(enLaRed.saldo) }}</b></p>
      <button class="principal" @click="reiniciar">Listo</button>
      <button class="enlace" @click="escucharResultado"><Icono nombre="altavoz" /> Escuchar</button>
      <details v-if="pago.transaccion">
        <summary>Ver comprobante</summary>
        <Prueba :tx="pago.transaccion" />
      </details>
    </section>

    <!-- ============ NO SE PUDO ============ -->
    <section v-else-if="pantalla === 'rechazado'" class="tarjeta resultado no" role="alert">
      <div class="sello no"><Icono nombre="x" :tamano="56" /></div>
      <p class="titulo-resultado">No se pudo pagar</p>
      <p class="motivo">{{ pago.mensaje }}</p>
      <p><b>No se te cobró nada.</b> Tu saldo sigue igual.</p>
      <p v-if="pago.controlDe === 'red'" class="apagado pequeno">
        Lo rechazó la red de pagos, no esta aplicación.
      </p>
      <p v-else-if="pago.controlDe === 'aplicacion'" class="apagado pequeno">
        Es una regla de tu programa: no se envió ningún pago.
      </p>
      <button class="principal" @click="reiniciar">Entendido</button>
      <button class="enlace" @click="escucharResultado"><Icono nombre="altavoz" /> Escuchar</button>
      <details v-if="pago.transaccion">
        <summary>Detalles</summary>
        <Prueba :tx="pago.transaccion" />
      </details>
    </section>
  </template>
</template>
