<script setup>
/**
 * La pantalla del trabajador.
 *
 * Pensada para alguien que no se maneja bien con el celular:
 *  - una sola cosa por pantalla;
 *  - nada que escribir si se puede evitar: con el QR con monto, solo se
 *    confirma;
 *  - botones grandes, con icono y palabra;
 *  - el resultado a pantalla completa, con una frase y lo que paso con su
 *    dinero;
 *  - nada tecnico a la vista: los codigos de la red van en "Detalles";
 *  - todo se puede escuchar en voz alta.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { api, saldoEnLaRed } from '../api.js';
import {
  estado, enPalabras, fecha, hablar, montoValido, programaVigente, recargar, soles,
} from '../estado.js';
import { verCobro } from '../enlaces.js';
import { avisarCambio, cercano } from '../marco.js';
import { RUBROS } from '../../lib/rubros.js';
import { UMBRAL_PIN } from '../../lib/reglas.js';
import Escaner from '../Escaner.vue';
import Icono from '../Icono.vue';
import Pin from '../Pin.vue';
import Prueba from '../Prueba.vue';

const props = defineProps({
  codigo: { type: String, default: '' },
  cobro: { type: String, default: '' },
});

// El trabajador de este celular. La API solo le devuelve a el.
const yo = computed(() => estado.beneficiarios[0] ?? null);

const primerNombre = computed(() => (yo.value?.nombre ?? '').split(' ')[0]);
const programa = computed(() => programaVigente());
const rubrosDelPrograma = computed(() => (programa.value?.rubros ?? [])
  .map((r) => RUBROS[r] ?? r).join(', ').toLowerCase());
const afiliados = computed(() => estado.comercios.filter((c) => c.afiliado));
const puedePagar = computed(() => yo.value?.estado === 'verificado' && !enLaRed.value?.congelado);

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
// Por valores simples, no por el objeto: cada recarga crea objetos nuevos.
// Se vuelve a leer al ser aprobado, al recibir el vale o si otra pantalla
// de la demostracion cambio algo.
watch(
  [() => yo.value?.id, () => yo.value?.estado, () => programa.value?.entregados, () => cercano.cambios],
  cargarSaldo,
  { immediate: true },
);

function escucharSaldo() {
  if (!enLaRed.value) return;
  hablar(enLaRed.value.congelado
    ? 'Tu vale venció y ya no se puede usar.'
    : `Tienes ${enPalabras(enLaRed.value.saldo)} en tu vale.`);
}

// --- Pagar: una pantalla por paso -------------------------------------------
// inicio -> escanear | codigo -> monto -> confirmar -> pagando -> hecho | rechazado

const pantalla = ref('inicio');
const destino = ref(null);
const pago = ref({ monto: '', cobro: null, rubro: null });
const pin = ref('');
const codigoEscrito = ref('');
const aviso = ref('');
const resultado = ref(null);
const campo = ref(null);
// Cada paso que espera a la red lleva un numero de vuelta. Si mientras tanto
// la persona volvio al inicio, la respuesta que llega tarde se descarta: no
// puede reabrir una pantalla que ella ya cerro.
let vuelta = 0;

async function enfocar() {
  await nextTick();
  campo.value?.focus();
}

function reiniciar() {
  vuelta += 1;
  pantalla.value = 'inicio';
  destino.value = null;
  pago.value = { monto: '', cobro: null, rubro: null };
  pin.value = '';
  codigoEscrito.value = '';
  aviso.value = '';
  resultado.value = null;
  // Se limpia el enlace del QR: si se recarga la pagina, no vuelve a cobrar.
  if (props.codigo || props.cobro) window.location.hash = '#/';
}

/** QR fijo o codigo escrito: se sabe la tienda, falta el monto. */
async function irATienda(codigo) {
  const mia = ++vuelta;
  aviso.value = '';
  await recargar(); // por si la tienda se registro hace un momento
  if (mia !== vuelta) return;
  const c = estado.comercios.find((x) => x.codigo_corto === String(codigo).replace(/\s/g, ''));
  if (!c) {
    aviso.value = 'No encontramos esa tienda. Revisa los 6 números.';
    pantalla.value = 'codigo';
    return;
  }
  destino.value = c;
  pago.value = { monto: '', cobro: null, rubro: c.rubro };
  pantalla.value = 'monto';
  enfocar();
}

/** QR con monto: la tienda ya puso todo; solo hay que confirmar. */
async function irACobro(token) {
  const mia = ++vuelta;
  aviso.value = '';
  const c = verCobro(token);
  if (!c) {
    aviso.value = 'Este código de cobro no se puede leer. Pide a la tienda que genere otro.';
    pantalla.value = 'inicio';
    return;
  }
  // El vencimiento NO se comprueba aqui: el reloj del celular puede ir mal.
  // Lo decide el servidor al pagar, y si vencio, lo dice con claridad.
  await recargar();
  if (mia !== vuelta) return;
  const tienda = estado.comercios.find((x) => x.id === c.comercioId);
  if (!tienda) {
    aviso.value = 'Este cobro es de una tienda de otra empresa.';
    pantalla.value = 'inicio';
    return;
  }
  destino.value = tienda;
  pago.value = { monto: c.monto, cobro: token, rubro: c.rubro };
  pantalla.value = 'confirmar';
}

function alLeer(leido) {
  if (leido.tipo === 'cobro') irACobro(leido.token);
  else irATienda(leido.codigo);
}

// Llego desde un QR abierto con la camara del celular.
// Fuentes separadas y de valor simple: asi solo reacciona cuando cambia el
// enlace o la persona. Con un unico arreglo reaccionaria a cada recarga de
// datos, y volveria a abrir un cobro ya usado encima de lo que se esta viendo.
watch([() => props.codigo, () => props.cobro, () => yo.value?.id], ([codigo, cobro, id]) => {
  if (!id || !puedePagar.value) return;
  if (cobro) irACobro(cobro);
  else if (codigo) irATienda(codigo);
}, { immediate: true });

function continuarMonto() {
  const monto = montoValido(pago.value.monto);
  if (!monto) {
    aviso.value = 'Escribe cuánto vas a pagar. Por ejemplo: 18,50';
    return;
  }
  aviso.value = '';
  pago.value.monto = monto;
  pantalla.value = 'confirmar';
}

// Montos grandes piden el PIN: si alguien toma el celular desbloqueado, no
// puede vaciar el vale de golpe. Los pequenos, como en Yape, solo confirmar.
const necesitaPin = computed(() => Number(pago.value.monto) > UMBRAL_PIN);

const rubroCubierto = computed(() => !programa.value
  || (programa.value.rubros ?? []).includes(pago.value.rubro ?? destino.value?.rubro));

async function confirmar() {
  aviso.value = '';
  pantalla.value = 'pagando';
  try {
    const r = await api.pagar({
      ...(pago.value.cobro
        ? { cobro: pago.value.cobro }
        : { codigo: destino.value.codigo_corto, monto: pago.value.monto }),
      ...(necesitaPin.value ? { pin: pin.value } : {}),
    });
    resultado.value = r;
    await cargarSaldo();
    pantalla.value = r.pagado ? 'hecho' : 'rechazado';
    avisarCambio();
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
    hablar(`Pagaste ${enPalabras(pago.value.monto)} a ${destino.value.nombre}. `
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
    <template v-if="pantalla === 'inicio'">
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
        <div v-else-if="enLaRed?.autorizado && Number(enLaRed.saldo) === 0 && !programa?.entregados" class="aviso espera">
          <strong>Ya estás aprobado</strong>
          Pronto tu empresa te entregará el vale.
        </div>

        <!-- El vale solo se muestra a quien esta aprobado: pendiente, rechazado o
             de baja, ya lo dice el aviso de arriba. -->
        <template v-if="yo.estado !== 'verificado'" />
        <div v-else-if="enLaRed" :class="['vale', { congelado: enLaRed.congelado }]">
          <span>{{ enLaRed.congelado ? 'Tu vale venció' : (programa?.nombre ?? 'Tu vale') }}</span>
          <b>{{ soles(enLaRed.saldo) }}</b>
          <span v-if="!enLaRed.congelado && programa">Úsalo hasta el {{ fecha(programa.vence_el) }}</span>
          <span v-else-if="enLaRed.congelado">Ya no se puede usar</span>
        </div>
        <div v-else-if="errorSaldo" class="aviso espera" role="alert">
          <strong>No pudimos ver tu saldo</strong>
          Tu dinero está bien: es solo la conexión.
          <button class="secundario" @click="cargarSaldo">Intentar otra vez</button>
        </div>
        <p v-else class="cargando">Viendo tu saldo…</p>

        <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>

        <template v-if="puedePagar">
          <button class="principal" @click="pantalla = 'escanear'">
            <Icono nombre="camara" :tamano="30" /> Pagar con QR
          </button>
          <button class="secundario" @click="pantalla = 'codigo'; enfocar()">
            <Icono nombre="teclado" /> Pagar con código
          </button>
        </template>
        <button v-if="yo.estado === 'verificado'" class="enlace" @click="escucharSaldo">
          <Icono nombre="altavoz" /> Escuchar mi saldo
        </button>
      </section>

      <section v-if="yo.estado === 'verificado'" class="tarjeta">
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
    </template>

    <!-- ============ ESCANEAR ============ -->
    <section v-else-if="pantalla === 'escanear'" class="tarjeta">
      <Escaner
        busca="pago"
        @leido="alLeer"
        @escribir="pantalla = 'codigo'; enfocar()"
        @cancelar="reiniciar" />
    </section>

    <!-- ============ ESCRIBIR EL CODIGO ============ -->
    <section v-else-if="pantalla === 'codigo'" class="tarjeta">
      <button class="enlace atras" @click="reiniciar"><Icono nombre="atras" /> Atrás</button>
      <form @submit.prevent="irATienda(codigoEscrito)">
        <label for="cod" class="pregunta">Escribe el código de la tienda</label>
        <p class="apagado">Son 6 números. Están debajo de su QR, o te los dicen en caja.</p>
        <input
          id="cod" ref="campo" v-model="codigoEscrito" class="numero-grande"
          inputmode="numeric" maxlength="7" autocomplete="off" placeholder="000 000" required>
        <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
        <button class="principal">Continuar</button>
      </form>
    </section>

    <!-- ============ CUANTO ============ -->
    <section v-else-if="pantalla === 'monto'" class="tarjeta">
      <button class="enlace atras" @click="reiniciar"><Icono nombre="atras" /> Atrás</button>
      <p class="destino"><Icono nombre="tienda" /> {{ destino.nombre }}</p>
      <form @submit.prevent="continuarMonto">
        <label for="mon" class="pregunta">¿Cuánto vas a pagar?</label>
        <div class="campo-monto">
          <span aria-hidden="true">S/</span>
          <input
            id="mon" ref="campo" v-model="pago.monto" class="numero-grande"
            inputmode="decimal" autocomplete="off" placeholder="0,00" required>
        </div>
        <p v-if="enLaRed" class="apagado">Tienes {{ soles(enLaRed.saldo) }}</p>
        <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
        <button class="principal">Continuar</button>
      </form>
    </section>

    <!-- ============ CONFIRMAR ============ -->
    <section v-else-if="pantalla === 'confirmar'" class="tarjeta confirmacion">
      <p class="pregunta">¿Pagar?</p>
      <p class="monto-grande">{{ soles(pago.monto) }}</p>
      <p class="destino">a {{ destino.nombre }}</p>
      <p class="apagado">
        {{ RUBROS[pago.rubro] ?? '' }}<template v-if="destino.distrito"> · {{ destino.distrito }}</template>
      </p>

      <div v-if="!rubroCubierto" class="aviso no" role="alert">
        <strong>Tu vale no sirve para {{ (RUBROS[pago.rubro] ?? '').toLowerCase() }}</strong>
        Solo se puede usar en {{ rubrosDelPrograma }}.
      </div>

      <form v-if="rubroCubierto" @submit.prevent="confirmar">
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
        <Icono nombre="x" /> {{ rubroCubierto ? 'No, cancelar' : 'Volver' }}
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
      <p class="monto-grande">{{ soles(pago.monto) }}</p>
      <p class="destino">a {{ destino.nombre }}</p>
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
