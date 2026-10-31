import type { FilterSpecification, LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { ATTRIBUTION, BDFORET, TILES } from './config';
import { ALL_CODES, FALLBACK_COLOR, FOREST_CLASSES } from './forestClasses';
import type { AppState, BasemapId } from './state';

export const SOURCES = {
  planIgn: 'plan-ign',
  ortho: 'ortho',
  bdForetRaster: 'bdforet-raster',
  bdForet: 'bdforet',
} as const;

export const LAYERS = {
  basePlan: 'base-plan',
  baseOrtho: 'base-ortho',
  /** Raster officiel non filtrable, visible seulement sous le zoom 10. */
  overview: 'bdforet-overview',
  /** Polygones vectoriels colorés et filtrés par la légende. */
  fill: 'bdforet-fill',
  outline: 'bdforet-outline',
  highlightCasing: 'bdforet-highlight-casing',
  highlight: 'bdforet-highlight',
} as const;

/** Couches forêt qui suivent la sélection de la légende. */
const FILTERED_LAYERS = [LAYERS.fill, LAYERS.outline] as const;

/** Filtre qui ne correspond à aucun polygone (surbrillance vide). */
const NO_HIGHLIGHT: FilterSpecification = ['==', ['get', 'id'], '__aucun__'];

// maplibre-gl n'exporte pas ExpressionSpecification : on dérive le type de la propriété.
type FillLayer = Extract<LayerSpecification, { type: 'fill' }>;
type FillColor = NonNullable<NonNullable<FillLayer['paint']>['fill-color']>;

/** Couleur de chaque polygone selon son `code_tfv` (couleurs officielles IGN). */
export function colorExpression(): FillColor {
  const pairs = FOREST_CLASSES.flatMap((c) => [c.code, c.color]);
  return ['match', ['get', 'code_tfv'], ...pairs, FALLBACK_COLOR] as unknown as FillColor;
}

/**
 * Filtre MapLibre correspondant à la sélection.
 * `null` = tout afficher (y compris un éventuel code inconnu de la nomenclature).
 */
export function selectionFilter(selected: ReadonlySet<string>): FilterSpecification | null {
  if (ALL_CODES.every((code) => selected.has(code))) return null;
  return ['in', ['get', 'code_tfv'], ['literal', [...selected]]];
}

export function buildStyle(state: AppState): StyleSpecification {
  const filter = selectionFilter(state.selected);
  const forestFilter = filter ? { filter } : {};
  const vector = { source: SOURCES.bdForet, 'source-layer': BDFORET.sourceLayer } as const;

  return {
    version: 8,
    sources: {
      [SOURCES.planIgn]: {
        type: 'raster',
        tiles: [TILES.planIgn],
        tileSize: 256,
        maxzoom: 18,
        attribution: ATTRIBUTION.planIgn,
      },
      [SOURCES.ortho]: {
        type: 'raster',
        tiles: [TILES.ortho],
        tileSize: 256,
        maxzoom: 19,
        attribution: ATTRIBUTION.ortho,
      },
      [SOURCES.bdForetRaster]: {
        type: 'raster',
        tiles: [TILES.bdForetRaster],
        tileSize: 256,
        minzoom: BDFORET.rasterMinZoom,
        maxzoom: BDFORET.maxZoom,
        attribution: ATTRIBUTION.bdForet,
      },
      [SOURCES.bdForet]: {
        type: 'vector',
        tiles: [TILES.bdForetVector],
        minzoom: BDFORET.minZoom,
        maxzoom: BDFORET.maxZoom,
        attribution: ATTRIBUTION.bdForet,
      },
    },
    layers: [
      {
        id: LAYERS.basePlan,
        type: 'raster',
        source: SOURCES.planIgn,
        layout: { visibility: state.basemap === 'plan' ? 'visible' : 'none' },
      },
      {
        id: LAYERS.baseOrtho,
        type: 'raster',
        source: SOURCES.ortho,
        layout: { visibility: state.basemap === 'ortho' ? 'visible' : 'none' },
      },
      {
        id: LAYERS.overview,
        type: 'raster',
        source: SOURCES.bdForetRaster,
        maxzoom: BDFORET.minZoom,
        paint: { 'raster-opacity': state.opacity },
      },
      {
        id: LAYERS.fill,
        type: 'fill',
        ...vector,
        minzoom: BDFORET.minZoom,
        paint: {
          'fill-color': colorExpression(),
          'fill-opacity': state.opacity,
        },
        ...forestFilter,
      },
      {
        id: LAYERS.outline,
        type: 'line',
        ...vector,
        minzoom: 12,
        paint: {
          'line-color': '#141430',
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.15, 16, 0.45],
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 16, 1],
        },
        ...forestFilter,
      },
      {
        id: LAYERS.highlightCasing,
        type: 'line',
        ...vector,
        filter: NO_HIGHLIGHT,
        paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.9 },
      },
      {
        id: LAYERS.highlight,
        type: 'line',
        ...vector,
        filter: NO_HIGHLIGHT,
        paint: { 'line-color': '#6a6af4', 'line-width': 2.5 },
      },
    ],
  };
}

export function applySelection(map: MapLibreMap, selected: ReadonlySet<string>): void {
  const filter = selectionFilter(selected);
  for (const layer of FILTERED_LAYERS) map.setFilter(layer, filter);
}

export function applyOpacity(map: MapLibreMap, opacity: number): void {
  map.setPaintProperty(LAYERS.fill, 'fill-opacity', opacity);
  map.setPaintProperty(LAYERS.overview, 'raster-opacity', opacity);
}

export function applyBasemap(map: MapLibreMap, basemap: BasemapId): void {
  map.setLayoutProperty(LAYERS.basePlan, 'visibility', basemap === 'plan' ? 'visible' : 'none');
  map.setLayoutProperty(LAYERS.baseOrtho, 'visibility', basemap === 'ortho' ? 'visible' : 'none');
}

/** Rejoue tout l'état sur la carte (utile si l'état a changé pendant le chargement du style). */
export function applyState(map: MapLibreMap, state: AppState): void {
  applySelection(map, state.selected);
  applyOpacity(map, state.opacity);
  applyBasemap(map, state.basemap);
}

/** Entoure le polygone `id` (les morceaux répartis sur plusieurs tuiles partagent le même `id`). */
export function setHighlight(map: MapLibreMap, id: string | null): void {
  const filter: FilterSpecification = id ? ['==', ['get', 'id'], id] : NO_HIGHLIGHT;
  map.setFilter(LAYERS.highlightCasing, filter);
  map.setFilter(LAYERS.highlight, filter);
}
