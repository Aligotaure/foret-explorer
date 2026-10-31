import type { Map as MapLibreMap } from 'maplibre-gl';
import { BDFORET } from './config';
import { SOURCES } from './mapStyle';

/**
 * Nombre de polygones par `code_tfv` dans les tuiles vectorielles affichées.
 *
 * Approximation de « la zone visible » : les tuiles débordent un peu de l'écran.
 * Un polygone découpé sur plusieurs tuiles n'est compté qu'une fois (champ `id`).
 * Renvoie `null` sous le zoom des tuiles vectorielles (pas de données).
 */
export function countClasses(map: MapLibreMap): Map<string, number> | null {
  if (map.getZoom() < BDFORET.minZoom) return null;

  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const features = map.querySourceFeatures(SOURCES.bdForet, { sourceLayer: BDFORET.sourceLayer });

  for (const feature of features) {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const code = props['code_tfv'];
    if (typeof code !== 'string') continue;
    const id = props['id'] ?? props['fid'] ?? feature.id;
    if (id !== undefined && id !== null) {
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}
