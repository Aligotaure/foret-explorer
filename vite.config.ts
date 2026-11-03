import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

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
    // Deux pages : la carte et « À propos » (conditions, mentions légales, confidentialité).
    rollupOptions: {
      input: { carte: page('./index.html'), apropos: page('./a-propos.html') },
    },
  },
});
