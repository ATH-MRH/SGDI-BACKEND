import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// base '/v2/' : le bundle est servi par FastAPI sous /v2 (stratégie strangler,
// l'ancien front reste servi à la racine). En dev, proxy /api vers le backend.
const sharedSrc = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));

export default defineConfig({
  base: '/v2/',
  plugins: [vue()],
  resolve: {
    // Tableau ordonné : la règle CSS spécifique doit primer sur la règle générale
    // (sinon '@sgdi/shared/tokens.css' se résout en 'index.ts/tokens.css').
    alias: [
      { find: '@sgdi/shared/tokens.css', replacement: `${sharedSrc}/design/tokens.css` },
      { find: '@sgdi/shared', replacement: `${sharedSrc}/index.ts` },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
