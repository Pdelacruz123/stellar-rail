<script setup>
/**
 * Las cuentas de prueba: quien es quien, con sus datos de acceso. "Usar"
 * rellena el formulario para entrar con esa cuenta; no entra por su cuenta.
 */
defineProps({ demo: { type: Object, required: true } });
const emit = defineEmits(['usar']);

/** 987654321 -> "987 654 321" */
const celular = (c) => String(c).replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
const PERFIL = { beneficiario: 'trabajador', comercio: 'tienda' };
</script>

<template>
  <div class="cuentas">
    <div class="cuenta">
      <div class="cuenta-cabeza">
        <div>
          <div class="nombre">{{ demo.empresa.nombre.replace(' (demostración)', '') }}</div>
          <div class="apagado pequeno">Empresa · Recursos Humanos</div>
        </div>
        <button class="suave chico"
                @click="emit('usar', { perfil: 'empresa', identificador: demo.empresa.correo, secreto: demo.empresa.contrasena })">
          Usar
        </button>
      </div>
      <dl class="datos">
        <dt>Correo</dt><dd><code>{{ demo.empresa.correo }}</code></dd>
        <dt>Contraseña</dt><dd><code>{{ demo.empresa.contrasena }}</code></dd>
      </dl>
    </div>

    <div v-for="p in demo.personas" :key="p.clave" class="cuenta">
      <div class="cuenta-cabeza">
        <div>
          <div class="nombre">{{ p.nombre }}</div>
          <div class="apagado pequeno">{{ p.perfil ?? (p.rol === 'comercio' ? 'Tienda' : 'Trabajador') }}</div>
        </div>
        <button class="suave chico"
                @click="emit('usar', { perfil: PERFIL[p.rol], identificador: p.celular, secreto: p.pin })">
          Usar
        </button>
      </div>
      <dl class="datos">
        <dt>Celular</dt><dd><code>{{ celular(p.celular) }}</code></dd>
        <dt>PIN</dt><dd><code>{{ p.pin }}</code></dd>
      </dl>
    </div>
  </div>
</template>
