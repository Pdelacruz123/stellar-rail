<script setup>
/**
 * La pantalla del trabajador.
 *
 * Pagar funciona como un vale de alimentos real: en la tienda, el cajero
 * escribe el monto y muestra un QR de cobro con un codigo de 6 numeros
 * debajo. El trabajador toca "Pagar", escanea el QR o escribe el codigo, ve
 * a quien le paga y cuanto, y confirma (con su PIN si pasa de S/ 50). No
 * escribe montos ni elige tiendas.
 *
 * Pensada para alguien que no se maneja bien con el celular: una sola cosa
 * por pantalla, botones grandes con icono y palabra, el resultado a pantalla
 * completa, nada tecnico a la vista y todo se puede escuchar.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { api, saldoEnLaRed } from '../api.js';
import {
  estado, enPalabras, fecha, hablar, programaVigente, recargar, soles,
} from '../estado.js';
import { leerQr } from '../enlaces.js';
import { RUBROS } from '../../lib/rubros.js';
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

// --- Saldo, leido de la red cada vez. Nunca lo guardamos. -------------------

const enLaRed = ref(null);
const errorSaldo = ref('');
async function cargarSaldo() {
  if (!yo.value || !estado.yo) { enLaRed.value = null; return; }
  const { horizon, activo, emisor } = estado.yo;
  try {
    enLaRed.value = await saldoEnLaRed(horizon, yo.value.cuenta_publica, activo, emisor);
    errorSaldo.value = '';
  } catch (e) {
    errorSaldo.value = e.message;
  }
}
const recibioElVale = computed(() => (programa.value?.recibieron ?? []).includes(yo.value?.id));
watch([() => yo.value?.id, () => yo.value?.estado, recibioElVale], cargarSaldo, { immediate: true });

// Aprobado, pero la empresa todavia no le entrego el vale de este programa.
const sinValeAun = computed(() => yo.value?.estado === 'verificado' && enLaRed.value
  && !enLaRed.value.congelado && Number(enLaRed.value.saldo) === 0 && !recibioElVale.value);
// Solo se ofrece pagar si hay con que.
const puedePagar = computed(() => yo.value?.estado === 'verificado' && !enLaRed.value?.congelado
  && Number(enLaRed.value?.saldo ?? 0) > 0);

function escucharSaldo() {
  if (!enLaRed.value) return;
  hablar(enLaRed.value.congelado
    ? 'Tu vale venció y ya no se puede usar.'
    : `Tienes ${enPalabras(enLaRed.value.saldo)} en tu vale.`);
}

// --- Pagar ------------------------------------------------------------------
// inicio -> pagar (escanear o escribir el codigo) -> confirmar -> pagando -> hecho | rechazado

const pantalla = ref('inicio');
const cobro = ref(null);       // { cobro, monto, rubro, comercio, cubierto, yaPagado, requierePin }
const codigo = ref('');
const pin = ref('');
const aviso = ref('');
const resultado = ref(null);
const buscando = ref(false);
const hayCamara = ref(true);
const campoCodigo = ref(null);
// Si la persona vuelve al inicio mientras se busca un cobro, la respuesta
// que llega tarde se descarta: no reabre una pantalla que ella ya cerro.
let vuelta = 0;

async function abrirPagar() {
  aviso.value = '';
  codigo.value = '';
  hayCamara.value = true;
  pantalla.value = 'pagar';
  await nextTick();
  campoCodigo.value?.focus();
}

function reiniciar() {
  vuelta += 1;
  pantalla.value = 'inicio';
  cobro.value = null;
  codigo.value = '';
  pin.value = '';
  aviso.value = '';
  resultado.value = null;
  // Se limpia el enlace del QR: si se recarga la pagina, no vuelve a abrirlo.
  if (props.cobro) window.location.hash = '#/';
}

/** Busca el cobro (por su QR o su codigo de 6 numeros) y lo muestra para confirmar. */
async function verCobro(datos) {
  const mia = ++vuelta;
  aviso.value = '';
  buscando.value = true;
  try {
    const c = await api.verCobro(datos);
    if (mia !== vuelta) return;
    cobro.value = c;
    pin.value = '';
    pantalla.value = 'confirmar';
  } catch (e) {
    if (mia !== vuelta) return;
    aviso.value = e.message;
    if (pantalla.value !== 'pagar') pantalla.value = 'pagar';
  } finally {
    buscando.value = false;
  }
}

function alLeerQr(texto) {
  const leido = leerQr(texto);
  if (leido?.tipo !== 'cobro') {
    aviso.value = 'Ese código no es un cobro de StellarRail. Escanea el QR que te muestra la tienda.';
    return;
  }
  verCobro({ cobro: leido.token });
}

function buscarPorCodigo() {
  const c = codigo.value.replace(/\D/g, '');
  if (c.length !== 6) {
    aviso.value = 'Escribe los 6 números que te muestra la tienda.';
    return;
  }
  verCobro({ codigo: c });
}

// Un cobro abierto con la camara del celular. Espera a saber quien es y
// cuanto tiene; se atiende una sola vez, y si no se puede pagar se dice por que.
let enlaceAtendido = '';
watch(
  [() => props.cobro, () => yo.value?.id, () => enLaRed.value !== null],
  ([enlace, id, saldoListo]) => {
    if (!enlace || enlace === enlaceAtendido || !id || !saldoListo) return;
    enlaceAtendido = enlace;
    if (yo.value.estado !== 'verificado') aviso.value = 'Todavía no puedes pagar: tu empresa aún no te aprueba.';
    else if (enLaRed.value.congelado) aviso.value = 'No se puede pagar: tu vale venció.';
    else if (!puedePagar.value) aviso.value = 'No tienes saldo en tu vale para pagar.';
    else verCobro({ cobro: enlace });
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
    resultado.value = r;
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
    resultado.value = { pagado: false, controlDe: 'error', mensaje: e.message };
    pantalla.value = 'rechazado';
  }
  await recargar();
}

const motivo = computed(() => {
  const r = resultado.value;
  if (!r) return '';
  if (r.controlDe === 'red') return r.transaccion?.mensaje ?? 'La tienda no pudo recibir el pago.';
  return r.mensaje;
});

function escucharResultado() {
  if (resultado.value?.pagado) {
    hablar(`Pagaste ${enPalabras(cobro.value.monto)} a ${cobro.value.comercio.nombre}. `
      + `Te quedan ${enPalabras(enLaRed.value?.saldo ?? 0)}.`);
  } else {
    hablar(`No se pudo pagar. ${motivo.value} No se te cobró nada.`);
  }
}
</script>

<template>
  <section v-if="!yo" class="tarjeta">
    <p class="cargando">Cargando tu vale…</p>
  </section>

  <template v-if="yo">
    <!-- ============ INICIO ============ -->
    <div v-if="pantalla === 'inicio'" class="columnas">
      <section class="tarjeta">
        <p class="saludo">Hola, {{ primerNombre }}</p>

        <div v-if="yo.estado === 'pendiente'" class="aviso espera">
          <strong>Tu registro está en revisión</strong>
          Te avisaremos aquí cuando tu empresa te apruebe.
        </div>
        <div v-else-if="yo.estado === 'rechazado'" class="aviso no">
          <strong>Tu registro no fue aprobado</strong>
          Consulta con Recursos Humanos.
        </div>
        <div v-else-if="yo.estado === 'baja'" class="aviso no">
          <strong>Ya no recibes vales de esta empresa</strong>
          Tu empresa te dio de baja. Si crees que es un error, consulta con Recursos Humanos.
        </div>
        <div v-else-if="sinValeAun" class="aviso ok">
          <strong>Tu registro fue aprobado</strong>
          Cuando tu empresa te entregue el vale, lo verás aquí.
        </div>

        <template v-if="yo.estado !== 'verificado' || sinValeAun" />
        <div v-else-if="enLaRed" :class="['vale', { congelado: enLaRed.congelado }]">
          <span>{{ enLaRed.congelado ? 'Tu vale venció' : (programa?.nombre ?? 'Tu vale') }}</span>
          <b>{{ soles(enLaRed.saldo) }}</b>
          <span v-if="!enLaRed.congelado && Number(enLaRed.saldo) === 0">Ya usaste todo tu vale</span>
          <span v-else-if="!enLaRed.congelado && programa">Úsalo hasta el {{ fecha(programa.vence_el) }}</span>
          <span v-else-if="enLaRed.congelado">Ya no se puede usar</span>
          <img class="vale-logo" src="/logo.svg" alt="">
        </div>
        <div v-else-if="errorSaldo" class="aviso espera" role="alert">
          <strong>No pudimos ver tu saldo</strong>
          Tu dinero está bien: es solo la conexión.
          <button class="secundario" @click="cargarSaldo">Intentar otra vez</button>
        </div>
        <p v-else class="cargando">Viendo tu saldo…</p>

        <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>

        <template v-if="puedePagar">
          <button class="principal" @click="abrirPagar">
            <Icono nombre="qr" :tamano="28" /> Pagar
          </button>
          <p class="apagado pequeno ayuda-pagar">
            En la tienda te muestran un QR con el monto. Tócalo aquí para pagar.
          </p>
        </template>
        <button v-if="yo.estado === 'verificado' && !sinValeAun && enLaRed" class="enlace" @click="escucharSaldo">
          <Icono nombre="altavoz" /> Escuchar mi saldo
        </button>
      </section>

      <section v-if="yo.estado === 'verificado' && !enLaRed?.congelado" class="tarjeta">
        <h2><Icono nombre="tienda" /> Dónde usar tu vale</h2>
        <p v-if="programa" class="apagado">Sirve para: {{ rubrosDelPrograma }}.</p>
        <p v-if="!afiliados.length" class="apagado">Todavía no hay tiendas afiliadas.</p>
        <div v-for="c in afiliados" :key="c.id" class="fila">
          <div>
            <div class="nombre">{{ c.nombre }}</div>
            <div class="apagado pequeno">
              {{ RUBROS[c.rubro] ?? '' }}<template v-if="c.distrito"> · {{ c.distrito }}</template>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- ============ PAGAR: escanear o escribir el codigo ============ -->
    <section v-else-if="pantalla === 'pagar'" class="tarjeta">
      <button class="enlace atras" @click="reiniciar"><Icono nombre="atras" /> Atrás</button>
      <p class="pregunta">{{ hayCamara ? 'Escanea el QR de la tienda' : 'Escribe el código del cobro' }}</p>
      <Escaner v-if="hayCamara" etiqueta="Cámara para escanear el QR de la tienda" @leido="alLeerQr" @sin-camara="hayCamara = false" />
      <form @submit.prevent="buscarPorCodigo">
        <label for="codigo-cobro">{{ hayCamara ? 'O escribe los 6 números que están debajo del QR' : 'Son los 6 números que te muestra la tienda, debajo del QR' }}</label>
        <input
          id="codigo-cobro" ref="campoCodigo" v-model="codigo" class="numero-grande"
          inputmode="numeric" maxlength="7" autocomplete="off" placeholder="000 000">
        <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
        <button class="principal" :disabled="buscando">{{ buscando ? 'Buscando…' : 'Continuar' }}</button>
      </form>
    </section>

    <!-- ============ CONFIRMAR ============ -->
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
      <p class="monto-grande">{{ soles(cobro.monto) }}</p>
      <p class="destino">a {{ cobro.comercio.nombre }}</p>
      <p v-if="enLaRed">Te quedan <b>{{ soles(enLaRed.saldo) }}</b></p>
      <button class="principal" @click="reiniciar">Listo</button>
      <button class="enlace" @click="escucharResultado"><Icono nombre="altavoz" /> Escuchar</button>
      <details>
        <summary>Ver comprobante</summary>
        <Prueba :tx="resultado.transaccion" />
      </details>
    </section>

    <!-- ============ NO SE PUDO ============ -->
    <section v-else-if="pantalla === 'rechazado'" class="tarjeta resultado no" role="alert">
      <div class="sello no"><Icono nombre="x" :tamano="56" /></div>
      <p class="titulo-resultado">No se pudo pagar</p>
      <p class="motivo">{{ motivo }}</p>
      <p><b>No se te cobró nada.</b> Tu saldo sigue igual.</p>
      <p v-if="resultado.controlDe === 'red'" class="apagado pequeno">
        Lo rechazó la red de pagos, no esta aplicación.
      </p>
      <p v-else-if="resultado.controlDe === 'aplicacion'" class="apagado pequeno">
        Es una regla de tu programa: no se envió ningún pago.
      </p>
      <button class="principal" @click="reiniciar">Entendido</button>
      <button class="enlace" @click="escucharResultado"><Icono nombre="altavoz" /> Escuchar</button>
      <details v-if="resultado.transaccion">
        <summary>Detalles</summary>
        <Prueba :tx="resultado.transaccion" />
      </details>
    </section>
  </template>
</template>
