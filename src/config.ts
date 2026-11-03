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
  geologie: '© <a href="https://www.brgm.fr/" target="_blank" rel="noopener">BRGM</a> – carte géologique 1/50 000 harmonisée',
  meteo: 'Météo <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0)',
  zones: `Zones protégées : PatriNat (OFB, MNHN) ; forêts publiques : ${IGN} – BD TOPO®`,
} as const;

/** Autocomplétion d'adresses et de lieux-dits (Géoplateforme). */
export const GEOCODING_COMPLETION_URL = `${GEOPF}/geocodage/completion`;

/** Altitude d'un point (RGE ALTI, Géoplateforme) : `?lon=…&lat=…&resource=ign_rge_alti_wld`. */
export const ALTITUDE_URL = `${GEOPF}/altimetrie/1.0/calcul/alti/rest/elevation.json`;

/** Polices des étiquettes (servies par la Géoplateforme). */
export const GLYPHS_URL = `${GEOPF}/annexes/ressources/vectorTiles/fonts/{fontstack}/{range}.pbf`;
export const LABEL_FONT = 'Source Sans Pro Regular';

/** Météo : Open-Meteo (gratuit, sans clé, usage non commercial). */
export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
/** Nombre de jours passés analysés pour la pousse. */
export const PAST_DAYS = 20;
/** Zoom minimal pour afficher la grille météo (au-delà, trop de cellules). */
export const WEATHER_MIN_ZOOM = 8;

/**
 * Grille fine de l'indice (carrés ≈ 500 m : chaque case météo découpée en 9 × 9), à partir de ce
 * zoom. Au-delà de FINE_MAX_CELLS carrés à l'écran, on garde la grille de 4,5 km.
 */
export const FINE_MIN_ZOOM = 12;
export const FINE_DIVISIONS = 9;
export const FINE_MAX_CELLS = 1600;

/**
 * Altitude IGN : points par requête et délai entre deux requêtes. La Géoplateforme limite le calcul
 * altimétrique à 5 requêtes par seconde et par adresse IP (erreur 429 au-delà).
 */
export const ALTITUDE_BATCH = 200; // ≈ 4 Ko d'URL ; au-delà de 15 Ko, le service refuse
export const ALTITUDE_SPACING_MS = 250;

/**
 * Serveur de mesure de la consommation des API (Cloudflare, dossier `worker/`), fourni au build par
 * la publication quand il est configuré. Vide : rien n'est envoyé.
 */
export const METRICS_URL = (import.meta.env.VITE_METRICS_URL ?? '').replace(/\/+$/, '');

/**
 * Tuiles de géologie simplifiée, produites par `scripts/geologie/` et publiées avec le site.
 * En développement, on lit celles du site en ligne (GitHub Pages autorise le CORS).
 */
export const GEOLOGY_TILES_BASE = import.meta.env.DEV
  ? 'https://aligotaure.github.io/foret-explorer/data/geologie/'
  : new URL('data/geologie/', document.baseURI).href;

export const GEOLOGY = {
  sourceLayer: 'geologie',
  minZoom: 9,
  maxZoom: 13,
  /** Emprise couverte : Savoie et Haute-Savoie (ouest, sud, est, nord). */
  bounds: [5.6, 45.0, 7.25, 46.45] as [number, number, number, number],
  coverage: 'Haute-Savoie et Savoie',
} as const;

/**
 * Zones protégées (réserves, arrêtés de biotope…) et forêts publiques, produites par
 * `scripts/zones/` à partir du WFS de la Géoplateforme et publiées avec le site.
 */
export const ZONES_BASE = import.meta.env.DEV
  ? 'https://aligotaure.github.io/foret-explorer/data/zones/'
  : new URL('data/zones/', document.baseURI).href;

export const ZONES = {
  protectedLayer: 'protection',
  /** Un point par zone protégée, pour afficher son nom une seule fois. */
  protectedNameLayer: 'protection_nom',
  publicForestLayer: 'foret_publique',
  minZoom: 9,
  maxZoom: 13,
  /** Zoom à partir duquel le bilan d'un coin donne le statut du terrain (celui de la BD Forêt). */
  queryMinZoom: 10,
  /** Emprise téléchargée : Savoie, Haute-Savoie et alentours (ouest, sud, est, nord). */
  bounds: [5.6, 45.0, 7.25, 46.45] as [number, number, number, number],
  coverage: 'Savoie, Haute-Savoie et alentours',
} as const;

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
