<script setup>
/**
 * Vista en vivo del espacio de prueba: la empresa, la tienda y el
 * trabajador lado a lado, cada uno en su propio dispositivo y con su propia
 * sesion.
 *
 * Cada marco es la aplicacion de verdad (ver src/marco.js). Esta pagina solo
 * hace de "mostrador": acerca el QR de la tienda a la camara del trabajador,
 * acerca la tarjeta de Rosa a la tienda y avisa a todos cuando algo cambia.
 */
import {
  computed, onMounted, onUnmounted, ref, watch,
} from 'vue';
import { api } from '../api.js';
import { ponerPerfil } from '../estado.js';
import { leerDemo, persona } from '../demo.js';
import { nombreDeMarco } from '../marco.js';
import CuentasDePrueba from '../CuentasDePrueba.vue';
import Icono from '../Icono.vue';
import Marca from '../Marca.vue';
import TarjetaImpresa from '../TarjetaImpresa.vue';

const demo = leerDemo();
const empresa = demo?.empresa.nombre.replace(' (demostración)', '') ?? '';
const tiendas = (demo?.personas ?? []).filter((p) => p.rol === 'comercio');
const trabajadores = (demo?.personas ?? []).filter((p) => p.rol === 'beneficiario');
const claveTienda = ref(tiendas[0]?.clave ?? '');
const claveTrabajador = ref(trabajadores[0]?.clave ?? '');

const tienda = computed(() => persona(demo, claveTienda.value));
const trabajador = computed(() => persona(demo, claveTrabajador.value));
const sinSmartphone = computed(() => Boolean(trabajador.value?.tarjeta));

// El panel de cuentas se abre solo la primera vez, recien creada la demo.
const panel = ref(Boolean(demo) && Date.now() - (demo.creadaEn ?? 0) < 5 * 60 * 1000);

const marcoEmpresa = ref(null);
const marcoTienda = ref(null);
const marcoTrabajador = ref(null);
const marcos = () => [marcoEmpresa.value, marcoTienda.value, marcoTrabajador.value].filter(Boolean);

const qrActual = ref(null);
const tarjetaAcercada = ref(null);

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

// Otra tienda: su QR todavia no existe, y la tarjeta hay que volver a acercarla.
watch(claveTienda, () => {
  qrActual.value = null;
  tarjetaAcercada.value = null;
  enviar(marcoTrabajador.value, { tipo: 'stellarrail-qr', enlace: null });
});

// Un marco recien cargado no sabe lo que paso antes: se le cuenta.
const alCargarTrabajador = () => enviar(marcoTrabajador.value, { tipo: 'stellarrail-qr', enlace: qrActual.value });
const alCargarTienda = () => enviar(marcoTienda.value, { tipo: 'stellarrail-tarjeta', numero: tarjetaAcercada.value });

function acercarTarjeta() {
  tarjetaAcercada.value = trabajador.value.tarjeta;
  enviar(marcoTienda.value, { tipo: 'stellarrail-tarjeta', numero: tarjetaAcercada.value });
}

async function salir() {
  await api.salir().catch(() => {});
  await ponerPerfil(await api.sesion());
  window.location.hash = '#/';
}
const irA = (ruta) => { window.location.hash = ruta; };
</script>

<template>
  <div class="vivo">
    <header class="vivo-barra">
      <div class="vivo-marca">
        <Marca />
        <span class="insignia">Espacio de prueba</span>
        <span v-if="demo" class="apagado pequeno ocultar-movil">{{ empresa }}</span>
      </div>
      <div class="acciones">
        <button class="suave" :aria-expanded="panel" aria-controls="panel-cuentas" @click="panel = !panel">
          Cuentas de prueba
        </button>
        <button class="suave" @click="salir">Salir</button>
      </div>
    </header>

    <div v-if="!demo" class="tarjeta" style="max-width:560px;margin:24px auto">
      <h2>No hay un espacio de prueba en este navegador</h2>
      <button class="principal" @click="irA('#/')">Ir al inicio</button>
    </div>

    <main v-else class="vivo-dispositivos">
      <section class="vivo-columna vivo-pc">
        <div class="vivo-etiqueta"><b>Empresa</b><span class="apagado">{{ empresa }}</span></div>
        <div class="dispositivo-pc">
          <div class="pc-barra" aria-hidden="true"><i /><i /><i /><span>stellar-rail.vercel.app</span></div>
          <iframe
            ref="marcoEmpresa" :name="nombreDeMarco(demo.empresa.credencial)" src="/#/"
            title="Pantalla de la empresa" />
        </div>
      </section>

      <section class="vivo-columna">
        <div class="vivo-etiqueta">
          <b>Tienda</b>
          <select v-model="claveTienda" aria-label="Tienda">
            <option v-for="t in tiendas" :key="t.clave" :value="t.clave">{{ t.nombre }}</option>
          </select>
        </div>
        <div class="dispositivo-movil">
          <iframe
            :key="tienda.clave" ref="marcoTienda" :name="nombreDeMarco(tienda.credencial)" src="/#/"
            :title="`Pantalla de la tienda ${tienda.nombre}`" @load="alCargarTienda" />
        </div>
      </section>

      <section class="vivo-columna">
        <div class="vivo-etiqueta">
          <b>Trabajador</b>
          <select v-model="claveTrabajador" aria-label="Trabajador">
            <option v-for="t in trabajadores" :key="t.clave" :value="t.clave">{{ t.nombre }}</option>
          </select>
        </div>
        <div v-if="sinSmartphone" class="sin-telefono">
          <p class="apagado">{{ trabajador.nombre.split(' ')[0] }} no usa smartphone: paga con su tarjeta.</p>
          <TarjetaImpresa :numero="trabajador.tarjeta" :nombre="trabajador.nombre" :empresa="empresa" />
          <button class="si ancho" @click="acercarTarjeta">
            <Icono nombre="tienda" /> Acercar la tarjeta a la tienda
          </button>
          <p v-if="tarjetaAcercada" class="apagado pequeno" role="status">
            Tarjeta junto a {{ tienda.nombre }}. Cobra con «Con tarjeta».
          </p>
        </div>
        <div v-else class="dispositivo-movil">
          <iframe
            :key="trabajador.clave" ref="marcoTrabajador" :name="nombreDeMarco(trabajador.credencial)" src="/#/"
            :title="`Pantalla de ${trabajador.nombre}`" @load="alCargarTrabajador" />
        </div>
      </section>
    </main>

    <aside v-if="demo && panel" id="panel-cuentas" class="panel-cuentas" aria-label="Cuentas de prueba">
      <div class="panel-cabeza">
        <h2>Cuentas de prueba</h2>
        <button class="suave chico" aria-label="Cerrar las cuentas de prueba" @click="panel = false"><Icono nombre="x" /></button>
      </div>
      <p class="apagado pequeno">Entra con estos datos desde cualquier equipo o celular.</p>
      <CuentasDePrueba :demo="demo" compacto />
    </aside>
  </div>
</template>
