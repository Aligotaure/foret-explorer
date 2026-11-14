/**
 * Droit de cueillir sous un point : zones protégées (PatriNat, via la Géoplateforme) et forêts
 * publiques (BD TOPO de l'IGN, d'après l'ONF), tuilées par scripts/zones/ et publiées avec le site.
 *
 * Ces données sont indicatives : le bilan d'un coin le dit, et ne parle du statut d'un terrain que
 * si les tuiles sont bien là (info.json lu, aucune erreur réseau, zoom suffisant, dans l'emprise).
 */
import type { LngLat, Map as MapLibreMap, PointLike } from 'maplibre-gl';
import { ZONES, ZONES_BASE } from './config';
import { LAYERS, ZONE_PATTERN } from './mapStyle';

export type ProtectionType = 'rnn' | 'rnr' | 'perimetre' | 'rb' | 'pn' | 'apb' | 'aphn' | 'cdl' | 'cen';

/** Mêmes identifiants que scripts/zones/telecharger.mjs. */
export const PROTECTION_LABELS: Readonly<Record<ProtectionType, string>> = {
  rnn: 'Réserve naturelle nationale',
  rnr: 'Réserve naturelle régionale',
  perimetre: 'Périmètre de protection d’une réserve naturelle',
  rb: 'Réserve biologique',
  pn: 'Cœur de parc national',
  apb: 'Arrêté de protection de biotope',
  aphn: 'Arrêté de protection d’habitat naturel',
  cdl: 'Terrain du Conservatoire du littoral',
  cen: 'Site d’un conservatoire d’espaces naturels',
};

export interface Protection {
  type: ProtectionType;
  label: string;
  name: string;
  /** Fiche officielle de la zone (INPN), si elle est connue. */
  url: string | null;
}

export interface PublicForest {
  name: string;
  domaniale: boolean;
}

export interface ZonesAtPoint {
  /** false : statut inconnu (zoom trop petit, hors de l'emprise, données absentes ou non chargées). */
  known: boolean;
  /** Raison affichée quand le statut est inconnu. */
  reason?: string;
  protections: Protection[];
  publicForest: PublicForest | null;
}

export interface ZonesInfo {
  genere?: string;
  compteurs?: Record<string, number>;
}

let info: ZonesInfo | null = null;
let infoState: 'loading' | 'ok' | 'missing' = 'loading';
let networkTrouble = false;
const infoListeners = new Set<() => void>();

/** Lit `info.json` : sans lui (publication ratée, développement hors ligne), on ne dit rien du terrain. */
export async function loadZonesInfo(): Promise<void> {
  try {
    const response = await fetch(`${ZONES_BASE}info.json`, { cache: 'no-cache' });
    info = response.ok ? ((await response.json()) as ZonesInfo) : null;
    infoState = info ? 'ok' : 'missing';
  } catch {
    infoState = 'missing';
  }
  for (const listener of infoListeners) listener();
}

export function zonesInfo(): { state: typeof infoState; info: ZonesInfo | null } {
  return { state: infoState, info };
}

export function onZonesInfo(listener: () => void): void {
  infoListeners.add(listener);
}

/** Une tuile des zones n'a pas pu être chargée (autre chose qu'une tuile vide) : on ne sait plus. */
export function noteZonesError(): void {
  networkTrouble = true;
}

/** Hachures rouges des zones protégées, dessinées au canevas quand MapLibre les réclame. */
export function registerZonePattern(map: MapLibreMap): void {
  map.on('styleimagemissing', (event) => {
    if (event.id !== ZONE_PATTERN || map.hasImage(ZONE_PATTERN)) return;
    const size = 24; // 12 px à l'écran, pixelRatio 2
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = 'rgba(183, 28, 28, 0.55)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (const c of [0, size / 2, size, (3 * size) / 2]) {
      ctx.moveTo(c, 0);
      ctx.lineTo(c - size, size);
    }
    ctx.stroke();
    map.addImage(ZONE_PATTERN, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
  });
}

const safeUrl = (value: unknown): string | null =>
  typeof value === 'string' && value.startsWith('https://inpn.mnhn.fr/') ? value : null;

/** Zones protégées et forêt publique sous un point de l'écran. */
export function zonesAt(map: MapLibreMap, point: PointLike, lngLat: LngLat): ZonesAtPoint {
  const unknown = (reason: string): ZonesAtPoint => ({ known: false, reason, protections: [], publicForest: null });
  const [west, south, east, north] = ZONES.bounds;
  if (lngLat.lng < west || lngLat.lng > east || lngLat.lat < south || lngLat.lat > north) {
    return unknown(`hors de la zone couverte (${ZONES.coverage})`);
  }
  if (map.getZoom() < ZONES.queryMinZoom) return unknown(`zoomez au niveau ${ZONES.queryMinZoom} ou plus pour le connaître`);
  if (infoState === 'loading') return unknown('données en cours de chargement');
  if (infoState === 'missing' || networkTrouble || !map.getLayer(LAYERS.protectedHit)) {
    return unknown('données des zones indisponibles pour le moment');
  }

  const protections: Protection[] = [];
  const seen = new Set<string>();
  for (const feature of map.queryRenderedFeatures(point, { layers: [LAYERS.protectedHit] })) {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const type = String(props['type'] ?? '') as ProtectionType;
    const base = PROTECTION_LABELS[type];
    if (!base) continue;
    const name = String(props['nom'] ?? '').trim();
    const key = `${type}|${name}`;
    if (seen.has(key)) continue; // même zone coupée par les bords de tuile
    seen.add(key);
    const detail = type === 'rb' && typeof props['detail'] === 'string' ? ` ${props['detail'].toLowerCase()}` : '';
    protections.push({ type, label: `${base}${detail}`, name, url: safeUrl(props['url']) });
  }

  const [forest] = map.queryRenderedFeatures(point, { layers: [LAYERS.publicForestHit] });
  const props = (forest?.properties ?? null) as Record<string, unknown> | null;
  const publicForest = props
    ? { name: String(props['nom'] ?? 'Forêt publique'), domaniale: props['nature'] === 'domaniale' }
    : null;
  return { known: true, protections, publicForest };
}
