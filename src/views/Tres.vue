<script setup>
/**
 * Tres pantallas lado a lado: la empresa, la tienda y el trabajador.
 *
 * Cada una es la aplicacion de verdad, en su propio marco y con su propia
 * sesion (ver src/marco.js). Lo que se ve aqui es exactamente lo que vera
 * cada persona en su celular.
 *
 * Esta pagina solo hace de "mostrador": pasa el QR de la tienda al
 * trabajador, pasa la tarjeta de Rosa por la tienda, y avisa a todas las
 * pantallas cuando algo cambia.
 */
import {
  computed, onMounted, onUnmounted, ref, watch,
} from 'vue';
import { leerDemo, persona } from '../demo.js';
import { nombreDeMarco } from '../marco.js';
import Icono from '../Icono.vue';
import TarjetaImpresa from '../TarjetaImpresa.vue';

const demo = leerDemo();
const tiendas = (demo?.personas ?? []).filter((p) => p.rol === 'comercio');
const claveTienda = ref(tiendas[0]?.clave ?? '');
const claveTrabajador = ref('maria');

const tienda = computed(() => persona(demo, claveTienda.value));
const trabajador = computed(() => persona(demo, claveTrabajador.value));
const sinSmartphone = computed(() => Boolean(trabajador.value?.tarjeta));

const marcoEmpresa = ref(null);
const marcoTienda = ref(null);
const marcoTrabajador = ref(null);
const marcos = () => [marcoEmpresa.value, marcoTienda.value, marcoTrabajador.value].filter(Boolean);

const qrActual = ref(null);
const tarjetaPasada = ref(null);

function enviar(marco, mensaje) {
  marco?.contentWindow?.postMessage(mensaje, window.location.origin);
}

function alRecibir(e) {
  if (e.origin !== window.location.origin) return;
  const m = e.data ?? {};
  if (m.tipo === 'stellarrail-qr' && e.source === marcoTienda.value?.contentWindow) {
    qrActual.value = m.enlace ?? null;
    enviar(marcoTrabajador.value, { tipo: 'stellarrail-qr', enlace: qrActual.value });
  } else if (m.tipo === 'stellarrail-cambio') {
    for (const marco of marcos()) {
      if (marco.contentWindow !== e.source) enviar(marco, { tipo: 'stellarrail-cambio' });
    }
  }
}

onMounted(() => window.addEventListener('message', alRecibir));
onUnmounted(() => window.removeEventListener('message', alRecibir));

// Otra tienda: su QR todavia no existe, y la tarjeta hay que volver a pasarla.
watch(claveTienda, () => {
  qrActual.value = null;
  tarjetaPasada.value = null;
  enviar(marcoTrabajador.value, { tipo: 'stellarrail-qr', enlace: null });
});

// Un marco recien cargado no sabe lo que paso antes: se le cuenta.
const alCargarTrabajador = () => enviar(marcoTrabajador.value, { tipo: 'stellarrail-qr', enlace: qrActual.value });
const alCargarTienda = () => enviar(marcoTienda.value, { tipo: 'stellarrail-tarjeta', numero: tarjetaPasada.value });

function pasarTarjeta() {
  tarjetaPasada.value = trabajador.value.tarjeta;
  enviar(marcoTienda.value, { tipo: 'stellarrail-tarjeta', numero: tarjetaPasada.value });
}

const irA = (ruta) => { window.location.hash = ruta; };
</script>

<template>
  <div class="tres">
    <header class="tres-cabecera">
      <div>
        <h1>StellarRail · tres pantallas</h1>
        <p class="apagado" style="margin:0">
          Cada pantalla es una sesión distinta, como si fueran tres celulares.
          El QR de la tienda se «escanea» con un clic desde la pantalla del trabajador.
        </p>
      </div>
      <button class="suave" @click="irA('#/demo')"><Icono nombre="atras" /> Volver a la demostración</button>
    </header>

    <div v-if="!demo" class="tarjeta" style="max-width:560px">
      <h2>Primero crea la demostración</h2>
      <button class="principal" @click="irA('#/')">Ir a la portada</button>
    </div>

    <div v-else class="tres-columnas">
      <section class="columna">
        <h2>Empresa</h2>
        <p class="apagado pequeno">{{ demo.empresa.nombre }}</p>
        <iframe
          ref="marcoEmpresa" :name="nombreDeMarco(demo.empresa.credencial)" src="/#/"
          title="Pantalla de la empresa" />
      </section>

      <section class="columna">
        <h2>Tienda</h2>
        <label for="elegir-tienda" class="pequeno">Ver la pantalla de</label>
        <select id="elegir-tienda" v-model="claveTienda">
          <option v-for="t in tiendas" :key="t.clave" :value="t.clave">{{ t.nombre }}</option>
        </select>
        <iframe
          :key="tienda.clave" ref="marcoTienda" :name="nombreDeMarco(tienda.credencial)" src="/#/"
          :title="`Pantalla de la tienda ${tienda.nombre}`" @load="alCargarTienda" />
      </section>

      <section class="columna">
        <h2>Trabajador</h2>
        <label for="elegir-trabajador" class="pequeno">Ver la pantalla de</label>
        <select id="elegir-trabajador" v-model="claveTrabajador">
          <option value="maria">María · con smartphone</option>
          <option value="rosa">Rosa · sin smartphone, con tarjeta</option>
        </select>

        <div v-if="sinSmartphone" class="sin-smartphone">
          <p>
            Rosa no tiene smartphone. Paga en la tienda con esta tarjeta: la
            tienda la escanea y Rosa marca su PIN en el equipo de la tienda.
          </p>
          <TarjetaImpresa :numero="trabajador.tarjeta" :nombre="trabajador.nombre" :empresa="demo.empresa.nombre" />
          <button class="principal" @click="pasarTarjeta">
            <Icono nombre="tienda" :tamano="26" /> Pasar la tarjeta por la tienda
          </button>
          <p v-if="tarjetaPasada" class="aviso ok">
            Listo. En la pantalla de la tienda, elige «Con tarjeta» y escanéala.
          </p>
          <p class="apagado">PIN de Rosa: <code>{{ trabajador.pin }}</code> (en la vida real, solo ella lo sabe).</p>
        </div>
        <iframe
          v-else :key="trabajador.clave" ref="marcoTrabajador" :name="nombreDeMarco(trabajador.credencial)" src="/#/"
          :title="`Pantalla de ${trabajador.nombre}`" @load="alCargarTrabajador" />
      </section>
    </div>
  </div>
</template>
