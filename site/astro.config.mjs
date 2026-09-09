// @ts-check
import { defineConfig } from 'astro/config';

// Le site est publié sur GitHub Pages sous /tete-de-moule. On garde le même
// chemin de base en développement pour que dev et prod se comportent pareil.
export default defineConfig({
  site: 'https://mde-pach.github.io',
  base: '/tete-de-moule',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  vite: {
    build: {
      // verovio embarque son wasm en base64 : gros fichier, mais chargé à la demande
      chunkSizeWarningLimit: 12000,
    },
  },
});
