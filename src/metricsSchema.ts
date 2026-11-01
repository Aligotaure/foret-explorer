/**
 * Compteurs de consommation des API, partagés par la carte (`src/metrics.ts`) et le serveur de
 * mesure (`worker/`). Un compteur absent de cette liste est refusé par le serveur.
 *
 * Aucun identifiant de visiteur : seulement des totaux par jour.
 */

export type ServiceId = 'app' | 'openMeteo' | 'ignAltitude' | 'ignGeocoding' | 'ignTiles' | 'pages';

export interface MetricDef {
  label: string;
  service: ServiceId;
  /** Plafond accepté par envoi : garde-fou contre les envois fantaisistes. */
  max: number;
  /** Facteur d'affichage (les appels pondérés d'Open-Meteo sont comptés en dixièmes). */
  scale?: number;
  /** Compteur d'erreurs (affiché à part dans le tableau de bord). */
  error?: true;
}

export const SERVICES: Readonly<Record<ServiceId, { label: string; note: string }>> = {
  app: { label: 'Visites', note: 'Ouvertures de la carte et bilans de coin.' },
  openMeteo: {
    label: 'Open-Meteo (météo)',
    note: 'Gratuit en usage non commercial : moins de 10 000 appels par jour, 5 000 par heure, 600 par minute et 300 000 par mois. Une requête de 21 jours pèse 1,5 appel par point.',
  },
  ignAltitude: { label: 'IGN · altitude', note: 'Limite : 5 requêtes par seconde et par adresse IP (erreur 429 au-delà).' },
  ignGeocoding: { label: 'IGN · recherche de lieu', note: 'Limite : 10 requêtes par seconde et par adresse IP pour l’autocomplétion.' },
  ignTiles: { label: 'IGN · tuiles et polices', note: 'Tuiles WMTS et vectorielles : pas de limite annoncée par la Géoplateforme.' },
  pages: { label: 'GitHub Pages · géologie', note: 'Limite souple : 100 Go de trafic par mois pour tout le site.' },
};

export const METRICS = {
  'app.sessions': { label: 'Visites', service: 'app', max: 1 },
  'app.sessionsMobile': { label: 'dont sur téléphone', service: 'app', max: 1 },
  'app.spots': { label: 'Bilans de coin ouverts', service: 'app', max: 300 },

  'openMeteo.requests': { label: 'Requêtes', service: 'openMeteo', max: 1000 },
  'openMeteo.locations': { label: 'Points demandés', service: 'openMeteo', max: 50_000 },
  'openMeteo.calls10': { label: 'Appels pondérés', service: 'openMeteo', max: 750_000, scale: 0.1 },
  'openMeteo.cacheHits': { label: 'Points servis par le cache du jour', service: 'openMeteo', max: 50_000 },
  'openMeteo.errors': { label: 'Erreurs', service: 'openMeteo', max: 1000, error: true },

  'ign.altitude.requests': { label: 'Requêtes', service: 'ignAltitude', max: 2000 },
  'ign.altitude.points': { label: 'Points demandés', service: 'ignAltitude', max: 200_000 },
  'ign.altitude.cacheHits': { label: 'Points servis par le cache', service: 'ignAltitude', max: 200_000 },
  'ign.altitude.errors': { label: 'Erreurs', service: 'ignAltitude', max: 2000, error: true },

  'ign.geocoding.requests': { label: 'Requêtes', service: 'ignGeocoding', max: 2000 },
  'ign.geocoding.errors': { label: 'Erreurs', service: 'ignGeocoding', max: 2000, error: true },

  'ign.tiles.forest': { label: 'Tuiles BD Forêt (vecteur)', service: 'ignTiles', max: 100_000 },
  'ign.tiles.forestRaster': { label: 'Tuiles BD Forêt (aperçu)', service: 'ignTiles', max: 100_000 },
  'ign.tiles.plan': { label: 'Tuiles Plan IGN', service: 'ignTiles', max: 100_000 },
  'ign.tiles.ortho': { label: 'Tuiles photos aériennes', service: 'ignTiles', max: 100_000 },
  'ign.fonts': { label: 'Polices des étiquettes', service: 'ignTiles', max: 10_000 },
  'ign.tiles.errors': { label: 'Erreurs', service: 'ignTiles', max: 100_000, error: true },

  'pages.geology': { label: 'Tuiles de géologie', service: 'pages', max: 100_000 },
  'pages.geology.errors': { label: 'Erreurs', service: 'pages', max: 100_000, error: true },
} as const satisfies Record<string, MetricDef>;

export type MetricName = keyof typeof METRICS;

export const METRIC_NAMES = Object.keys(METRICS) as MetricName[];

export function isMetricName(name: string): name is MetricName {
  return Object.prototype.hasOwnProperty.call(METRICS, name);
}

/**
 * Poids d'une requête Open-Meteo, en dixièmes d'appel : une requête « standard » couvre
 * 10 variables et 14 jours pour un point ; au-delà, elle compte pour plusieurs appels
 * (règle publiée par Open-Meteo, page « Pricing »).
 */
export function openMeteoCalls10(locations: number, days: number, variables: number): number {
  return Math.round(locations * 10 * Math.max(1, days / 14) * Math.max(1, variables / 10));
}
