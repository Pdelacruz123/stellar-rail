<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { api, saldoEnLaRed } from '../api.js';
import {
  estado, accion, fecha, montoValido, programaVigente, recargar, refrescarYo, soles,
} from '../estado.js';
import { RUBROS } from '../../lib/rubros.js';
import Prueba from '../Prueba.vue';

const props = defineProps({ codigo: { type: String, default: '' } });

const esEmpresa = computed(() => estado.yo?.rol === 'empresa');
const elegido = ref(null);
const nombre = ref('');
const trabajando = ref('');

// Quien paga: el trabajador de este celular, o el que elige la empresa.
const yo = computed(() => {
  if (!esEmpresa.value) return estado.beneficiarios[0] ?? null;
  return estado.beneficiarios.find((b) => b.id === elegido.value) ?? null;
});
watch(() => estado.beneficiarios, (lista) => {
  if (esEmpresa.value && elegido.value === null && lista.length) elegido.value = lista[0].id;
}, { immediate: true, deep: true });

const programa = computed(() => programaVigente());
const rubrosDelPrograma = computed(() => (programa.value?.rubros ?? [])
  .map((r) => RUBROS[r] ?? r).join(', '));

const afiliados = computed(() => estado.comercios.filter((c) => (
  esEmpresa.value ? c.estado === 'verificado' : c.afiliado)));

// El saldo se lee de Horizon cada vez. Nunca lo guardamos.
const enLaRed = ref(null);
async function cargarSaldo() {
  if (!yo.value || !estado.yo) { enLaRed.value = null; return; }
  const { horizon, activo, emisor } = estado.yo;
  enLaRed.value = await saldoEnLaRed(horizon, yo.value.cuenta_publica, activo, emisor);
}
watch(yo, cargarSaldo, { immediate: true });

async function registrar() {
  trabajando.value = 'registro';
  try {
    const r = await accion(() => api.registrarBeneficiario(nombre.value.trim()));
    if (esEmpresa.value) elegido.value = r.beneficiario.id;
    else await refrescarYo();
    nombre.value = '';
  } finally {
    trabajando.value = '';
  }
}

// --- Pagar en tres pasos: datos, confirmacion, resultado --------------------

const paso = ref('datos');
const pago = ref({ codigo: '', monto: '' });
const destino = ref(null);
const resultado = ref(null);
const campoMonto = ref(null);

// Si llego escaneando el QR de una caja, el comercio ya viene puesto:
// solo falta escribir el monto.
watch(() => props.codigo, async (c) => {
  if (!c) return;
  pago.value.codigo = c;
  paso.value = 'datos';
  resultado.value = null;
  await nextTick();
  campoMonto.value?.focus();
}, { immediate: true });

const rubroCubierto = computed(() => !programa.value || !destino.value
  || (programa.value.rubros ?? []).includes(destino.value.rubro));

async function continuar() {
  const monto = montoValido(pago.value.monto);
  if (!monto) {
    estado.error = 'Escribe un monto válido, por ejemplo 18,50.';
    return;
  }
  estado.error = null;
  await recargar(); // por si el comercio se registro hace un momento
  const c = estado.comercios.find((x) => x.codigo_corto === pago.value.codigo.trim());
  if (!c) {
    estado.error = 'No encontramos ese comercio. Revisa el código de 6 dígitos.';
    return;
  }
  destino.value = c;
  pago.value.monto = monto;
  paso.value = 'confirmar';
}

async function confirmar() {
  trabajando.value = 'pago';
  try {
    resultado.value = await accion(() => api.pagar({
      codigo: destino.value.codigo_corto,
      monto: pago.value.monto,
      ...(esEmpresa.value ? { beneficiarioId: yo.value.id } : {}),
    }));
    paso.value = 'resultado';
    await cargarSaldo();
  } catch {
    // El mensaje queda en estado.error y lo muestra App.vue.
  } finally {
    trabajando.value = '';
  }
}

function otroPago() {
  paso.value = 'datos';
  pago.value = { codigo: '', monto: '' };
  destino.value = null;
  resultado.value = null;
  if (props.codigo) window.location.hash = esEmpresa.value ? '#/beneficiario' : '#/';
}

const usarComercio = (c) => {
  pago.value.codigo = c.codigo_corto;
  paso.value = 'datos';
  resultado.value = null;
};
</script>

<template>
  <!-- Registro: un solo campo. -->
  <section v-if="!yo && !esEmpresa" class="tarjeta">
    <h2>Recibe tu vale de alimentación</h2>
    <p class="apagado pequeno">
      Tu empresa te invitó. Escribe tu nombre y te avisaremos aquí cuando te
      aprueben. No necesitas instalar nada ni tener saldo.
    </p>
    <form @submit.prevent="registrar">
      <div class="campo">
        <label for="nom">Tu nombre</label>
        <input id="nom" v-model="nombre" autocomplete="name" required placeholder="María Quispe">
      </div>
      <button :disabled="trabajando === 'registro' || !nombre.trim()">
        {{ trabajando === 'registro' ? 'Registrando…' : 'Registrarme' }}
      </button>
    </form>
  </section>

  <!-- La empresa, en la demostracion con un solo dispositivo. -->
  <section v-if="esEmpresa" class="tarjeta">
    <div v-if="estado.beneficiarios.length" class="campo">
      <label for="quien">Ver como</label>
      <select id="quien" v-model="elegido">
        <option v-for="b in estado.beneficiarios" :key="b.id" :value="b.id">{{ b.nombre }}</option>
      </select>
    </div>
    <form class="pareja" style="align-items:end" @submit.prevent="registrar">
      <div class="campo" style="margin:0">
        <label for="nomE">Registrar un trabajador</label>
        <input id="nomE" v-model="nombre" placeholder="María Quispe">
      </div>
      <button :disabled="trabajando === 'registro' || !nombre.trim()">
        {{ trabajando === 'registro' ? 'Registrando…' : 'Registrar' }}
      </button>
    </form>
  </section>

  <template v-if="yo">
    <section class="tarjeta">
      <h2>Hola, {{ yo.nombre }}</h2>

      <div v-if="yo.estado === 'pendiente'" class="aviso espera">
        <strong>Tu registro está en revisión</strong>
        Cuando la empresa te apruebe podrás recibir y usar tu vale.
      </div>
      <div v-else-if="yo.estado === 'rechazado'" class="aviso no">
        <strong>Tu registro fue rechazado</strong>
        Consulta con Recursos Humanos.
      </div>

      <div v-if="enLaRed" class="vale" :class="{ congelado: enLaRed.congelado }">
        <span class="pequeno">{{ programa?.nombre ?? 'Tu vale' }}</span>
        <b>{{ soles(enLaRed.saldo) }}</b>
        <span class="pequeno">
          <template v-if="enLaRed.congelado">Vencido: ya no se puede usar</template>
          <template v-else-if="programa">
            Vence el {{ fecha(programa.vence_el) }} · {{ rubrosDelPrograma }}
          </template>
        </span>
      </div>
      <p v-else class="cargando">Consultando tu saldo…</p>
    </section>

    <section class="tarjeta">
      <h2>Dónde usarlo</h2>
      <p v-if="!afiliados.length" class="apagado pequeno">
        Todavía no hay comercios afiliados a tu programa.
      </p>
      <div v-for="c in afiliados" :key="c.id" class="fila">
        <div>
          <div class="nombre">{{ c.nombre }}</div>
          <div class="apagado pequeno">
            {{ RUBROS[c.rubro] ?? '' }}<template v-if="c.distrito"> · {{ c.distrito }}</template>
          </div>
        </div>
        <button class="suave chico" @click="usarComercio(c)">Pagar aquí</button>
      </div>
    </section>

    <section class="tarjeta" aria-live="polite">
      <h2>Pagar</h2>

      <p v-if="yo.estado !== 'verificado'" class="apagado">
        Podrás pagar cuando la empresa apruebe tu registro.
      </p>

      <!-- Paso 1: a quien y cuanto. -->
      <form v-else-if="paso === 'datos'" @submit.prevent="continuar">
        <p class="apagado pequeno">
          Apunta la cámara de tu celular al QR de la caja: se abrirá aquí con el
          comercio ya puesto. Si no puedes escanear, pide el código de 6 dígitos.
        </p>
        <div class="pareja">
          <div class="campo">
            <label for="cod">Código del comercio</label>
            <input id="cod" v-model="pago.codigo" inputmode="numeric" maxlength="6"
                   autocomplete="off" placeholder="000000" required>
          </div>
          <div class="campo">
            <label for="mon">Monto (S/)</label>
            <input id="mon" ref="campoMonto" v-model="pago.monto" type="text"
                   inputmode="decimal" autocomplete="off" placeholder="18,50" required>
          </div>
        </div>
        <button>Continuar</button>
      </form>

      <!-- Paso 2: confirmar antes de mover dinero. -->
      <div v-else-if="paso === 'confirmar'">
        <p class="confirmacion">
          Vas a pagar <b>{{ soles(pago.monto) }}</b> a
          <b>{{ destino.nombre }}</b>
        </p>
        <p class="apagado pequeno">
          {{ RUBROS[destino.rubro] ?? '' }}<template v-if="destino.distrito"> · {{ destino.distrito }}</template>
        </p>
        <div v-if="!rubroCubierto" class="aviso no">
          <strong>Tu vale no cubre {{ (RUBROS[destino.rubro] ?? destino.rubro).toLowerCase() }}</strong>
          Es una regla de tu programa: solo se puede usar en {{ rubrosDelPrograma.toLowerCase() }}.
        </div>
        <div class="acciones">
          <button class="si" :disabled="trabajando === 'pago' || !rubroCubierto" @click="confirmar">
            {{ trabajando === 'pago' ? 'Pagando…' : 'Confirmar pago' }}
          </button>
          <button class="suave" :disabled="trabajando === 'pago'" @click="paso = 'datos'">Volver</button>
        </div>
      </div>

      <!-- Paso 3: el resultado, con su comprobante. -->
      <div v-else-if="paso === 'resultado' && resultado">
        <div v-if="resultado.pagado" class="aviso ok" role="status">
          <strong>Pago confirmado</strong>
          {{ soles(pago.monto) }} a {{ resultado.comercio.nombre }}. Listo en segundos.
          <Prueba :tx="resultado.transaccion" />
        </div>
        <div v-else-if="resultado.controlDe === 'red'" class="aviso no" role="status">
          <strong>{{ resultado.transaccion.mensaje }}</strong>
          No se cobró nada y tu saldo no cambió.
          <span class="pequeno apagado">Lo rechazó la red, no esta aplicación.</span>
          <Prueba :tx="resultado.transaccion" />
        </div>
        <div v-else class="aviso no" role="status">
          <strong>{{ resultado.mensaje }}</strong>
          Es una regla de tu programa. No se envió ningún pago.
        </div>
        <button class="suave" @click="otroPago">Hacer otro pago</button>
      </div>
    </section>
  </template>
</template>
