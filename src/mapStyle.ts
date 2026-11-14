import type { FilterSpecification, LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import {
  ATTRIBUTION,
  BDFORET,
  FRANCE_BOUNDS,
  archiveTiles,
  GEOLOGY,
  GEOLOGY_TILES_BASE,
  GLYPHS_URL,
  LABEL_FONT,
  FINE_MIN_ZOOM,
  TILES,
  WEATHER_LABEL_MIN_ZOOM,
  WEATHER_SUB_LABEL_MIN_ZOOM,
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
  meteoTop: 'meteo-points',
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
  meteoTop: 'meteo-points',
  meteoTopLabel: 'meteo-points-etiquettes',
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

/** Tuiles d'images affichées sans fondu (voir les couches de fond dans `buildStyle`). */
const NO_FADE = { 'raster-fade-duration': 0 } as const;

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
    // Pas de transition de 0,3 s sur les couleurs et les opacités : elle fait redessiner la carte en
    // continu, plusieurs images de trop sur un appareil sans carte graphique (voir meteoLayer.ts).
    transition: { duration: 0, delay: 0 },
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
        bounds: FRANCE_BOUNDS, // rien hors de France métropolitaine (l'IGN y répond 404)
        attribution: ATTRIBUTION.bdForet,
      },
      [SOURCES.bdForet]: {
        type: 'vector',
        tiles: [TILES.bdForetVector],
        minzoom: BDFORET.minZoom,
        maxzoom: BDFORET.maxZoom,
        bounds: FRANCE_BOUNDS,
        attribution: ATTRIBUTION.bdForet,
      },
      [SOURCES.geologie]: {
        type: 'vector',
        tiles: [archiveTiles(`${GEOLOGY_TILES_BASE}${GEOLOGY.archive}`)],
        minzoom: GEOLOGY.minZoom,
        maxzoom: GEOLOGY.maxZoom,
        bounds: GEOLOGY.bounds,
        attribution: ATTRIBUTION.geologie,
      },
      // Grille météo : `maxzoom` bas exprès. Au-delà, MapLibre agrandit les tuiles de ce niveau au
      // lieu d'en découper de plus petites : une ou deux tuiles couvrent la vue au lieu de douze, donc
      // moins d'images redessinées à chaque mise à jour (voir meteoLayer.ts). Prix : les coordonnées
      // sont arrondies à l'unité de tuile (8 192 par tuile), soit ± 7 m pour les carrés de 4,5 km
      // (un pixel au zoom 12 ; plus au-delà, où ils ne sont plus qu'un fond derrière les carrés de
      // 500 m, eux à ± 0,4 m) : moins que la marge laissée entre deux carrés de 500 m.
      [SOURCES.meteo]: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        attribution: ATTRIBUTION.meteo,
        maxzoom: 8,
      },
      [SOURCES.meteoFine]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, maxzoom: 12 },
      [SOURCES.meteoTop]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, maxzoom: 5 },
      [SOURCES.zones]: {
        type: 'vector',
        tiles: [archiveTiles(`${ZONES_BASE}${ZONES.archive}`)],
        minzoom: ZONES.minZoom,
        maxzoom: ZONES.maxZoom,
        bounds: ZONES.bounds,
        attribution: ATTRIBUTION.zones,
      },
    },
    layers: [
      // Images de fond sans fondu (`NO_FADE`) : chaque tuile qui arrive s'affiche d'un coup. Avec le
      // fondu d'office de 0,3 s, la carte se redessinait en continu tant que des tuiles arrivaient.
      // Mesuré le 14/11/2026 sans carte graphique, zoom de 7,2 à 8,2 : 38 images et 2,7 s de fil
      // principal occupé avec le fondu, 24 images et 1,4 s sans.
      { id: LAYERS.basePlan, type: 'raster', source: SOURCES.planIgn, layout: { visibility: visibility(state.basemap === 'plan') }, paint: NO_FADE },
      { id: LAYERS.baseOrtho, type: 'raster', source: SOURCES.ortho, layout: { visibility: visibility(state.basemap === 'ortho') }, paint: NO_FADE },
      {
        id: LAYERS.overview,
        type: 'raster',
        source: SOURCES.bdForetRaster,
        maxzoom: BDFORET.minZoom,
        paint: { 'raster-opacity': state.opacity, ...NO_FADE },
      },
      {
        id: LAYERS.fill,
        type: 'fill',
        ...vector,
        minzoom: BDFORET.minZoom,
        // Bords non lissés : le lissage redessine le contour de chaque polygone, et la BD Forêt en
        // compte des milliers par vue. Mesuré le 14/11/2026 sans carte graphique, zoom 10,5 : une image
        // de la carte coûte 176 ms avec le lissage, 103 ms sans (à partir du zoom 12, `bdforet-outline`
        // trace de toute façon les contours).
        paint: { 'fill-color': colorExpression(), 'fill-opacity': state.opacity, 'fill-antialias': false },
        ...forestFilter,
      },
      { id: LAYERS.forestHit, type: 'fill', ...vector, minzoom: BDFORET.minZoom, paint: { 'fill-opacity': 0 } },
      {
        id: LAYERS.geology,
        type: 'fill',
        ...geology,
        minzoom: GEOLOGY.minZoom,
        layout: { visibility: visibility(state.geology) },
        paint: { 'fill-pattern': patternExpression(), 'fill-opacity': 0.85, 'fill-antialias': false },
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
        paint: { 'fill-pattern': ZONE_PATTERN, 'fill-antialias': false },
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
        // Des rectangles alignés sur les axes : le lissage des bords n'y sert à rien (et coûte une passe).
        paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0.45, 'fill-antialias': false },
      },
      {
        id: LAYERS.meteoLine,
        type: 'line',
        source: SOURCES.meteo,
        minzoom: WEATHER_MIN_ZOOM,
        layout: { visibility: visibility(meteoOn) },
        // Vue d'ensemble : pas de quadrillage, les cases ne font que quelques pixels.
        paint: { 'line-color': '#161630', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 6.5, 0, 8, 0.25], 'line-width': 0.6 },
      },
      {
        id: LAYERS.meteoFineFill,
        type: 'fill',
        source: SOURCES.meteoFine,
        minzoom: FINE_MIN_ZOOM,
        layout: { visibility: 'none' },
        paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0.5, 'fill-antialias': false },
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
        minzoom: WEATHER_LABEL_MIN_ZOOM,
        layout: {
          visibility: visibility(meteoOn),
          'text-field': '',
          'text-font': [LABEL_FONT],
          'text-size': 12,
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#0b1f44', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4 },
      },
      // Vue d'ensemble : pastilles sur les secteurs où la chance estimée atteint le seuil (meteoLayer.ts).
      {
        id: LAYERS.meteoTop,
        type: 'circle',
        source: SOURCES.meteoTop,
        maxzoom: WEATHER_SUB_LABEL_MIN_ZOOM,
        paint: { 'circle-radius': 17, 'circle-color': ['get', 'color'], 'circle-opacity': 0.92, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      },
      {
        id: LAYERS.meteoTopLabel,
        type: 'symbol',
        source: SOURCES.meteoTop,
        maxzoom: WEATHER_SUB_LABEL_MIN_ZOOM,
        layout: {
          'text-field': ['concat', ['to-string', ['get', 'p']], ' %'],
          'text-font': [LABEL_FONT],
          'text-size': 12,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.4)', 'text-halo-width': 1 },
      },
      {
        id: LAYERS.meteoFineLabel,
        type: 'symbol',
        source: SOURCES.meteoFine,
        // Dès l'arrivée des carrés de 500 m (retour de Clément du 14/11/2026). Avant, leur pourcentage
        // n'apparaissait qu'au zoom 14 : du zoom 12 au zoom 14, aux échelles 1 km à 300 m, il ne restait
        // que la nuance de couleur pour juger d'un carré. Au zoom 12 un carré fait ≈ 37 pixels de large.
        minzoom: FINE_MIN_ZOOM,
        layout: {
          visibility: 'none',
          'text-field': '',
          'text-font': [LABEL_FONT],
          // Il grandit avec le carré : 10 px quand il fait 37 px de large, 18 px au zoom 16.
          'text-size': ['interpolate', ['linear'], ['zoom'], FINE_MIN_ZOOM, 10, 14, 14, 16, 18],
          'text-allow-overlap': false,
          'text-padding': 0,
        },
        paint: { 'text-color': '#0b1f44', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.6 },
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
