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
  ZONES,
  ZONES_BASE,
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
  zones: 'zones',
} as const;

/** Hachures des zones protégées (image dessinée par zones.ts à la demande de MapLibre). */
export const ZONE_PATTERN = 'zone-hachures';

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
  /** Zones protégées (hachures, contour, nom) et forêts publiques (tirets), plus leurs copies invisibles. */
  protectedFill: 'zones-protegees',
  publicForestLine: 'forets-publiques',
  protectedHit: 'zones-protegees-hit',
  publicForestHit: 'forets-publiques-hit',
  protectedLine: 'zones-protegees-contours',
  protectedLabel: 'zones-protegees-etiquettes',
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
  const zone = (layer: string) => ({ source: SOURCES.zones, 'source-layer': layer }) as const;
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
      [SOURCES.zones]: {
        type: 'vector',
        tiles: [`${ZONES_BASE}{z}/{x}/{y}.pbf`],
        minzoom: ZONES.minZoom,
        maxzoom: ZONES.maxZoom,
        bounds: ZONES.bounds,
        attribution: ATTRIBUTION.zones,
      },
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
        id: LAYERS.protectedFill,
        type: 'fill',
        ...zone(ZONES.protectedLayer),
        minzoom: ZONES.minZoom,
        layout: { visibility: visibility(state.zones) },
        paint: { 'fill-pattern': ZONE_PATTERN },
      },
      {
        id: LAYERS.publicForestLine,
        type: 'line',
        ...zone(ZONES.publicForestLayer),
        minzoom: ZONES.minZoom,
        layout: { visibility: visibility(state.publicForests), 'line-join': 'round' },
        paint: {
          'line-color': '#0f4d3a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 2.4],
          'line-dasharray': [3, 2],
          'line-opacity': 0.9,
        },
      },
      // Copies invisibles, toujours chargées : statut du terrain dans le bilan d'un coin.
      { id: LAYERS.protectedHit, type: 'fill', ...zone(ZONES.protectedLayer), minzoom: ZONES.queryMinZoom, paint: { 'fill-opacity': 0 } },
      { id: LAYERS.publicForestHit, type: 'fill', ...zone(ZONES.publicForestLayer), minzoom: ZONES.queryMinZoom, paint: { 'fill-opacity': 0 } },
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
        paint: { 'line-color': 'rgba(0,0,0,0)', 'line-opacity': 0.85, 'line-width': 1 },
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
        minzoom: 14,
        layout: {
          visibility: 'none',
          'text-field': '',
          'text-font': [LABEL_FONT],
          'text-size': 11,
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#0b1f44', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.2 },
      },
      // Contour et nom des zones protégées par-dessus la grille de l'indice : on les voit toujours.
      {
        id: LAYERS.protectedLine,
        type: 'line',
        ...zone(ZONES.protectedLayer),
        minzoom: ZONES.minZoom,
        layout: { visibility: visibility(state.zones), 'line-join': 'round' },
        paint: {
          'line-color': '#b71c1c',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 2],
          'line-opacity': 0.85,
        },
      },
      {
        id: LAYERS.protectedLabel,
        type: 'symbol',
        ...zone(ZONES.protectedNameLayer),
        minzoom: 11.5,
        layout: {
          visibility: visibility(state.zones),
          'text-field': ['get', 'nom'],
          'text-font': [LABEL_FONT],
          'text-size': 11,
          'text-max-width': 10,
          'text-allow-overlap': false,
          // Réserves et cœurs de parc d'abord, terrains des conservatoires ensuite.
          'symbol-sort-key': ['get', 'rang'],
        },
        paint: { 'text-color': '#8b1515', 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.4 },
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

/**
 * Opacité des forêts. Avec `dimAtFineZoom`, elles s'estompent là où la grille fine de l'indice
 * s'affiche, pour que ses carrés restent lisibles.
 */
export function applyOpacity(map: MapLibreMap, opacity: number, dimAtFineZoom = false): void {
  const fill = dimAtFineZoom ? ['step', ['zoom'], opacity, FINE_MIN_ZOOM, Math.round(opacity * 45) / 100] : opacity;
  map.setPaintProperty(LAYERS.fill, 'fill-opacity', fill as never);
  map.setPaintProperty(LAYERS.overview, 'raster-opacity', opacity);
}

export function applyBasemap(map: MapLibreMap, basemap: BasemapId): void {
  map.setLayoutProperty(LAYERS.basePlan, 'visibility', visibility(basemap === 'plan'));
  map.setLayoutProperty(LAYERS.baseOrtho, 'visibility', visibility(basemap === 'ortho'));
}

export function applyGeology(map: MapLibreMap, on: boolean): void {
  map.setLayoutProperty(LAYERS.geology, 'visibility', visibility(on));
}

/** Zones protégées (affichées par défaut) et forêts publiques (sur demande). */
export function applyZones(map: MapLibreMap, state: Pick<AppState, 'zones' | 'publicForests'>): void {
  for (const layer of [LAYERS.protectedFill, LAYERS.protectedLine, LAYERS.protectedLabel]) {
    map.setLayoutProperty(layer, 'visibility', visibility(state.zones));
  }
  map.setLayoutProperty(LAYERS.publicForestLine, 'visibility', visibility(state.publicForests));
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
  applyZones(map, state);
}

/** Entoure le polygone `id` (les morceaux répartis sur plusieurs tuiles partagent le même `id`). */
export function setHighlight(map: MapLibreMap, id: string | null): void {
  const filter: FilterSpecification = id ? ['==', ['get', 'id'], id] : NO_HIGHLIGHT;
  map.setFilter(LAYERS.highlightCasing, filter);
  map.setFilter(LAYERS.highlight, filter);
}
