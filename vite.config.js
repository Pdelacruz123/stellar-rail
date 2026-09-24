import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * En desarrollo, las funciones de `api/` corren dentro del propio servidor de
 * Vite: el mismo codigo que en Vercel, sin instalar su CLI. Asi `npm run dev`
 * prueba la API que estas escribiendo, no la que esta desplegada.
 *
 * OJO: usa la base de datos y la red de verdad (Neon y Stellar Testnet), las
 * mismas que produccion. Es aceptable en testnet, pero conviene saberlo.
 */
function apiLocal() {
  return {
    name: 'rail-api-local',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();
        const nombre = req.url.slice('/api/'.length).split(/[/?#]/)[0];
        // Solo nombres simples: nada de rutas relativas colandose.
        if (!/^[a-z]+$/.test(nombre)) {
          res.statusCode = 404;
          return res.end();
        }
        try {
          // ssrLoadModule recarga el archivo cuando cambia, sin reiniciar.
          const modulo = await server.ssrLoadModule(`/api/${nombre}.js`);
          return await modulo.default(req, res);
        } catch (e) {
          if (e?.code === 'ERR_MODULE_NOT_FOUND' || /Failed to load url/.test(e?.message)) {
            res.statusCode = 404;
            return res.end();
          }
          return next(e);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Las funciones leen process.env, como en Vercel. Vite no carga .env ahi
  // por su cuenta: se hace aqui, sin pisar lo que ya este definido.
  for (const [clave, valor] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
  return {
    plugins: [vue(), apiLocal()],
  };
});
