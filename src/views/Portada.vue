<script setup>
/**
 * La portada, para quien todavia no entro: el sitio del producto y el
 * acceso.
 *
 * El acceso depende del riesgo de cada uno:
 *  - la empresa, con correo y contrasena: maneja el dinero de todos;
 *  - trabajador y tienda, con su celular y un PIN de 4 numeros, que es lo
 *    que alguien que no se maneja con la tecnologia puede recordar.
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
    await ponerPerfil(await api.sesion());
    window.location.hash = '#/tres';
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

const volverADemo = () => { window.location.hash = '#/tres'; };
const PERFILES = [
  { clave: 'trabajador', nombre: 'Trabajador' },
  { clave: 'tienda', nombre: 'Tienda' },
  { clave: 'empresa', nombre: 'Empresa' },
];
</script>

<template>
  <div class="sitio">
    <header class="sitio-barra">
      <button class="sin-estilo" aria-label="StellarRail, ir al inicio" @click="ir('inicio')"><Marca /></button>
      <nav class="sitio-nav" aria-label="Cuenta">
        <button class="suave" @click="ir('entrar')">Entrar</button>
        <button class="si ocultar-movil" @click="ir('nueva')">Crear cuenta</button>
      </nav>
    </header>

    <!-- ================= SITIO ================= -->
    <main v-if="pantalla === 'inicio'">
      <section class="heroe">
        <div class="heroe-texto">
          <p class="antetitulo">Vales de alimentos · Perú</p>
          <h1>El vale de alimentos que se paga con QR en la bodega del barrio.</h1>
          <p class="heroe-bajada">
            Tu empresa entrega el vale, tus trabajadores pagan desde el celular
            o con una tarjeta, y cada bodega afiliada cobra al instante, sin POS
            y sin comisión.
          </p>
          <div class="heroe-acciones">
            <button class="si grande-cta" @click="ir('nueva')">Crear cuenta de empresa</button>
            <button class="suave grande-cta" :disabled="Boolean(trabajando)" @click="probarDemo">
              {{ trabajando === 'demo' ? 'Preparando la demostración…' : 'Probar la demostración' }}
            </button>
          </div>
          <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
          <p class="apagado pequeno">
            La demostración crea una empresa de ejemplo con sus trabajadores y
            tiendas, lista para usar.
            <button v-if="hayDemo" class="enlace-texto" @click="volverADemo">Volver a mi demostración</button>
          </p>
        </div>

        <div class="heroe-visual" aria-hidden="true">
          <div class="telefono-maqueta">
            <div class="maqueta-barra"><Marca :tamano="20" /></div>
            <p class="maqueta-saludo">Hola, María</p>
            <div class="vale">
              <span>Vale de alimentos</span>
              <b>S/ 150.00</b>
              <span>Úsalo hasta el 31/10/2026</span>
            </div>
            <div class="maqueta-boton"><Icono nombre="camara" :tamano="22" /> Pagar con QR</div>
            <div class="maqueta-boton suave"><Icono nombre="teclado" :tamano="20" /> Pagar con código</div>
          </div>
          <div class="aviso-flotante">
            <span class="apagado pequeno">Bodega Don Julio</span>
            <b>Te pagaron S/ 18.50</b>
          </div>
        </div>
      </section>

      <section class="publicos">
        <article>
          <h2>Para empresas</h2>
          <ul>
            <li>Entrega el vale a todo tu equipo en una sola operación.</li>
            <li>Decide dónde se puede usar: solo en las bodegas que afilias.</li>
            <li>Mira el gasto en vivo y, al vencer, anula el saldo no usado.</li>
          </ul>
        </article>
        <article>
          <h2>Para trabajadores</h2>
          <ul>
            <li>Paga escaneando el QR de la bodega, como con Yape.</li>
            <li>¿Sin smartphone? Paga con tu tarjeta y tu PIN.</li>
            <li>Tu saldo siempre a la vista, y lo puedes escuchar.</li>
          </ul>
        </article>
        <article>
          <h2>Para bodegas</h2>
          <ul>
            <li>Cobra con un QR impreso o con monto, sin POS.</li>
            <li>Sin comisión, y el aviso de pago llega al instante.</li>
            <li>Regístrate con tu nombre y tu celular, sin RUC.</li>
          </ul>
        </article>
      </section>

      <section class="garantias">
        <h2>Reglas que no dependen de nosotros</h2>
        <div class="garantias-lista">
          <div>
            <b>Solo en bodegas afiliadas</b>
            <p>Un pago a una tienda que la empresa no afilió lo rechaza la red de pagos, no nuestra aplicación.</p>
          </div>
          <div>
            <b>Con fecha de vencimiento</b>
            <p>Al vencer el programa, la empresa congela el vale y anula el saldo que no se usó.</p>
          </div>
          <div>
            <b>Cada pago con comprobante</b>
            <p>Todas las operaciones quedan en el registro público de Stellar y se pueden verificar.</p>
          </div>
        </div>
      </section>

      <footer class="sitio-pie">
        <Marca :tamano="22" />
        <p>
          Proyecto para Stellar Odyssey Perú. Funciona sobre la red de pruebas
          de Stellar: no se usa dinero real y la verificación de identidad es simulada.
          <a href="https://github.com/Pdelacruz123/stellar-rail" target="_blank" rel="noopener">Código fuente</a>
        </p>
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
