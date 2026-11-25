/**
 * Services publics de la Géoplateforme IGN (data.geopf.fr) : sans clé d'API,
 * données sous Licence Ouverte Etalab 2.0. Points d'accès vérifiés le 31/10/2026
 * (détails et pièges dans docs/donnees.md).
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
  zones: `Zones protégées : PatriNat (OFB, MNHN), Conservatoire du littoral ; forêts publiques : ${IGN} – BD TOPO®`,
} as const;

/** Autocomplétion d'adresses et de lieux-dits (Géoplateforme). */
export const GEOCODING_COMPLETION_URL = `${GEOPF}/geocodage/completion`;

/** Altitude d'un point (RGE ALTI, Géoplateforme) : `?lon=…&lat=…&resource=ign_rge_alti_wld`. */
export const ALTITUDE_URL = `${GEOPF}/altimetrie/1.0/calcul/alti/rest/elevation.json`;

/** Polices des étiquettes (servies par la Géoplateforme). */
export const GLYPHS_URL = `${GEOPF}/annexes/ressources/vectorTiles/fonts/{fontstack}/{range}.pbf`;
export const LABEL_FONT = 'Source Sans Pro Regular';

/**
 * Adresse de la page, pour situer les données servies avec le site. Ce fichier est aussi lu hors
 * navigateur (scripts/meteo/france.mjs, qui calcule les moyennes de France à la publication) : il
 * n'y a alors pas de page, et aucune de ces adresses ne sert.
 */
const PAGE = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI;

/**
 * Fichiers météo communs (cases d'environ 18 km sur toute la France, 30 derniers jours), produits
 * chaque jour par la tâche GitHub `meteo.yml` et publiés avec le site. En développement, on lit
 * ceux du site en ligne.
 */
export const METEO_BASE = import.meta.env.DEV
  ? 'https://aligotaure.github.io/foret-explorer/data/meteo/'
  : new URL('data/meteo/', PAGE).href;

/**
 * Ce que chaque carré de 4,5 km contient pour chaque champignon (scripts/foret/parts.mjs ; fichier
 * versionné, servi avec le site, en développement aussi) : le nombre de ses carrés de 500 m que la
 * carte dessinerait, et ce que vaut le meilleur. Un carré d'indice est allumé dès qu'il en a un
 * (`isLit` de forestShare.ts), et d'autant plus soutenu qu'il en a : teinte à HOST_MIN_TINT de sa
 * force pour un seul bois, pleine quand HOST_FULL_COVER de ses carrés de 500 m sont à dessiner.
 *
 * Avant le 25/11/2026 : allumé à partir de 10 % de sa surface sous des arbres hôtes, teinte pleine à
 * 50 %. Les deux mesures se suivent (10 % de surface ≈ 14 % de carrés de 500 m à dessiner, 50 % ≈
 * 70 % : mesuré sur les 27 530 carrés de France qui ont des hôtes du cèpe) : un carré allumé avant
 * garde la même teinte, à peu de chose près.
 */
export const FOREST_SHARE_URL = new URL('foret/parts.json', PAGE).href;
export const HOST_MIN_TINT = 0.3;
export const HOST_FULL_COVER = 0.7;
/**
 * Part bâtie d'un carré de 4,5 km (zones bâties et zones d'activité du Plan IGN, même fichier) à
 * partir de laquelle il est d'abord une ville : ses carrés de 500 m suivent alors la règle de ville
 * (FINE_TOWN_MIN_*), et lui ne s'allume que s'il en reste un à dessiner (un massif, pas un parc).
 */
export const BUILT_MAX_COVER = 0.15;
/**
 * Carrés de 500 m : part des points relevés (9 par carré) qui doivent être sous un arbre hôte pour
 * que le carré soit dessiné. Trois points sur neuf : un bosquet ou un parc en ville n'en pose plus.
 */
export const FINE_MIN_HOST_SHARE = 0.3;
/**
 * En ville (carré de 4,5 km bâti à BUILT_MAX_COVER ou plus), un carré de 500 m n'est dessiné que
 * s'il est franchement boisé en hôtes (cinq points sur neuf) et tient à un massif (au moins deux de
 * ses huit voisins passent eux-mêmes la règle des trois points) : un parc ou un square isolé n'en
 * pose plus.
 */
export const FINE_TOWN_MIN_HOST_SHARE = 0.5;
export const FINE_TOWN_MIN_NEIGHBOURS = 2;

/** Météo de secours : Open-Meteo en direct (gratuit, sans clé, usage non commercial). */
export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
/**
 * Appels directs, seulement si les fichiers communs sont injoignables (ou pour un point hors de
 * France) : 20 jours passés (1,5 appel par point) et au plus DIRECT_MAX_CELLS cases à l'écran.
 */
export const DIRECT_PAST_DAYS = 20;
export const DIRECT_MAX_CELLS = 60;
/** Fichiers communs en retard de plus de tant de jours (tâche GitHub en panne) : on ne s'y fie plus. */
export const METEO_MAX_LATE_DAYS = 3;
/**
 * La grille météo s'affiche à tous les zooms : toute la France tient dans WEATHER_MAX_CELLS cases
 * (la vue est d'abord limitée à l'emprise de la France). Les étiquettes attendent que les cases
 * soient assez grandes.
 */
export const WEATHER_MIN_ZOOM = 4;
export const WEATHER_MAX_CELLS = 4500;
export const WEATHER_LABEL_MIN_ZOOM = 7.5;
/**
 * Bilan d'un coin : si l'altitude exacte (IGN) n'est pas arrivée au bout de SPOT_ALTITUDE_WAIT_MS, la
 * météo s'affiche déjà, à l'altitude que la grille météo donne au carré de 4,5 km ; la demande
 * d'altitude est abandonnée au bout de SPOT_ALTITUDE_TIMEOUT_MS.
 */
export const SPOT_ALTITUDE_WAIT_MS = 2500;
export const SPOT_ALTITUDE_TIMEOUT_MS = 12_000;

/**
 * Indice de pousse : à partir de ce zoom, chaque case est détaillée en carrés de 4,5 km (même pluie,
 * températures ramenées à l'altitude de chaque carré), avec leur pourcentage.
 *
 * Avant le 14/11/2026 les carrés arrivaient dès le zoom 8, sans étiquette jusqu'au zoom 10 : quand la
 * règle de la carte affiche 20 km (zooms 7,8 à 8,35 à 46° de latitude), ils faisaient 17 à 26 pixels
 * de large, leur couleur ne se lisait pas, et ils coûtaient la moitié du temps de dessin d'une image
 * (34 ms sur 68 au zoom 8,2, sans carte graphique ; 4 ms sur 51 avec des cases entières). Les cases
 * de 18 km restent donc jusqu'au zoom 10 (la règle affiche alors 30, 20, 10 puis 5 km), où les
 * pastilles disent où aller voir ; les carrés de 4,5 km arrivent avec leurs étiquettes et avec les
 * forêts détaillées. Une expression de zoom dans une propriété `layout` (le texte des étiquettes)
 * n'est évaluée qu'aux zooms entiers : garder un seuil entier.
 */
export const WEATHER_SUB_MIN_ZOOM = 10;
export const WEATHER_SUB_LABEL_MIN_ZOOM = 10;

/**
 * Grille fine de l'indice (carrés ≈ 500 m : chaque case de base de 4,5 km découpée en 9 × 9), à
 * partir de ce zoom. Au-delà de FINE_MAX_CELLS carrés à l'écran, on garde la grille des cases.
 *
 * Zoom 11 depuis le 15/11/2026 (12 avant), demande de Clément : les carrés qu'on voyait à l'échelle
 * 1 km doivent être là dès l'échelle 2 km (la règle de la carte affiche 2 km à partir du zoom 11,1),
 * « et si ça fait ramer, on affiche le chargement ». Un carré y fait 18 pixels de large, et une vue
 * en contient quatre fois plus qu'au zoom 12 : 3 000 sur un écran de 1280 × 800, 5 100 sur 1850 × 940,
 * d'où le plafond relevé de 1 600 à 6 500 (au-delà, écrans de plus de 2 000 pixels de large : la
 * légende dit de zoomer un peu).
 */
export const FINE_MIN_ZOOM = 11;
/**
 * Zoom des tuiles de forêt que lit le relevé des carrés de 500 m, à tous les zooms d'affichage, dans
 * la carte (mapStyle.ts : source `bdforet-releve`) comme dans le calcul fait pour toute la France
 * (scripts/foret/parts.mjs). L'IGN simplifie ses tuiles à chaque zoom : relevé sur celles du zoom
 * affiché, un même carré changeait un peu selon le zoom où on l'avait vu la première fois (mesuré
 * près d'Amiens le 25/11/2026 : entre les tuiles des zooms 10 et 11, 3 carrés de 4,5 km sur 15
 * différaient, de 2 points ou d'un carré de 500 m). Égal à FINE_MIN_ZOOM : jusqu'au zoom 12 ce sont
 * les tuiles déjà affichées.
 */
export const SURVEY_TILE_ZOOM = 11;
export const FINE_DIVISIONS = 9;
export const FINE_MAX_CELLS = 6500;
/**
 * Altitude exacte de chaque carré de 500 m (service de l'IGN) : seulement à partir de ce zoom. En
 * deçà, une vue compte des milliers de carrés : ce serait des dizaines de requêtes de 200 points par
 * déplacement (le service en accepte 5 par seconde et par adresse), et la carte redessinée à chaque
 * lot. Les carrés prennent alors l'altitude de leur carré de 4,5 km, déjà dans les fichiers météo, ou
 * l'altitude exacte si une visite plus zoomée l'a déjà gardée.
 */
export const FINE_ALTITUDE_MIN_ZOOM = 12;

/**
 * Calcul des carrés en cours (mode indice) : à partir de ce zoom (la règle de la carte affiche alors
 * 2 km ou moins), un petit champignon se remplit et le zoom est mis en pause tant que les carrés de la
 * nouvelle vue ne sont pas dessinés (demande de Clément du 14/11/2026). C'est là qu'on attend le plus :
 * tuiles détaillées des forêts, puis relevé des carrés de 500 m. Relevé le 14/11/2026 : en revenant du
 * zoom 13 au zoom 11,6, les carrés de 500 m disparaissent tout de suite et ceux de 4,5 km de la
 * nouvelle vue n'arrivent que 0,8 s plus tard (sans carte graphique, plusieurs secondes) ; et chaque
 * cran de zoom donné pendant ce temps relance tout le travail.
 * La pause ne dure jamais plus de GRID_BUSY_MAX_MS : un réseau lent ne doit pas coincer le visiteur.
 */
export const GRID_BUSY_MIN_ZOOM = 11;
export const GRID_BUSY_MAX_MS = 8000;

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
/**
 * France métropolitaine et Corse (ouest, sud, est, nord) : emprise des données nationales et vue de
 * la première visite (ensuite, la carte reprend la dernière vue).
 */
export const FRANCE_BOUNDS: [number, number, number, number] = [-5.3, 41.3, 9.7, 51.2];

/**
 * Adresse de tuiles MapLibre pour une archive PMTiles : toutes les tuiles d'une couche dans un seul
 * fichier, lu par morceaux (requêtes HTTP partielles) grâce au protocole `pmtiles://` enregistré
 * dans mapView.ts. GitHub Pages ne sait pas publier des dizaines de milliers de petits fichiers.
 */
export const archiveTiles = (url: string): string => `pmtiles://${url}/{z}/{x}/{y}`;

export const GEOLOGY_TILES_BASE = import.meta.env.DEV
  ? 'https://aligotaure.github.io/foret-explorer/data/geologie/'
  : new URL('data/geologie/', PAGE).href;

export const GEOLOGY = {
  sourceLayer: 'geologie',
  /** Archive des tuiles, à côté de `info.json`. */
  archive: 'geologie.pmtiles',
  /** Zooms de l'archive (scripts/geologie/construire.sh) : la carte sur-zoome au-delà. */
  minZoom: 10,
  maxZoom: 11,
  /** Emprise couverte : France métropolitaine, Corse comprise (ouest, sud, est, nord). */
  bounds: FRANCE_BOUNDS,
  coverage: 'France métropolitaine',
} as const;

/**
 * Zones protégées (réserves, arrêtés de biotope…) et forêts publiques, produites par
 * `scripts/zones/` à partir du WFS de la Géoplateforme et publiées avec le site.
 */
export const ZONES_BASE = import.meta.env.DEV
  ? 'https://aligotaure.github.io/foret-explorer/data/zones/'
  : new URL('data/zones/', PAGE).href;

export const ZONES = {
  protectedLayer: 'protection',
  /** Un point par zone protégée, pour afficher son nom une seule fois. */
  protectedNameLayer: 'protection_nom',
  publicForestLayer: 'foret_publique',
  /** Archive des tuiles, à côté de `info.json`. */
  archive: 'zones.pmtiles',
  /** Zooms de l'archive (scripts/zones/construire.sh) : la carte sur-zoome au-delà. */
  minZoom: 9,
  maxZoom: 11,
  /** Zoom à partir duquel le bilan d'un coin donne le statut du terrain (celui de la BD Forêt). */
  queryMinZoom: 10,
  /** Emprise téléchargée : France métropolitaine, Corse comprise (ouest, sud, est, nord). */
  bounds: FRANCE_BOUNDS,
  coverage: 'France métropolitaine',
} as const;

/** Zoom 4 : la France entière tient sur un écran de téléphone. */
export const MAP_MIN_ZOOM = 4;
export const MAP_MAX_ZOOM = 18;
export const DEFAULT_OPACITY = 0.7;

/** Clé localStorage (préférences de l'utilisateur). Changer le suffixe si le format change. */
export const STORAGE_KEY = 'foret-explorer:v1';
