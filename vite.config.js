import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * Durante el desarrollo, `npm run dev` sirve la interfaz pero NO las
 * funciones de `api/`: esas solo existen en Vercel. Para no obligar a
 * instalar la CLI de Vercel, las peticiones a /api se reenvian al
 * despliegue publico.
 *
 * OJO: eso significa que trabajando en local se toca la base de datos y la
 * red de verdad. Es aceptable en testnet y para una demo, pero conviene
 * saberlo.
 */
const API = process.env.API_REMOTA ?? 'https://stellar-rail.vercel.app';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyRes', (res) => {
            // La cookie viene con `Secure` desde Vercel. Algunos navegadores
            // la rechazan sobre http://localhost, asi que en desarrollo se
            // quita. En produccion nadie pasa por aqui.
            const galletas = res.headers['set-cookie'];
            if (galletas) {
              res.headers['set-cookie'] = galletas.map((c) => c.replace(/;\s*Secure/gi, ''));
            }
          });
        },
      },
    },
  },
});
