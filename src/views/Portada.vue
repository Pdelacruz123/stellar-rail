<script setup>
/**
 * La entrada al sitio: iniciar sesion o crear la cuenta de la empresa, como
 * en cualquier pagina con cuentas.
 *
 * El acceso depende del riesgo de cada uno:
 *  - la empresa, con correo y contrasena: maneja el dinero de todos;
 *  - trabajador y tienda, con su celular y un PIN de 4 numeros.
 *
 * Trabajadores y tiendas no se registran aqui: la empresa los invita.
 */
import { nextTick, ref } from 'vue';
import { api } from '../api.js';
import { ponerPerfil } from '../estado.js';
import Icono from '../Icono.vue';
import Marca from '../Marca.vue';
import Pin from '../Pin.vue';

// Si llego desde un QR de pago sin haber entrado, entra como trabajador.
const vieneDePagar = /^#\/cobro\//.test(window.location.hash);

const modo = ref('entrar');          // entrar | nueva
const perfil = ref('trabajador');    // trabajador | tienda | empresa
const identificador = ref('');
const secreto = ref('');
const empresaNueva = ref({ nombre: '', correo: '', contrasena: '' });
const trabajando = ref('');
const aviso = ref('');
const primerCampo = ref(null);

const PERFILES = [
  { clave: 'trabajador', nombre: 'Trabajador' },
  { clave: 'tienda', nombre: 'Tienda' },
  { clave: 'empresa', nombre: 'Empresa' },
];

async function elegirPerfil(p) {
  perfil.value = p;
  aviso.value = '';
  identificador.value = '';
  secreto.value = '';
  await nextTick();
  primerCampo.value?.focus();
}

async function cambiarModo(m) {
  modo.value = m;
  aviso.value = '';
  await nextTick();
  primerCampo.value?.focus();
}

async function entrar() {
  aviso.value = '';
  trabajando.value = 'entrar';
  try {
    await ponerPerfil(await api.entrar(identificador.value, secreto.value));
    // Si venia de un QR de pago, se queda en ese enlace: el pago sigue solo.
    if (!vieneDePagar) window.location.hash = '#/';
  } catch (e) {
    aviso.value = e.message;
    secreto.value = '';
  } finally {
    trabajando.value = '';
  }
}

async function registrarEmpresa() {
  aviso.value = '';
  trabajando.value = 'nueva';
  try {
    await ponerPerfil(await api.registrarEmpresa(empresaNueva.value));
    window.location.hash = '#/';
  } catch (e) {
    aviso.value = e.message;
  } finally {
    trabajando.value = '';
  }
}

</script>

<template>
  <div class="entrada">
    <header class="entrada-barra">
      <Marca />
    </header>

    <div class="entrada-cuerpo">
      <!-- ================= FORMULARIO ================= -->
      <main class="entrada-principal">
        <section v-if="modo === 'entrar'" class="tarjeta acceso-caja" :class="{ sencillo: perfil !== 'empresa' }">
          <h1 class="acceso-titulo">Entrar</h1>
          <p v-if="vieneDePagar" class="aviso espera">Entra con tu celular y tu PIN para pagar.</p>

          <div class="modos tres-modos" role="tablist" aria-label="Entrar como">
            <button
              v-for="p in PERFILES" :key="p.clave" role="tab"
              :aria-selected="perfil === p.clave" @click="elegirPerfil(p.clave)">
              {{ p.nombre }}
            </button>
          </div>

          <form v-if="perfil !== 'empresa'" @submit.prevent="entrar">
            <div class="campo">
              <label for="cel">Número de celular</label>
              <input
                id="cel" ref="primerCampo" v-model="identificador" class="numero-grande"
                type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="987 654 321" required>
            </div>
            <Pin v-model="secreto" id="pin-entrar" etiqueta="PIN de 4 números" />
            <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
            <button class="principal" :disabled="Boolean(trabajando) || secreto.length !== 4">
              {{ trabajando === 'entrar' ? 'Entrando…' : 'Entrar' }}
            </button>
            <p class="apagado pequeno acceso-ayuda">
              ¿Olvidaste tu PIN? Tu empresa te envía un enlace para crear uno nuevo.
              ¿No tienes cuenta? Tu empresa te invita.
            </p>
          </form>

          <form v-else @submit.prevent="entrar">
            <div class="campo">
              <label for="correo">Correo</label>
              <input id="correo" ref="primerCampo" v-model="identificador" type="email" autocomplete="username" required>
            </div>
            <div class="campo">
              <label for="clave">Contraseña</label>
              <input id="clave" v-model="secreto" type="password" autocomplete="current-password" required>
            </div>
            <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
            <button class="principal" :disabled="Boolean(trabajando)">
              {{ trabajando === 'entrar' ? 'Entrando…' : 'Entrar' }}
            </button>
          </form>

          <p class="acceso-otra">
            ¿Tu empresa aún no usa StellarRail?
            <button type="button" class="enlace-texto" @click="cambiarModo('nueva')">Crear cuenta de empresa</button>
          </p>
        </section>

        <section v-else class="tarjeta acceso-caja">
          <h1 class="acceso-titulo">Crear cuenta de empresa</h1>
          <p class="apagado">Después invitas a tus trabajadores y a las bodegas con un enlace.</p>
          <form @submit.prevent="registrarEmpresa">
            <div class="campo">
              <label for="en">Nombre de la empresa</label>
              <input id="en" ref="primerCampo" v-model="empresaNueva.nombre" autocomplete="organization" required>
            </div>
            <div class="campo">
              <label for="ec">Correo de Recursos Humanos</label>
              <input id="ec" v-model="empresaNueva.correo" type="email" autocomplete="username" required>
            </div>
            <div class="campo">
              <label for="ep">Contraseña <span class="apagado">(al menos 8 caracteres)</span></label>
              <input id="ep" v-model="empresaNueva.contrasena" type="password" autocomplete="new-password" minlength="8" required>
            </div>
            <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
            <button class="principal" :disabled="Boolean(trabajando)">{{ trabajando === 'nueva' ? 'Creando…' : 'Crear cuenta' }}</button>
          </form>
          <p class="acceso-otra">
            ¿Ya tienes cuenta?
            <button type="button" class="enlace-texto" @click="cambiarModo('entrar')">Entrar</button>
          </p>
        </section>

      </main>

      <!-- ================= QUE ES (a un lado en computadora) ================= -->
      <aside class="entrada-lateral">
        <h2 class="entrada-titulo">Vales de alimentos que se pagan con QR en la bodega.</h2>
        <p class="apagado">
          La empresa entrega el vale y el trabajador paga desde su celular:
          escanea el QR de la bodega o le dicta su código. La bodega cobra al
          instante, sin POS y sin comisión.
        </p>
        <ul class="entrada-puntos">
          <li><Icono nombre="escudo" :tamano="20" /> Solo sirve en las bodegas que la empresa afilia: la red rechaza las demás.</li>
          <li><Icono nombre="reloj" :tamano="20" /> Lo que no se usa no se pierde: al vencer, la empresa anula ese saldo y su respaldo en soles deja de estar comprometido.</li>
          <li><Icono nombre="historial" :tamano="20" /> Cada pago queda con un comprobante público en Stellar.</li>
        </ul>
        <p class="apagado pequeno entrada-legal">
          “Stellar” es una marca de la Stellar Development Foundation. StellarRail es un
          proyecto independiente, no afiliado ni respaldado por ella. Red de pruebas; la
          verificación de identidad es simulada.
          <a href="https://github.com/Pdelacruz123/stellar-rail" target="_blank" rel="noopener">Código fuente</a>
        </p>
      </aside>
    </div>
  </div>
</template>
