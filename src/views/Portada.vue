<script setup>
/**
 * La portada, para quien todavia no entro.
 *
 * Llegan tres tipos de personas, y cada una necesita una sola cosa:
 *  - trabajadores y bodegas que ya tienen cuenta: entrar, rapido;
 *  - una empresa que evalua el producto: entender que hace y crear su cuenta;
 *  - quien quiere verlo funcionar: la demostracion.
 *
 * Por eso es corta: que es, las dos acciones, como funciona y que garantiza
 * la red. Sin cifras inventadas: la imagen es el vale, el objeto real.
 *
 * El acceso depende del riesgo de cada uno:
 *  - la empresa, con correo y contrasena: maneja el dinero de todos;
 *  - trabajador y tienda, con su celular y un PIN de 4 numeros.
 */
import { nextTick, ref } from 'vue';
import { api } from '../api.js';
import { ponerPerfil } from '../estado.js';
import { crearDemo, leerDemo } from '../demo.js';
import Icono from '../Icono.vue';
import Marca from '../Marca.vue';
import Pin from '../Pin.vue';

// Si llego desde un QR de pago sin haber entrado, va directo a entrar.
const vieneDePagar = /^#\/(pagar|cobro)\//.test(window.location.hash);

const pantalla = ref(vieneDePagar ? 'entrar' : 'inicio');   // inicio | entrar | nueva
const perfil = ref('trabajador');                            // trabajador | tienda | empresa
const identificador = ref('');
const secreto = ref('');
const empresaNueva = ref({ nombre: '', correo: '', contrasena: '' });
const trabajando = ref('');
const aviso = ref('');
const primerCampo = ref(null);
const hayDemo = Boolean(leerDemo());

async function ir(cual, conPerfil) {
  pantalla.value = cual;
  if (conPerfil) perfil.value = conPerfil;
  aviso.value = '';
  identificador.value = '';
  secreto.value = '';
  window.scrollTo(0, 0);
  await nextTick();
  primerCampo.value?.focus();
}

async function elegirPerfil(p) {
  perfil.value = p;
  aviso.value = '';
  identificador.value = '';
  secreto.value = '';
  await nextTick();
  primerCampo.value?.focus();
}

async function probarDemo() {
  trabajando.value = 'demo';
  aviso.value = '';
  try {
    await crearDemo();
    window.location.hash = '#/demo';
  } catch (e) {
    aviso.value = e.message;
  } finally {
    trabajando.value = '';
  }
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

const volverADemo = () => { window.location.hash = '#/demo'; };
const PERFILES = [
  { clave: 'trabajador', nombre: 'Trabajador' },
  { clave: 'tienda', nombre: 'Tienda' },
  { clave: 'empresa', nombre: 'Empresa' },
];
</script>

<template>
  <div class="sitio">
    <header class="sitio-barra">
      <div class="caja sitio-barra-dentro">
        <button class="sin-estilo" aria-label="StellarRail, inicio" @click="ir('inicio')"><Marca /></button>
        <button v-if="pantalla === 'inicio'" class="suave" @click="ir('entrar')">Entrar</button>
        <button v-else class="suave" @click="ir('inicio')"><Icono nombre="atras" :tamano="18" /> Inicio</button>
      </div>
    </header>

    <!-- ================= INICIO ================= -->
    <main v-if="pantalla === 'inicio'">
      <section class="caja heroe">
        <div class="heroe-texto">
          <h1>Vales de alimentos que se pagan con QR en la bodega.</h1>
          <p class="heroe-bajada">
            La empresa entrega el vale, el trabajador paga desde su celular o
            con una tarjeta, y la bodega cobra al instante, sin POS y sin comisión.
          </p>
          <div class="heroe-acciones">
            <button class="destacado" :disabled="Boolean(trabajando)" @click="probarDemo">
              {{ trabajando === 'demo' ? 'Preparando la demostración…' : 'Probar la demostración' }}
            </button>
            <button class="suave grande" @click="ir('nueva')">Crear cuenta de empresa</button>
          </div>
          <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
          <p class="apagado pequeno">
            La demostración crea una empresa de ejemplo con sus trabajadores y
            bodegas. Funciona en la red de pruebas de Stellar: no se usa dinero real.
            <button v-if="hayDemo" class="enlace-texto" @click="volverADemo">Ver mis cuentas de prueba</button>
          </p>
        </div>

        <!-- La imagen es el producto: el vale del trabajador y el aviso que recibe la bodega. -->
        <div class="heroe-visual" aria-hidden="true">
          <div class="vale">
            <img class="vale-logo" src="/logo.svg" alt="">
            <span>Vale de alimentos</span>
            <b>S/ 150.00</b>
            <span>Úsalo hasta el 31/10</span>
          </div>
          <div class="aviso-ejemplo">
            <span class="aviso-ejemplo-icono"><Icono nombre="check" :tamano="20" /></span>
            <span><small>Bodega Don Julio</small><b>Te pagaron S/ 12.50</b></span>
          </div>
        </div>
      </section>

      <section class="caja bloque-sitio">
        <h2 class="titulo-sitio">Cómo funciona</h2>
        <div class="tres-col">
          <article class="paso">
            <span class="paso-icono"><Icono nombre="empresa" /></span>
            <h3>La empresa entrega el vale</h3>
            <p>Aprueba a su equipo y a las bodegas del barrio, y entrega el vale a todos en una sola operación.</p>
          </article>
          <article class="paso">
            <span class="paso-icono"><Icono nombre="qr" /></span>
            <h3>El trabajador paga</h3>
            <p>Escanea el QR de la bodega desde su celular. Si no tiene smartphone, usa su tarjeta y su PIN.</p>
          </article>
          <article class="paso">
            <span class="paso-icono"><Icono nombre="tienda" /></span>
            <h3>La bodega cobra</h3>
            <p>Recibe el pago en segundos y el celular se lo dice en voz alta. Sin POS y sin comisión.</p>
          </article>
        </div>
      </section>

      <section class="caja bloque-sitio">
        <h2 class="titulo-sitio">Reglas que hace cumplir la red</h2>
        <div class="tres-col">
          <div class="garantia">
            <Icono nombre="escudo" />
            <div>
              <b>Solo en bodegas afiliadas</b>
              <p>Un pago a una tienda que la empresa no afilió lo rechaza la red de pagos, no nuestra aplicación.</p>
            </div>
          </div>
          <div class="garantia">
            <Icono nombre="reloj" />
            <div>
              <b>Con fecha de vencimiento</b>
              <p>Al vencer el programa, la empresa congela el vale y anula el saldo que no se usó.</p>
            </div>
          </div>
          <div class="garantia">
            <Icono nombre="historial" />
            <div>
              <b>Cada pago con comprobante</b>
              <p>Todas las operaciones quedan en el registro público de Stellar y se pueden verificar.</p>
            </div>
          </div>
        </div>
      </section>

      <footer class="pie-sitio">
        <div class="caja">
          <Marca :tamano="24" />
          <p>
            “Stellar” es una marca de la Stellar Development Foundation. StellarRail es un
            proyecto independiente, no afiliado ni respaldado por la Stellar Development
            Foundation. Funciona en la red de pruebas; la verificación de identidad es simulada.
            <a href="https://github.com/Pdelacruz123/stellar-rail" target="_blank" rel="noopener">Código fuente</a>
          </p>
        </div>
      </footer>
    </main>

    <!-- ================= ENTRAR ================= -->
    <main v-else-if="pantalla === 'entrar'" class="acceso">
      <section class="tarjeta acceso-caja" :class="{ sencillo: perfil !== 'empresa' }">
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
          <button class="principal" :disabled="Boolean(trabajando)">{{ trabajando === 'entrar' ? 'Entrando…' : 'Entrar' }}</button>
          <p class="apagado pequeno acceso-ayuda">
            ¿Tu empresa aún no tiene cuenta? <button type="button" class="enlace-texto" @click="ir('nueva')">Crear cuenta</button>
          </p>
        </form>
      </section>
    </main>

    <!-- ================= EMPRESA NUEVA ================= -->
    <main v-else class="acceso">
      <section class="tarjeta acceso-caja">
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
          <p class="apagado pequeno acceso-ayuda">
            ¿Ya tienes cuenta? <button type="button" class="enlace-texto" @click="ir('entrar', 'empresa')">Entrar</button>
          </p>
        </form>
      </section>
    </main>
  </div>
</template>
