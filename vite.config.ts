import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

/**
 * Écrit dans index.html, à la place de `__MAP_CHUNK__`, le fichier qui contient le code de la carte
 * (src/mapView.ts, chargé à la demande). Quand la page s'ouvre sur la carte, son en-tête demande
 * ainsi ce fichier tout de suite, en même temps que la feuille de style : la carte n'arrive pas plus
 * tard qu'avant le découpage en deux vues. En développement : chaîne vide, pas de préchargement.
 */
function mapChunkPreload(): Plugin {
  return {
    name: 'foret-explorer:map-chunk-preload',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!html.includes('__MAP_CHUNK__')) return html;
        const chunk = Object.values(ctx.bundle ?? {}).find(
          (file) => file.type === 'chunk' && file.isDynamicEntry && (file.facadeModuleId ?? '').endsWith('/src/mapView.ts'),
        );
        if (ctx.bundle && !chunk) throw new Error('Code de la carte (src/mapView.ts) introuvable dans le build');
        return html.replaceAll('__MAP_CHUNK__', chunk ? `./${chunk.fileName}` : '');
      },
    },
  };
}

export default defineConfig({
  // Chemins relatifs : le site fonctionne aussi dans un sous-dossier
  // (GitHub Pages le sert sous /foret-explorer/).
  base: './',
  plugins: [mapChunkPreload()],
  server: {
    open: true,
  },
  build: {
    // MapLibre pèse ~800 ko minifié : on évite l'avertissement « chunk > 500 ko ».
    chunkSizeWarningLimit: 1500,
    // Deux pages : la carte (avec sa vue Analytics) et « À propos » (conditions, mentions légales,
    // confidentialité).
    rollupOptions: {
      input: { carte: page('./index.html'), apropos: page('./a-propos.html') },
    },
  },
});
