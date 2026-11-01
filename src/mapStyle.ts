import type { FilterSpecification, LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import {
  ATTRIBUTION,
  BDFORET,
  GEOLOGY,
  GEOLOGY_TILES_BASE,
  GLYPHS_URL,
  LABEL_FONT,
  FINE_MIN_ZOOM,
  TILES,
  WEATHER_MIN_ZOOM,
} from './config';
import { ALL_CODES, FALLBACK_COLOR, FOREST_CLASSES } from './forestClasses';
import { SOIL_CLASSES, patternImageId } from './soils';
import type { AppState, BasemapId } from './state';

export const SOURCES = {
  planIgn: 'plan-ign',
  ortho: 'ortho',
  bdForetRaster: 'bdforet-raster',
  bdForet: 'bdforet',
  geologie: 'geologie',
  meteo: 'meteo',
  meteoFine: 'meteo-fin',
} as const;

export const LAYERS = {
  basePlan: 'base-plan',
  baseOrtho: 'base-ortho',
  /** Raster officiel non filtrable, visible seulement sous le zoom 10. */
  overview: 'bdforet-overview',
  /** Polygones vectoriels colorés et filtrés par la légende. */
  fill: 'bdforet-fill',
  /** Copie invisible et non filtrée : sert à savoir quelle forêt se trouve sous un clic. */
  forestHit: 'bdforet-hit',
  /** Nature du sol : motifs par-dessus les forêts. */
  geology: 'geologie-motifs',
  /** Copie invisible de la géologie, toujours chargée, pour le bilan d'un coin. */
  geologyHit: 'geologie-hit',
  outline: 'bdforet-outline',
  meteoFill: 'meteo-cellules',
  meteoLine: 'meteo-contours',
  /** Grille fine de l'indice (carrés de 500 m, zoom 13 et plus). */
  meteoFineFill: 'meteo-fin-cellules',
  meteoFineLine: 'meteo-fin-contours',
  meteoLabel: 'meteo-etiquettes',
  meteoFineLabel: 'meteo-fin-etiquettes',
  highlightCasing: 'bdforet-highlight-casing',
  highlight: 'bdforet-highlight',
} as const;

/** Couches forêt qui suivent la sélection de la légende. */
const FILTERED_LAYERS = [LAYERS.fill, LAYERS.outline] as const;
const METEO_LAYERS = [LAYERS.meteoFill, LAYERS.meteoLine, LAYERS.meteoLabel] as const;
const FINE_LAYERS = [LAYERS.meteoFineFill, LAYERS.meteoFineLine, LAYERS.meteoFineLabel] as const;

/** Filtre qui ne correspond à aucun polygone (surbrillance vide). */
const NO_HIGHLIGHT: FilterSpecification = ['==', ['get', 'id'], '__aucun__'];

// maplibre-gl n'exporte pas ExpressionSpecification : on dérive le type de la propriété.
type FillLayer = Extract<LayerSpecification, { type: 'fill' }>;
type FillColor = NonNullable<NonNullable<FillLayer['paint']>['fill-color']>;
type FillPattern = NonNullable<NonNullable<FillLayer['paint']>['fill-pattern']>;

/** Couleur de chaque polygone selon son `code_tfv` (couleurs officielles IGN). */
export function colorExpression(): FillColor {
  const pairs = FOREST_CLASSES.flatMap((c) => [c.code, c.color]);
  return ['match', ['get', 'code_tfv'], ...pairs, FALLBACK_COLOR] as unknown as FillColor;
}

/** Motif de chaque formation géologique selon sa nature de sol (images ajoutées par geology.ts). */
function patternExpression(): FillPattern {
  const pairs = SOIL_CLASSES.flatMap((s) => [s.id, patternImageId(s.id)]);
  return ['match', ['get', 'sol'], ...pairs, patternImageId('eboulis')] as unknown as FillPattern;
}

/**
 * Filtre MapLibre correspondant à la sélection.
 * `null` = tout afficher (y compris un éventuel code inconnu de la nomenclature).
 */
export function selectionFilter(selected: ReadonlySet<string>): FilterSpecification | null {
  if (ALL_CODES.every((code) => selected.has(code))) return null;
  return ['in', ['get', 'code_tfv'], ['literal', [...selected]]];
}

const visibility = (on: boolean): 'visible' | 'none' => (on ? 'visible' : 'none');

export function buildStyle(state: AppState): StyleSpecification {
  const filter = selectionFilter(state.selected);
  const forestFilter = filter ? { filter } : {};
  const vector = { source: SOURCES.bdForet, 'source-layer': BDFORET.sourceLayer } as const;
  const geology = { source: SOURCES.geologie, 'source-layer': GEOLOGY.sourceLayer } as const;
  const meteoOn = state.weatherMode !== 'off';

  return {
    version: 8,
    glyphs: GLYPHS_URL,
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
      [SOURCES.geologie]: {
        type: 'vector',
        tiles: [`${GEOLOGY_TILES_BASE}{z}/{x}/{y}.pbf`],
        minzoom: GEOLOGY.minZoom,
        maxzoom: GEOLOGY.maxZoom,
        bounds: GEOLOGY.bounds,
        attribution: ATTRIBUTION.geologie,
      },
      [SOURCES.meteo]: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        attribution: ATTRIBUTION.meteo,
      },
      [SOURCES.meteoFine]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: LAYERS.basePlan, type: 'raster', source: SOURCES.planIgn, layout: { visibility: visibility(state.basemap === 'plan') } },
      { id: LAYERS.baseOrtho, type: 'raster', source: SOURCES.ortho, layout: { visibility: visibility(state.basemap === 'ortho') } },
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
        paint: { 'fill-color': colorExpression(), 'fill-opacity': state.opacity },
        ...forestFilter,
      },
      { id: LAYERS.forestHit, type: 'fill', ...vector, minzoom: BDFORET.minZoom, paint: { 'fill-opacity': 0 } },
      {
        id: LAYERS.geology,
        type: 'fill',
        ...geology,
        minzoom: GEOLOGY.minZoom,
        layout: { visibility: visibility(state.geology) },
        paint: { 'fill-pattern': patternExpression(), 'fill-opacity': 0.85 },
      },
      { id: LAYERS.geologyHit, type: 'fill', ...geology, minzoom: BDFORET.minZoom, paint: { 'fill-opacity': 0 } },
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
        id: LAYERS.meteoFill,
        type: 'fill',
        source: SOURCES.meteo,
        minzoom: WEATHER_MIN_ZOOM,
        layout: { visibility: visibility(meteoOn) },
        paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0.45 },
      },
      {
        id: LAYERS.meteoLine,
        type: 'line',
        source: SOURCES.meteo,
        minzoom: WEATHER_MIN_ZOOM,
        layout: { visibility: visibility(meteoOn) },
        paint: { 'line-color': '#161630', 'line-opacity': 0.25, 'line-width': 0.6 },
      },
      {
        id: LAYERS.meteoFineFill,
        type: 'fill',
        source: SOURCES.meteoFine,
        minzoom: FINE_MIN_ZOOM,
        layout: { visibility: 'none' },
        paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0.5 },
      },
      {
        id: LAYERS.meteoFineLine,
        type: 'line',
        source: SOURCES.meteoFine,
        minzoom: FINE_MIN_ZOOM,
        layout: { visibility: 'none' },
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.75,
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 16, 1.4],
        },
      },
      {
        id: LAYERS.meteoLabel,
        type: 'symbol',
        source: SOURCES.meteo,
        minzoom: 9.5,
        layout: {
          visibility: visibility(meteoOn),
          'text-field': '',
          'text-font': [LABEL_FONT],
          'text-size': 12,
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#0b1f44', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4 },
      },
      {
        id: LAYERS.meteoFineLabel,
        type: 'symbol',
        source: SOURCES.meteoFine,
        minzoom: 14.5,
        layout: {
          visibility: 'none',
          'text-field': '',
          'text-font': [LABEL_FONT],
          'text-size': 11,
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#0b1f44', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.2 },
      },
      { id: LAYERS.highlightCasing, type: 'line', ...vector, filter: NO_HIGHLIGHT, paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.9 } },
      { id: LAYERS.highlight, type: 'line', ...vector, filter: NO_HIGHLIGHT, paint: { 'line-color': '#6a6af4', 'line-width': 2.5 } },
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
  map.setLayoutProperty(LAYERS.basePlan, 'visibility', visibility(basemap === 'plan'));
  map.setLayoutProperty(LAYERS.baseOrtho, 'visibility', visibility(basemap === 'ortho'));
}

export function applyGeology(map: MapLibreMap, on: boolean): void {
  map.setLayoutProperty(LAYERS.geology, 'visibility', visibility(on));
}

export function setMeteoVisible(map: MapLibreMap, on: boolean): void {
  for (const layer of METEO_LAYERS) map.setLayoutProperty(layer, 'visibility', visibility(on));
}

export function setFineVisible(map: MapLibreMap, on: boolean): void {
  for (const layer of FINE_LAYERS) map.setLayoutProperty(layer, 'visibility', visibility(on));
}

/** Rejoue tout l'état sur la carte (utile si l'état a changé pendant le chargement du style). */
export function applyState(map: MapLibreMap, state: AppState): void {
  applySelection(map, state.selected);
  applyOpacity(map, state.opacity);
  applyBasemap(map, state.basemap);
  applyGeology(map, state.geology);
}

/** Entoure le polygone `id` (les morceaux répartis sur plusieurs tuiles partagent le même `id`). */
export function setHighlight(map: MapLibreMap, id: string | null): void {
  const filter: FilterSpecification = id ? ['==', ['get', 'id'], id] : NO_HIGHLIGHT;
  map.setFilter(LAYERS.highlightCasing, filter);
  map.setFilter(LAYERS.highlight, filter);
}
