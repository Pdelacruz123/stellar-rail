<script setup>
/**
 * La demostracion recien creada: quien es quien, con su celular y su PIN a
 * la vista, y dos maneras de recorrerla:
 *  - las tres pantallas lado a lado, en esta misma computadora;
 *  - entrar como cada persona, con su celular y su PIN, como en la vida real.
 */
import { ref } from 'vue';
import { api } from '../api.js';
import { ponerPerfil } from '../estado.js';
import { leerDemo } from '../demo.js';
import Icono from '../Icono.vue';

const demo = leerDemo();
const trabajando = ref('');
const aviso = ref('');

/** 987654321 -> "987 654 321" */
const celular = (c) => String(c).replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');

const ROLES = { beneficiario: 'Trabajador', comercio: 'Tienda' };

async function entrarComo(identificador, secreto, clave) {
  trabajando.value = clave;
  aviso.value = '';
  try {
    await ponerPerfil(await api.entrar(identificador, secreto));
    window.location.hash = '#/';
  } catch (e) {
    aviso.value = e.message;
  } finally {
    trabajando.value = '';
  }
}

const irA = (ruta) => { window.location.hash = ruta; };
</script>

<template>
  <section v-if="!demo" class="tarjeta">
    <h2>No hay una demostración en este navegador</h2>
    <p>Créala desde la portada: tarda unos segundos.</p>
    <button class="principal" @click="irA('#/')">Ir a la portada</button>
  </section>

  <template v-else>
    <section class="tarjeta">
      <h2>{{ demo.empresa.nombre }}</h2>
      <p>
        Se crearon cinco cuentas en la red de pruebas, en una sola transacción.
        Todas empiezan <b>pendientes</b>: tú haces la verificación.
      </p>
      <button class="principal" @click="irA('#/tres')">
        <Icono nombre="qr" :tamano="26" /> Abrir las tres pantallas lado a lado
      </button>
      <p class="apagado pequeno">
        Empresa, tienda y trabajador, cada uno con su propia sesión, en esta
        computadora. No hace falta un celular.
      </p>
      <p v-if="demo.transaccion?.explorador" class="apagado pequeno">
        <a :href="demo.transaccion.explorador" target="_blank" rel="noopener">Ver la transacción que creó las cuentas</a>
      </p>
    </section>

    <section class="tarjeta">
      <h2>El recorrido</h2>
      <ol class="recorrido">
        <li><b>Empresa:</b> aprueba a María, a Rosa, a Bodega Don Julio y a Electro Hogar. <b>No</b> afilies a Minimarket La Esquina.</li>
        <li><b>Empresa:</b> crea el programa y entrega el vale.</li>
        <li><b>Tienda (Don Julio):</b> escribe un monto y muestra el QR. <b>Trabajador (María):</b> escanéalo y paga.</li>
        <li><b>María</b> intenta pagar en La Esquina con su código: <b>la red rechaza el pago</b>.</li>
        <li><b>María</b> intenta pagar en Electro Hogar: el programa de alimentos no cubre electrodomésticos.</li>
        <li><b>Rosa</b>, sin smartphone, paga en Don Julio con su tarjeta y su PIN.</li>
        <li><b>Empresa:</b> vence el programa: el saldo que quedó se congela y se anula.</li>
      </ol>
    </section>

    <section class="tarjeta">
      <h2>Quién es quién</h2>
      <p v-if="aviso" class="aviso no" role="alert">{{ aviso }}</p>

      <div class="persona">
        <div>
          <div class="nombre">{{ demo.empresa.nombre }}</div>
          <div class="apagado pequeno">Empresa · entra con correo y contraseña</div>
          <dl class="datos">
            <dt>Correo</dt><dd><code>{{ demo.empresa.correo }}</code></dd>
            <dt>Contraseña</dt><dd><code>{{ demo.empresa.contrasena }}</code></dd>
          </dl>
        </div>
        <button class="suave" :disabled="Boolean(trabajando)"
                @click="entrarComo(demo.empresa.correo, demo.empresa.contrasena, 'empresa')">
          {{ trabajando === 'empresa' ? 'Entrando…' : 'Entrar como la empresa' }}
        </button>
      </div>

      <div v-for="p in demo.personas" :key="p.clave" class="persona">
        <div>
          <div class="nombre">{{ p.nombre }}</div>
          <div class="apagado pequeno">{{ ROLES[p.rol] }} · {{ p.nota }}</div>
          <dl class="datos">
            <dt>Celular</dt><dd><code>{{ celular(p.celular) }}</code></dd>
            <dt>PIN</dt><dd><code>{{ p.pin }}</code></dd>
            <template v-if="p.tarjeta"><dt>Tarjeta</dt><dd><code>{{ p.tarjeta }}</code></dd></template>
          </dl>
        </div>
        <button class="suave" :disabled="Boolean(trabajando)" @click="entrarComo(p.celular, p.pin, p.clave)">
          {{ trabajando === p.clave ? 'Entrando…' : `Entrar como ${p.rol === 'comercio' ? 'la tienda' : p.nombre.split(' ')[0]}` }}
        </button>
      </div>
      <p class="apagado pequeno" style="margin-top:12px">
        Son cuentas de prueba creadas para ti. Entrar como otra persona cierra
        la sesión actual de este navegador; vuelve a esta página desde la portada.
      </p>
    </section>
  </template>
</template>
