import type { Map as MapLibreMap, PointLike } from 'maplibre-gl';
import { CLASS_BY_CODE, type ForestClass } from './forestClasses';
import { LAYERS } from './mapStyle';
import { SOIL_BY_ID, SOIL_CLASSES, drawPattern, patternImageId, type SoilClass, type SoilId } from './soils';

/**
 * Fournit à MapLibre les motifs des natures de sol au moment où une couche les réclame
 * (évènement `styleimagemissing`) : ils sont dessinés au canevas, rien à télécharger.
 */
export function registerSoilPatterns(map: MapLibreMap): void {
  map.on('styleimagemissing', (event) => {
    const soil = SOIL_CLASSES.find((s) => patternImageId(s.id) === event.id);
    if (!soil || map.hasImage(event.id)) return;
    const canvas = drawPattern(soil.pattern, 16, 2);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    map.addImage(event.id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 });
  });
}

export interface SoilAtPoint {
  soil: SoilClass;
  description: string;
  notation: string;
}

/** Nature du sol sous un point de l'écran (null : hors zone couverte ou tuiles pas chargées). */
export function soilAt(map: MapLibreMap, point: PointLike): SoilAtPoint | null {
  if (!map.getLayer(LAYERS.geologyHit)) return null;
  for (const f of map.queryRenderedFeatures(point, { layers: [LAYERS.geologyHit] })) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const soil = SOIL_BY_ID.get(String(props['sol'] ?? '') as SoilId);
    if (soil) return { soil, description: String(props['descr'] ?? ''), notation: String(props['notation'] ?? '') };
  }
  return null;
}

export interface ForestAtPoint {
  code: string;
  id: string | null;
  cls: ForestClass | undefined;
  label: string;
  essence: string;
}

/** Type de forêt sous un point de l'écran, même s'il est masqué par la légende. */
export function forestAt(map: MapLibreMap, point: PointLike): ForestAtPoint | null {
  const [feature] = map.queryRenderedFeatures(point, { layers: [LAYERS.forestHit] });
  if (!feature) return null;
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const code = String(props['code_tfv'] ?? '');
  const cls = CLASS_BY_CODE.get(code);
  return {
    code,
    id: typeof props['id'] === 'string' ? props['id'] : null,
    cls,
    label: cls?.label ?? String(props['tfv'] ?? 'Formation végétale'),
    essence: String(props['essence'] ?? ''),
  };
}
