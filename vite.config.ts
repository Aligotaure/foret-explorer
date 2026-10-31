import { defineConfig } from 'vite';

export default defineConfig({
  // Chemins relatifs : le site fonctionne aussi dans un sous-dossier
  // (GitHub Pages le sert sous /foret-explorer/).
  base: './',
  server: {
    open: true,
  },
  build: {
    // MapLibre pèse ~800 ko minifié : on évite l'avertissement « chunk > 500 ko ».
    chunkSizeWarningLimit: 1500,
  },
});
