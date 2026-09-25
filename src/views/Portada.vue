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
import { computed, nextTick, ref } from 'vue';
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

// Calculadora del programa: solo multiplica, no guarda nada.
const personas = ref(40);
const montoMes = ref(300);
const miles = (n) => new Intl.NumberFormat('es-PE').format(n).replace(/,/g, ' ');
const totalMes = computed(() => miles(personas.value * montoMes.value));

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
  <!-- ================= SITIO ================= -->
  <div v-if="pantalla === 'inicio'" class="sitio">
    <header class="heroe">
      <div class="caja">
        <div class="cab">
          <button class="sin-estilo" aria-label="StellarRail, inicio" @click="ir('inicio')"><Marca /></button>
          <button class="btn-contorno" @click="ir('entrar')">Entrar</button>
          <button class="btn-oro ocultar-movil" @click="ir('nueva')">Crear cuenta</button>
        </div>

        <div class="heroe-dentro">
          <div>
            <div class="pastilla"><b>Nuevo</b>Cobro por QR en bodegas afiliadas</div>
            <h1>El vale de alimentos que se cobra en la bodega <span>del barrio.</span></h1>
            <p class="lead">
              La empresa entrega el vale, el trabajador paga desde su celular o
              con una tarjeta impresa, y la bodega recibe el pago en segundos.
            </p>
            <div class="heroe-acciones">
              <button class="btn-oro" :disabled="Boolean(trabajando)" @click="probarDemo">
                {{ trabajando === 'demo' ? 'Preparando la demostración…' : 'Probar la demostración' }}
                <Icono v-if="trabajando !== 'demo'" nombre="flecha" :tamano="20" />
              </button>
              <button class="btn-contorno" @click="ir('nueva')">
                <Icono nombre="empresa" :tamano="20" /> Crear cuenta de empresa
              </button>
            </div>
            <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>
            <p class="heroe-nota">
              <Icono nombre="escudo" :tamano="18" /> Si la tienda no está afiliada, la red rechaza el pago.
            </p>
            <p v-if="hayDemo" class="heroe-nota">
              <button class="enlace-texto enlace-claro" @click="volverADemo">Volver a mi demostración</button>
            </p>
          </div>

          <div class="escena" aria-hidden="true">
            <div class="tablero">
              <div class="barra"><i /><i /><i /></div>
              <div class="cuerpo">
                <div class="lat"><span class="act" /><span /><span /><span /><span /></div>
                <div class="cont">
                  <div class="t">Vale de alimentos · octubre</div>
                  <div class="kp">
                    <div class="oro"><small>Gastado</small><b>S/ 7 842</b></div>
                    <div><small>Compras hoy</small><b>63</b></div>
                    <div><small>Bodegas</small><b>12</b></div>
                  </div>
                  <div class="graf">
                    <i style="height:38%" /><i style="height:52%" /><i style="height:44%" /><i style="height:70%" />
                    <i style="height:58%" /><i style="height:81%" /><i style="height:64%" /><i class="hoy" style="height:92%" />
                  </div>
                </div>
              </div>
            </div>
            <div class="fono">
              <div class="pant">
                <div class="hola">Hola, María<small>Textiles Andinos</small></div>
                <div class="vale">
                  <span>Vale de alimentos</span>
                  <b>S/ 184.50</b>
                  <span>Úsalo hasta el 31/10</span>
                </div>
                <div class="pagar"><Icono nombre="qr" :tamano="20" /> Pagar con QR</div>
                <div class="sec"><Icono nombre="teclado" :tamano="20" /> Escribir el código</div>
                <div class="mov">
                  <div><span>Bodega Don Julio<small>Hoy, 12:41</small></span><b>S/ 12.00</b></div>
                  <div><span>Panadería Santa Rosa<small>Hoy, 12:15</small></span><b>S/ 5.40</b></div>
                </div>
              </div>
            </div>
            <div class="aviso-pago">
              <span class="ic"><Icono nombre="check" :tamano="20" /></span>
              <div><small>Bodega Don Julio</small><b>Te pagaron</b></div>
              <span class="m">S/ 12.00</span>
            </div>
          </div>
        </div>

        <div class="construido">
          Construido sobre <b>Stellar</b> · funciona en su red de pruebas, sin dinero real.
        </div>
      </div>
    </header>

    <section class="seccion">
      <div class="caja">
        <div class="cab-sec">
          <h2>Una red, tres pantallas.</h2>
          <p class="lead">
            Cada persona ve solo lo que necesita: RR. HH. gestiona desde la
            computadora, el trabajador paga con un botón y la bodega cobra de pie en la caja.
          </p>
        </div>
        <div class="perfiles">
          <article class="perfil empresa">
            <span class="quien"><Icono nombre="empresa" :tamano="16" /> Empresa</span>
            <h3>Controla el gasto en vivo</h3>
            <p>Crea el programa, entrega el vale a todo el equipo y ve cada compra en el momento en que ocurre.</p>
            <div class="vista">
              <div class="mini-fila"><span>Gastado</span><b>S/ 7 842</b></div>
              <div class="barra-p"><i /></div>
              <div class="mini-fila" style="margin-top:8px"><span>Personas activas</span><b>34 de 40</b></div>
              <div class="mini-fila"><span>Vence</span><b>31 oct.</b></div>
            </div>
          </article>
          <article class="perfil trabajador">
            <span class="quien"><Icono nombre="celular" :tamano="16" /> Trabajador</span>
            <h3>Paga con un botón</h3>
            <p>Escanea el QR de la bodega o entrega su tarjeta impresa y marca su PIN. Sin instalar nada.</p>
            <div class="vista">
              <div style="font-size:13px;color:#A7A9B0">Tu vale de alimentos</div>
              <div style="font-size:30px;font-weight:700;letter-spacing:-.04em">S/ 184.50</div>
              <div style="margin-top:12px;height:44px;border-radius:10px;background:#FDDA24;color:#0F0F0F;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700">
                <Icono nombre="qr" :tamano="20" /> Pagar con QR
              </div>
            </div>
          </article>
          <article class="perfil bodega">
            <span class="quien"><Icono nombre="tienda" :tamano="16" /> Bodega</span>
            <h3>Cobra desde el celular</h3>
            <p>Muestra su QR y el celular avisa en voz alta cuando entra el pago. Sin POS y sin comisión.</p>
            <div class="vista" style="display:flex;gap:14px;align-items:center">
              <Icono nombre="qr" :tamano="56" />
              <div>
                <div style="font-size:13px;color:#555861">Muestra este código</div>
                <div style="font-weight:700;font-size:18px;letter-spacing:-.02em">Bodega Don Julio</div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="franja-oro">
      <div class="caja franja-oro-dentro">
        <div>
          <h2>El vale se gasta solo donde debe.</h2>
          <p class="lead">
            Solo funciona en las bodegas que la empresa afilia, y en lo que cubre
            el programa. Lo que no se usa al vencer se anula: deja de existir.
          </p>
          <div class="hechos">
            <div><b>1 = S/ 1</b><span>Cada unidad del vale vale un sol.</span></div>
            <div><b>~5 s</b><span>Lo que tarda en confirmarse un pago.</span></div>
            <div><b>10 min</b><span>Vigencia de cada cobro por QR.</span></div>
          </div>
        </div>
        <div class="calc">
          <h3>Calcula tu programa</h3>
          <label for="c-personas">Trabajadores</label>
          <div class="campo-rango">
            <input id="c-personas" v-model.number="personas" type="range" min="5" max="500" step="5">
            <output for="c-personas">{{ personas }}</output>
          </div>
          <label for="c-monto">Monto mensual por persona</label>
          <div class="campo-rango">
            <input id="c-monto" v-model.number="montoMes" type="range" min="50" max="800" step="10">
            <output for="c-monto">S/ {{ montoMes }}</output>
          </div>
          <div class="total"><small>Total a entregar al mes</small><b>S/ {{ totalMes }}</b></div>
          <button class="btn-oro" @click="ir('nueva')">Crear cuenta de empresa</button>
        </div>
      </div>
    </section>

    <section class="seccion seccion-negra">
      <div class="caja">
        <div class="cab-sec">
          <h2>Reglas que no dependen de nosotros.</h2>
          <p class="lead">Cada pago pasa por la red Stellar, que aplica las reglas y deja un comprobante público.</p>
        </div>
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
        <div class="heroe-acciones" style="margin-top:36px">
          <button class="btn-oro" :disabled="Boolean(trabajando)" @click="probarDemo">
            {{ trabajando === 'demo' ? 'Preparando la demostración…' : 'Míralo funcionar en vivo' }}
            <Icono v-if="trabajando !== 'demo'" nombre="flecha" :tamano="20" />
          </button>
        </div>
      </div>
    </section>

    <footer class="pie-sitio">
      <div class="caja">
        <Marca :tamano="26" />
        <p>
          “Stellar” es una marca de la Stellar Development Foundation. StellarRail es un
          proyecto independiente, no afiliado, patrocinado ni respaldado por la Stellar
          Development Foundation. Funciona en la red de pruebas; la verificación de
          identidad es simulada.
          <a href="https://github.com/Pdelacruz123/stellar-rail" target="_blank" rel="noopener">Código fuente</a>
        </p>
      </div>
    </footer>
  </div>

  <!-- ================= ENTRAR Y CREAR CUENTA ================= -->
  <div v-else class="acceso-fondo">
    <div class="caja">
      <div class="cab">
        <button class="sin-estilo" aria-label="StellarRail, volver al inicio" @click="ir('inicio')"><Marca /></button>
      </div>
    </div>

    <main v-if="pantalla === 'entrar'" class="acceso">
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
