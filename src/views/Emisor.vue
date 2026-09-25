<script setup>
import { computed, ref, watch } from 'vue';
import { api, saldoEnLaRed } from '../api.js';
import {
  estado, accion, fecha, montoValido, ponerPerfil, programaVigente, soles,
} from '../estado.js';
import Icono from '../Icono.vue';
import Marca from '../Marca.vue';
import { RUBROS, TIPOS } from '../../lib/rubros.js';
import { REGLA_PIN, pinValido, problemaDelPin } from '../../lib/reglas.js';
import Prueba from '../Prueba.vue';
import Qr from '../Qr.vue';
import TarjetaImpresa from '../TarjetaImpresa.vue';
import { enlaceRestablecer } from '../enlaces.js';


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
      titulo: rol === 'beneficiario' ? 'Invitar trabajadores' : 'Invitar bodegas',
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

/**
 * Registrar a alguien en Recursos Humanos: para quien no puede abrir la
 * invitacion, por ejemplo porque no tiene smartphone. La persona escribe su
 * PIN en el equipo de la empresa; nadie mas lo conoce. Queda pendiente, como
 * cualquier registro, y despues se le puede dar su tarjeta.
 */
const altaRrhh = ref({ abierta: false, nombre: '', celular: '', pin: '', pin2: '' });
const avisoAlta = ref('');
const problemaAlta = computed(() => problemaDelPin(altaRrhh.value.pin, altaRrhh.value.pin2));
const altaLista = computed(() => pinValido(altaRrhh.value.pin) && altaRrhh.value.pin === altaRrhh.value.pin2
  && altaRrhh.value.nombre.trim() && altaRrhh.value.celular.trim());
async function registrarTrabajador() {
  avisoAlta.value = '';
  const a = altaRrhh.value;
  if (!altaLista.value) return;
  trabajando.value = 'alta';
  try {
    const r = await accion(() => api.registrarBeneficiario({ nombre: a.nombre, celular: a.celular, pin: a.pin }));
    ultima.value = r.transaccion ?? null;
    altaRrhh.value = { abierta: false, nombre: '', celular: '', pin: '', pin2: '' };
  } catch (e) {
    avisoAlta.value = e.message;
    estado.error = null;
  } finally {
    trabajando.value = '';
  }
}

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
  nombre: `Vale de alimentos · ${new Date().toLocaleDateString('es-PE', { month: 'long' }).toLowerCase()}`,
  monto: '50',
  venceEl: en30dias(),
  tipo: 'alimentaria',
  rubros: ['alimentos'],
});
const hoyLima = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
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

const hecho = ref('');   // confirmacion de la ultima accion del programa
async function ejecutar(nombre, fn) {
  trabajando.value = nombre;
  hecho.value = '';
  try {
    const r = await accion(fn);
    ultima.value = r.transacciones?.at(-1) ?? null;
    if (nombre === 'entregar') {
      hecho.value = `Vale entregado a ${r.entregados} ${r.entregados === 1 ? 'trabajador' : 'trabajadores'}.`;
    }
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

// --- A quienes entregar ------------------------------------------------------
// La empresa elige: un bono puede ser solo para algunos. Quien ya recibio el
// vale de este programa no se puede elegir otra vez.
const recibieron = computed(() => new Set(programa.value?.recibieron ?? []));
const aprobados = computed(() => estado.beneficiarios.filter((b) => b.estado === 'verificado'));
const sinRecibir = computed(() => aprobados.value.filter((b) => !recibieron.value.has(b.id)));
const elegidos = ref([]);
// Al cambiar quienes faltan (entrega hecha, alguien aprobado), se marcan todos.
watch(() => sinRecibir.value.map((b) => b.id).join(','), () => {
  elegidos.value = sinRecibir.value.map((b) => b.id);
}, { immediate: true });
const porEntregar = computed(() => elegidos.value.length);
function marcarTodos(si) {
  elegidos.value = si ? sinRecibir.value.map((b) => b.id) : [];
}

// --- Navegacion del panel ---------------------------------------------------

const seccion = ref('resumen');
const SECCIONES = computed(() => [
  { clave: 'resumen', nombre: 'Inicio', icono: 'resumen', cuenta: pendientes.value.length },
  { clave: 'programa', nombre: 'Programa', icono: 'vale' },
  { clave: 'personas', nombre: 'Trabajadores', icono: 'personas' },
  { clave: 'bodegas', nombre: 'Bodegas', icono: 'tienda' },
  { clave: 'invitar', nombre: 'Invitar', icono: 'enviar' },
  { clave: 'historial', nombre: 'Historial', icono: 'historial' },
]);
function irSeccion(clave) {
  seccion.value = clave;
  hoja.value = null;
  ultima.value = null;
  hecho.value = '';
  window.scrollTo(0, 0);
}
const empresa = computed(() => (estado.yo?.empresa ?? 'Empresa').replace(' (demostración)', ''));
const trabajadores = computed(() => estado.beneficiarios.filter((b) => b.estado !== 'baja').length);
const bodegas = computed(() => estado.comercios.filter((c) => c.estado === 'verificado').length);
const rechazos = computed(() => estado.eventos.filter((e) => e.tipo === 'pagar' && !e.exitosa).length);
const iniciales = (nombre) => String(nombre ?? '').split(/\s+/).filter(Boolean).slice(0, 2)
  .map((p) => p[0]).join('').toUpperCase();
const recibidoPor = (nombre) => tiendas.value.find((t) => t.nombre === nombre)?.saldo ?? null;

/** Dias hasta el vencimiento, por la fecha de Lima y no por la hora. */
const diasParaVencer = computed(() => {
  if (!programa.value?.vence_el) return null;
  const [a, m, d] = String(programa.value.vence_el).slice(0, 10).split('-').map(Number);
  const hoy = new Date();
  const inicioHoy = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((Date.UTC(a, m - 1, d) - inicioHoy) / 86400000);
});

async function salir(todas = false) {
  await (todas ? api.cerrarTodas() : api.salir()).catch(() => {});
  await ponerPerfil(await api.sesion());
  window.location.hash = '#/';
}

/**
 * Cada operacion del historial dicha para Recursos Humanos: que paso, no el
 * nombre tecnico de la operacion. El codigo de la red queda aparte, como
 * evidencia.
 */
const MOTIVOS = {
  op_not_authorized: 'La tienda no está afiliada',
  op_src_not_authorized: 'El vale estaba congelado',
  op_underfunded: 'No alcanzaba el saldo',
};
function describir(e) {
  const t = e.etiqueta ?? '';
  const numero = (re) => Number((re.exec(t) ?? [])[1] ?? 1);
  if (e.tipo === 'pagar') {
    const monto = (/pagar ([\d.]+)/.exec(t) ?? [])[1];
    const rubro = RUBROS[(/rubro (\w+)/.exec(t) ?? [])[1]];
    return {
      titulo: e.exitosa ? `Pago de ${soles(monto)}` : `Pago de ${soles(monto)} rechazado por la red`,
      detalle: e.exitosa ? rubro ?? '' : MOTIVOS[e.codigo_error] ?? 'La red no lo aceptó',
    };
  }
  if (e.tipo === 'emitir') {
    const n = numero(/\((\d+) beneficiarios\)/);
    return { titulo: `Vale entregado a ${n} ${n === 1 ? 'trabajador' : 'trabajadores'}`, detalle: '' };
  }
  if (e.tipo === 'autorizar') return { titulo: 'Aprobación: cuenta autorizada para el vale', detalle: '' };
  if (e.tipo.startsWith('alta')) {
    const n = numero(/\((\d+) cuentas/);
    return { titulo: n === 1 ? 'Cuenta creada' : `${n} cuentas creadas`, detalle: 'Las reservas de la red las cubre la empresa' };
  }
  if (e.tipo === 'vencer') return { titulo: 'Programa vencido', detalle: 'Vales congelados y saldo no usado anulado' };
  if (e.tipo === 'baja') return { titulo: 'Baja de un trabajador', detalle: 'Vale congelado y saldo anulado' };
  if (e.tipo === 'descongelar') {
    const n = numero(/\((\d+) cuentas\)/);
    return { titulo: `${n === 1 ? 'Cuenta reactivada' : `${n} cuentas reactivadas`} para el programa nuevo`, detalle: '' };
  }
  return { titulo: t, detalle: '' };
}
const cuando = (f) => new Date(f).toLocaleString('es-PE', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** Para una empresa que recien empieza: que falta para entregar el primer vale. */
const primerosPasos = computed(() => [
  {
    texto: 'Invita a tus trabajadores y a las bodegas',
    hecho: estado.beneficiarios.length > 0 && estado.comercios.length > 0,
    ir: 'invitar',
  },
  {
    texto: 'Aprueba a quienes se registraron',
    hecho: estado.beneficiarios.some((b) => b.estado === 'verificado')
      && estado.comercios.some((c) => c.estado === 'verificado'),
    ir: 'resumen',
  },
  {
    texto: 'Crea el programa y entrega el vale',
    hecho: (programa.value?.entregados ?? 0) > 0,
    ir: 'programa',
  },
]);
const empezando = computed(() => primerosPasos.value.some((p) => !p.hecho) && !programa.value?.entregados);
</script>

<template>
  <div class="emp">
    <!-- Cabecera clara con pestanas: cabe igual en una computadora, en el
         marco de la vista en vivo y en un celular, donde se desliza. -->
    <header class="emp-barra">
      <div class="emp-barra-dentro">
        <Marca :tamano="28" />
        <span class="emp-nombre">{{ empresa }}</span>
        <span v-if="estado.yo?.demo" class="insignia">Prueba</span>
        <div class="emp-cuenta">
          <button class="suave chico" @click="salir()">Salir</button>
        </div>
      </div>
      <nav class="emp-pestanas" aria-label="Secciones de la empresa">
        <button
          v-for="s in SECCIONES" :key="s.clave" class="emp-pestana"
          :aria-current="seccion === s.clave ? 'page' : undefined"
          @click="irSeccion(s.clave)">
          <Icono :nombre="s.icono" :tamano="18" />
          {{ s.nombre }}
          <span v-if="s.cuenta" class="cuenta-n" :aria-label="`${s.cuenta} por aprobar`">{{ s.cuenta }}</span>
        </button>
      </nav>
    </header>

    <main class="emp-contenido">
      <div v-if="estado.error" class="aviso no" role="alert">{{ estado.error }}</div>

      <!-- ================= RESUMEN ================= -->
      <template v-if="seccion === 'resumen'">
        <div class="emp-titulo">
          <div>
            <h1>{{ programa ? programa.nombre : 'Inicio' }}</h1>
            <p>
              {{ trabajadores }} {{ trabajadores === 1 ? 'trabajador' : 'trabajadores' }} ·
              {{ bodegas }} {{ bodegas === 1 ? 'bodega afiliada' : 'bodegas afiliadas' }}
            </p>
          </div>
          <span v-if="vigente && diasParaVencer !== null" class="chip">
            <Icono nombre="reloj" :tamano="16" />
            {{ diasParaVencer <= 0 ? 'Vence hoy' : `Vence en ${diasParaVencer} ${diasParaVencer === 1 ? 'día' : 'días'}` }}
          </span>
          <span v-else-if="programa?.estado === 'vencido'" class="etiqueta no">Vencido</span>
        </div>

        <section v-if="empezando" class="tarjeta">
          <h2>Primeros pasos</h2>
          <ol class="pasos-lista">
            <li v-for="(p, i) in primerosPasos" :key="i" :class="{ hecho: p.hecho }">
              <span class="paso-marca" aria-hidden="true">
                <Icono v-if="p.hecho" nombre="check" :tamano="16" /><template v-else>{{ i + 1 }}</template>
              </span>
              <span class="paso-texto">{{ p.texto }}<span v-if="p.hecho" class="oculto"> (hecho)</span></span>
              <button v-if="!p.hecho && p.ir !== 'resumen'" class="suave chico" @click="irSeccion(p.ir)">
                {{ p.ir === 'invitar' ? 'Invitar' : 'Ir al programa' }}
              </button>
            </li>
          </ol>
        </section>

        <div v-if="programa" class="cifras" style="margin-bottom:16px">
          <div class="cifra destacada">
            <span>Gastado en bodegas</span><b>{{ soles(gastado) }}</b>
            <span v-if="entregado">{{ Math.round((gastado / entregado) * 100) }} % de {{ soles(entregado) }}</span>
          </div>
          <div class="cifra">
            <span>{{ programa?.estado === 'vencido' ? 'Anulado al vencer' : 'Sin usar' }}</span>
            <b>{{ soles(programa?.estado === 'vencido' ? anulado : saldoVigente) }}</b>
            <span>{{ programa?.estado === 'vencido' ? 'Ya no existe' : 'Se anula al vencer' }}</span>
          </div>
          <div class="cifra"><span>Entregado</span><b>{{ soles(entregado) }}</b><span>{{ programa?.entregados ?? 0 }} {{ programa?.entregados === 1 ? 'vale' : 'vales' }}</span></div>
          <div :class="['cifra', { mal: rechazos }]"><span>Pagos rechazados</span><b>{{ rechazos }}</b><span>Tienda no afiliada</span></div>
        </div>
        <p v-if="errorGasto" class="aviso espera">{{ errorGasto }}</p>

        <section class="tarjeta">
          <h2>Por aprobar <span v-if="pendientes.length" class="etiqueta espera">{{ pendientes.length }}</span></h2>
          <p class="apagado pequeno">Al aprobar, la cuenta queda autorizada en la red de pagos y puede recibir el vale.</p>
          <p v-if="!pendientes.length" class="apagado">No hay nada pendiente.</p>
          <div v-for="f in pendientes" :key="`${f.tipo}-${f.id}`" class="fila">
            <div class="persona-t">
              <span class="av" aria-hidden="true">{{ iniciales(f.nombre) }}</span>
              <div>
                <div class="nombre">{{ f.nombre }}</div>
                <div class="apagado pequeno">
                  {{ f.tipo === 'beneficiario' ? 'Trabajador' : `Bodega · ${RUBROS[f.rubro] ?? ''}` }}
                  <template v-if="f.distrito"> · {{ f.distrito }}</template>
                </div>
              </div>
            </div>
            <div class="acciones">
              <button class="si chico" :disabled="trabajando === `${f.tipo}-${f.id}`"
                      @click="verificar(f, true)"><Icono nombre="check" :tamano="18" /> Aprobar y autorizar</button>
              <button class="no chico" :disabled="trabajando === `${f.tipo}-${f.id}`"
                      @click="verificar(f, false)">Rechazar</button>
            </div>
          </div>
          <Prueba v-if="ultima" :tx="ultima" />
        </section>

        <section v-if="programa" class="tarjeta">
          <h2><span class="punto" aria-hidden="true" /> Gasto en vivo</h2>
          <p class="apagado pequeno">Saldos leídos en vivo desde la red Stellar.</p>
          <p v-if="!gasto.length" class="apagado">Todavía no hay trabajadores aprobados.</p>
          <div v-else class="tabla-envoltura">
            <table class="tabla">
              <thead><tr><th>Persona</th><th>Estado</th><th class="der">Saldo</th></tr></thead>
              <tbody>
                <tr v-for="g in gasto" :key="g.nombre">
                  <td><span class="persona-t"><span class="av" aria-hidden="true">{{ iniciales(g.nombre) }}</span>{{ g.nombre }}</span></td>
                  <td>
                    <span v-if="g.congelado" class="etiqueta no">Congelado</span>
                    <span v-else class="etiqueta ok">Activo</span>
                  </td>
                  <td class="der">{{ soles(g.saldo) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <!-- ================= PROGRAMA ================= -->
      <template v-else-if="seccion === 'programa'">
        <div class="emp-titulo"><div><h1>Programa</h1><p>El vale, su monto, dónde se usa y cuándo vence.</p></div></div>

        <section class="tarjeta">
          <form v-if="!vigente" @submit.prevent="crear">
            <h2>{{ programa ? 'Nuevo programa' : 'Crea tu primer programa' }}</h2>
            <fieldset class="campo">
              <legend>Tipo de programa</legend>
              <label v-for="(t, clave) in TIPOS" :key="clave" class="opcion">
                <input v-model="nuevo.tipo" type="radio" name="tipo" :value="clave"> {{ t.nombre }}
              </label>
            </fieldset>
            <fieldset class="campo">
              <legend>Dónde se puede gastar</legend>
              <p v-if="rubrosFijos" style="margin:4px 0">
                Solo en <b>alimentos y abarrotes</b>: lo exige la Ley 28051 para la prestación alimentaria.
              </p>
              <template v-else>
                <label v-for="(nombre, clave) in RUBROS" :key="clave" class="opcion">
                  <input v-model="nuevo.rubros" type="checkbox" :value="clave">
                  {{ nombre }}
                </label>
              </template>
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
                <input id="pv" v-model="nuevo.venceEl" type="date" :min="hoyLima" required>
              </div>
            </div>
            <button class="si" :disabled="trabajando === 'crear' || !nuevo.rubros.length">Crear programa</button>
          </form>

          <template v-if="programa">
            <div class="fila" :style="!vigente ? 'margin-top:18px' : ''">
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

            <fieldset v-if="programa.estado === 'vigente' && aprobados.length" class="campo" style="margin-top:14px">
              <legend>¿A quiénes entregar? ({{ soles(programa.monto) }} a cada uno)</legend>
              <label v-if="sinRecibir.length > 1" class="opcion">
                <input type="checkbox" :checked="elegidos.length === sinRecibir.length"
                       @change="marcarTodos($event.target.checked)">
                <b>Todos los que faltan</b>
              </label>
              <label v-for="b in aprobados" :key="b.id" class="opcion">
                <input v-model="elegidos" type="checkbox" :value="b.id" :disabled="recibieron.has(b.id)">
                {{ b.nombre }}
                <span v-if="recibieron.has(b.id)" class="etiqueta ok">Ya recibió</span>
              </label>
            </fieldset>
            <p v-else-if="programa.estado === 'vigente'" class="apagado pequeno" style="margin-top:12px">
              Todavía no hay trabajadores aprobados para entregarles el vale.
            </p>

            <div v-if="programa.estado === 'vigente'" class="acciones" style="margin-top:12px">
              <button class="si" :disabled="trabajando === 'entregar' || !porEntregar"
                      @click="ejecutar('entregar', () => api.entregar(programa.id, elegidos))">
                {{ trabajando === 'entregar' ? 'Entregando…'
                  : porEntregar ? `Entregar vale a ${porEntregar} ${porEntregar === 1 ? 'trabajador' : 'trabajadores'}`
                    : sinRecibir.length ? 'Elige a quién entregar' : 'Todos recibieron su vale' }}
              </button>
              <button class="suave" :disabled="trabajando === 'vencer'"
                      @click="ejecutar('vencer', () => api.vencer(programa.id))">
                {{ trabajando === 'vencer' ? 'Venciendo…' : 'Vencer programa' }}
              </button>
            </div>

            <p v-if="hecho" class="aviso ok" role="status">{{ hecho }}</p>
            <p v-if="programa.estado === 'vencido'" class="aviso ok">
              El saldo no usado se anuló en la red: deja de existir, y el respaldo
              en soles de la empresa deja de estar comprometido.
            </p>
          </template>
          <Prueba v-if="ultima" :tx="ultima" />
        </section>
      </template>

      <!-- ================= PERSONAS ================= -->
      <template v-else-if="seccion === 'personas'">
        <div class="emp-titulo"><div><h1>Trabajadores</h1><p>Tarjetas, PIN nuevo y bajas.</p></div></div>
        <section class="tarjeta">
          <div class="fila" style="border:none;padding-top:0">
            <p class="apagado pequeno" style="margin:0">
              ¿Alguien no puede abrir la invitación, por ejemplo porque no tiene smartphone? Regístralo aquí.
            </p>
            <button v-if="!altaRrhh.abierta" class="suave chico" @click="altaRrhh.abierta = true">Registrar trabajador</button>
          </div>
          <form v-if="altaRrhh.abierta" class="bloque" style="margin-top:0" @submit.prevent="registrarTrabajador">
            <h3>Registrar trabajador</h3>
            <div class="pareja">
              <div class="campo">
                <label for="rt-nombre">Nombre</label>
                <input id="rt-nombre" v-model="altaRrhh.nombre" autocomplete="off" required>
              </div>
              <div class="campo">
                <label for="rt-cel">Celular (con él entra, si algún día tiene smartphone)</label>
                <input id="rt-cel" v-model="altaRrhh.celular" type="tel" inputmode="numeric" autocomplete="off" required>
              </div>
            </div>
            <p class="apagado pequeno">Pásale el equipo a la persona para que elija su PIN. Nadie más debe verlo. {{ REGLA_PIN }}</p>
            <div class="pareja">
              <div class="campo">
                <label for="rt-pin">PIN de 4 números</label>
                <input id="rt-pin" v-model="altaRrhh.pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" required>
              </div>
              <div class="campo">
                <label for="rt-pin2">Repite el PIN</label>
                <input id="rt-pin2" v-model="altaRrhh.pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="off" required>
              </div>
            </div>
            <p v-if="problemaAlta" class="aviso espera" role="status">{{ problemaAlta }}</p>
            <p v-if="avisoAlta" class="aviso no" role="alert">{{ avisoAlta }}</p>
            <div class="acciones">
              <button class="si" :disabled="trabajando === 'alta' || !altaLista">{{ trabajando === 'alta' ? 'Registrando…' : 'Registrar' }}</button>
              <button type="button" class="suave" @click="altaRrhh.abierta = false">Cancelar</button>
            </div>
            <p class="apagado pequeno" style="margin-top:10px">Queda por aprobar en «Inicio». Después le das su tarjeta desde esta lista.</p>
          </form>
          <p v-if="!estado.beneficiarios.length" class="apagado">Todavía nadie se registró. Invítalos desde «Invitar».</p>
          <div v-for="b in estado.beneficiarios" :key="`b-${b.id}`" class="fila">
            <div class="persona-t">
              <span class="av" aria-hidden="true">{{ iniciales(b.nombre) }}</span>
              <div>
                <div class="nombre">{{ b.nombre }}</div>
                <div class="apagado pequeno">
                  <template v-if="b.celular">Celular {{ b.celular }}</template>
                  <template v-if="b.tarjeta"> · Tarjeta {{ b.tarjeta }}</template>
                </div>
                <span :class="['etiqueta', ESTADOS[b.estado]?.[0]]">{{ ESTADOS[b.estado]?.[1] ?? b.estado }}</span>
              </div>
            </div>
            <div v-if="b.estado !== 'baja'" class="acciones">
              <button v-if="b.estado !== 'rechazado'" class="suave chico" :disabled="Boolean(trabajando)" @click="darTarjeta(b)">
                <Icono nombre="tarjeta" :tamano="18" /> {{ b.tarjeta ? 'Nueva tarjeta' : 'Dar tarjeta' }}
              </button>
              <button v-if="b.tarjeta" class="suave chico" :disabled="Boolean(trabajando)" @click="anularTarjeta(b)">Anular tarjeta</button>
              <button v-if="b.celular" class="suave chico" :disabled="Boolean(trabajando)" @click="nuevoPin('beneficiarios', b)">Nuevo PIN</button>
              <button class="no chico" :disabled="Boolean(trabajando)" @click="confirmarBaja = b">Dar de baja</button>
            </div>
            <div v-if="confirmarBaja?.id === b.id" class="aviso no" role="alertdialog" style="flex-basis:100%">
              <strong>¿Dar de baja a {{ b.nombre }}?</strong>
              Su saldo se congela y se anula en una sola operación, y su tarjeta
              deja de servir. No se puede deshacer.
              <div class="acciones" style="margin-top:8px">
                <button class="no chico" :disabled="trabajando === `baja-${b.id}`" @click="darDeBaja(b)">
                  {{ trabajando === `baja-${b.id}` ? 'Dando de baja…' : 'Sí, dar de baja' }}
                </button>
                <button class="suave chico" @click="confirmarBaja = null">No</button>
              </div>
            </div>
          </div>
          <Prueba v-if="ultima" :tx="ultima" />
        </section>
      </template>

      <!-- ================= BODEGAS ================= -->
      <template v-else-if="seccion === 'bodegas'">
        <div class="emp-titulo"><div><h1>Bodegas</h1><p>Solo las afiliadas pueden cobrar el vale.</p></div></div>
        <section class="tarjeta">
          <p v-if="!estado.comercios.length" class="apagado">Todavía ninguna bodega se registró. Invítalas desde «Invitar».</p>
          <div v-for="c in estado.comercios" :key="`c-${c.id}`" class="fila">
            <div class="persona-t">
              <span class="av" aria-hidden="true">{{ iniciales(c.nombre) }}</span>
              <div>
                <div class="nombre">{{ c.nombre }}</div>
                <div class="apagado pequeno">
                  {{ RUBROS[c.rubro] ?? '' }}<template v-if="c.distrito"> · {{ c.distrito }}</template>
                  <template v-if="c.celular"> · Celular {{ c.celular }}</template>
                </div>
                <span :class="['etiqueta', ESTADOS[c.estado]?.[0]]">
                  {{ c.estado === 'verificado' ? 'Afiliada en la red' : ESTADOS[c.estado]?.[1] }}
                </span>
              </div>
            </div>
            <div class="acciones">
              <span v-if="recibidoPor(c.nombre) !== null" class="apagado pequeno">Recibió {{ soles(recibidoPor(c.nombre)) }}</span>
              <button v-if="c.celular" class="suave chico" :disabled="Boolean(trabajando)" @click="nuevoPin('comercios', c)">Nuevo PIN</button>
            </div>
          </div>
        </section>
      </template>

      <!-- ================= INVITAR ================= -->
      <template v-else-if="seccion === 'invitar'">
        <div class="emp-titulo">
          <div><h1>Invitar</h1><p>Cada persona se registra con su celular y un PIN de 4 números. Después tú la apruebas.</p></div>
        </div>
        <div class="invitaciones">
          <article v-for="inv in invitaciones" :key="inv.rol" class="invitacion tarjeta">
            <h3>{{ inv.titulo }}</h3>
            <p class="apagado pequeno">{{ inv.detalle }}</p>
            <Qr :texto="inv.enlace" nivel="M" :alt="`Código QR para ${inv.titulo.toLowerCase()}`" :tamano="190" />
            <div class="acciones" style="margin-top:10px">
              <a class="boton si" :href="inv.whatsapp" target="_blank" rel="noopener"><Icono nombre="mensaje" :tamano="18" /> Enviar por WhatsApp</a>
              <button v-if="puedeCompartir" class="suave" @click="compartir(inv)">Compartir</button>
              <button class="suave" @click="copiar(inv)">{{ copiado === inv.rol ? 'Copiado' : 'Copiar enlace' }}</button>
            </div>
            <p v-if="inv.rol === 'beneficiario'" class="apagado pequeno" style="margin:12px 0 0">
              ¿Alguien no tiene smartphone?
              <button class="enlace-texto" @click="irSeccion('personas'); altaRrhh.abierta = true">Regístralo</button>
              y dale una tarjeta.
            </p>
          </article>
        </div>
      </template>

      <!-- ================= HISTORIAL ================= -->
      <template v-else-if="seccion === 'historial'">
        <div class="emp-titulo"><div><h1>Historial</h1><p>Cada operación con su comprobante público.</p></div></div>
        <section class="tarjeta">
          <p v-if="!estado.eventos.length" class="apagado pequeno">Sin operaciones todavía.</p>
          <div v-for="e in estado.eventos" :key="e.id" class="fila">
            <div>
              <div class="nombre">
                {{ describir(e).titulo }}
                <span v-if="!e.exitosa" class="etiqueta no">Rechazado</span>
              </div>
              <div class="apagado pequeno">
                {{ cuando(e.creado_en) }}<template v-if="describir(e).detalle"> · {{ describir(e).detalle }}</template>
                <template v-if="!e.exitosa"> · código de la red: <code>{{ e.codigo_error }}</code></template>
              </div>
            </div>
            <a :href="e.explorador" target="_blank" rel="noopener" class="pequeno">ver comprobante</a>
          </div>
        </section>
      </template>

      <!-- Lo que se le entrega a la persona: su tarjeta o su enlace de PIN nuevo. -->
      <section v-if="hoja" class="tarjeta hoja">
        <template v-if="hoja.tipo === 'tarjeta'">
          <h2>Tarjeta de {{ hoja.nombre }}</h2>
          <p class="apagado pequeno">
            Imprímela y entrégasela. Paga en las bodegas afiliadas marcando su PIN,
            hasta S/ 100 por día. La anterior, si tenía, ya no sirve.
          </p>
          <TarjetaImpresa :numero="hoja.numero" :nombre="hoja.nombre" :empresa="empresa" />
          <div class="acciones" style="margin-top:10px">
            <button class="si" @click="imprimir"><Icono nombre="imprimir" :tamano="18" /> Imprimir tarjeta</button>
            <button class="suave" @click="hoja = null">Cerrar</button>
          </div>
        </template>
        <template v-else>
          <h2>PIN nuevo para {{ hoja.nombre }}</h2>
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
      </section>

      <div v-if="hoja?.tipo === 'tarjeta'" class="cartel" aria-hidden="true">
        <TarjetaImpresa :numero="hoja.numero" :nombre="hoja.nombre" :empresa="empresa" />
      </div>

      <p style="margin-top:20px">
        <button class="enlace" @click="salir(true)">Cerrar sesión en todos mis dispositivos</button>
      </p>
      <p class="apagado pequeno pie-app">
        Cada operación queda en el registro público de Stellar (red de pruebas) y se verifica con su comprobante.
        La verificación de identidad es simulada.
      </p>
    </main>
  </div>
</template>
