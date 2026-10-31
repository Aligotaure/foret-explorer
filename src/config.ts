/**
 * Services publics de la Géoplateforme IGN (data.geopf.fr) : sans clé d'API,
 * données sous Licence Ouverte Etalab 2.0. Points d'accès vérifiés le 31/10/2026
 * (détails et pièges dans CLAUDE.md).
 */
const GEOPF = 'https://data.geopf.fr';

/** URL de tuiles WMTS au format attendu par MapLibre ({z}/{x}/{y}). */
function wmts(layer: string, tileMatrixSet: string, format: string): string {
  return (
    `${GEOPF}/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}` +
    `&STYLE=normal&TILEMATRIXSET=${tileMatrixSet}&FORMAT=${format}` +
    '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
  );
}

export const TILES = {
  /** Fond « Plan IGN » (raster). */
  planIgn: wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'PM', 'image/png'),
  /** Photographies aériennes (raster). */
  ortho: wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'PM', 'image/jpeg'),
  /** BD Forêt V2 pré-rendue (raster, non filtrable) : aperçu aux petits zooms. */
  bdForetRaster: wmts('LANDCOVER.FORESTINVENTORY.V2', 'PM_6_16', 'image/png'),
  /**
   * BD Forêt V2 en tuiles vectorielles (Mapbox Vector Tiles).
   * Numérotation XYZ standard, même si le style officiel IGN déclare `scheme: "tms"`.
   */
  bdForetVector: `${GEOPF}/tms/1.0.0/LANDCOVER-TMS.FORESTINVENTORY.V2/{z}/{x}/{y}.pbf`,
} as const;

export const BDFORET = {
  /** Nom de la couche dans les tuiles vectorielles. */
  sourceLayer: 'formation_vegetale',
  /** Zooms où les tuiles vectorielles existent (au-delà de 16 : sur-zoom). */
  minZoom: 10,
  maxZoom: 16,
  /** Zoom minimal du raster d'aperçu (TileMatrixSet PM_6_16). */
  rasterMinZoom: 6,
} as const;

const IGN = '© <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a>';

export const ATTRIBUTION = {
  planIgn: `${IGN} – Plan IGN`,
  ortho: `${IGN} – Photographies aériennes`,
  bdForet: `${IGN} – BD Forêt® V2 (Licence Ouverte Etalab 2.0)`,
} as const;

/** Autocomplétion d'adresses et de lieux-dits (Géoplateforme). */
export const GEOCODING_COMPLETION_URL = `${GEOPF}/geocodage/completion`;

/** Vue initiale : entre Annecy, le Parmelan et Thônes. */
export const INITIAL_VIEW = {
  center: [6.19, 45.92] as [number, number],
  zoom: 11.5,
};

export const MAP_MIN_ZOOM = 5;
export const MAP_MAX_ZOOM = 18;
export const DEFAULT_OPACITY = 0.7;

/** Clé localStorage (préférences de l'utilisateur). Changer le suffixe si le format change. */
export const STORAGE_KEY = 'foret-explorer:v1';
