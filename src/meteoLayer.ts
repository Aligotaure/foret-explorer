import type { Feature, Polygon } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { FINE_MIN_ZOOM, FRANCE_BOUNDS, WEATHER_MAX_CELLS, WEATHER_MIN_ZOOM } from './config';
import { debounce } from './dom';
import {
  altitudeCache,
  fineCellsForBounds,
  hasForest,
  sampleCells,
  saveAltitudes,
  scoreFineCell,
  type FineCell,
  type Sample,
} from './fineGrid';
import { track } from './metrics';
import { CELL_KM } from './meteoGrid';
import { LEVELS, MUSHROOMS, MUSHROOM_BY_ID, scoreMushroom, type MushroomId } from './mushrooms';
import { LAYERS, SOURCES, applyOpacity, setFineVisible, setMeteoVisible } from './mapStyle';
import type { AppState, Store } from './state';
import { atAltitude, cellsForBounds, fetchAltitudes, summarize, todayKey, weatherForCells, type DailySeries } from './weather';

/** État de la grille fine (carrés de 500 m, mode « indice » seulement). */
export type FineStatus =
  | { state: 'off' }
  | { state: 'zoom' }
  | { state: 'many' }
  | { state: 'loading' }
  | { state: 'ok'; count: number; altitude: boolean };

export type MeteoStatus =
  | { state: 'off' }
  | { state: 'zoom' }
  | { state: 'outside' }
  | { state: 'many' }
  | { state: 'loading' }
  /** `day` : dernier jour connu ; `shared` : fichiers communs (sinon Open-Meteo en direct). */
  | { state: 'ok'; cells: number; day: string; shared: boolean; fine: FineStatus }
  | { state: 'error'; message: string };

/** Paliers de pluie cumulée sur 20 jours (mm) et leurs couleurs. */
export const RAIN_STEPS: readonly { min: number; color: string; label: string }[] = [
  { min: 0, color: '#f1f6fb', label: 'moins de 10 mm' },
  { min: 10, color: '#c6dbef', label: '10 à 25 mm' },
  { min: 25, color: '#6baed6', label: '25 à 50 mm' },
  { min: 50, color: '#2171b5', label: '50 à 100 mm' },
  { min: 100, color: '#08306b', label: 'plus de 100 mm' },
];

/** Champignon montré par la grille « indice » : celui recherché, sinon le cèpe. */
export const indexMushroom = (state: AppState): MushroomId => state.mushroom ?? 'cepe';

interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Rectangle d'une case ; `inset` le rétrécit (part de la largeur ôtée de chaque côté). */
function boxPolygon(c: Box, inset = 0): Polygon {
  const dx = (c.east - c.west) * inset;
  const dy = (c.north - c.south) * inset;
  const [w, s, e, n] = [c.west + dx, c.south + dy, c.east - dx, c.north - dy].map((v) => +v.toFixed(6)) as [number, number, number, number];
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

/** Marge entre deux carrés fins : une mosaïque se lit mieux qu'un damier collé. */
const FINE_INSET = 0.06;

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

/** Attend que la carte ait fini de charger ses tuiles (relevés des forêts et des sols). */
function waitForIdle(map: MapLibreMap, signal: AbortSignal): Promise<void> {
  if (map.loaded() && map.areTilesLoaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onIdle = (): void => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      map.off('idle', onIdle);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    map.once('idle', onIdle);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Grille météo sur la zone affichée : les cases communes (≈ 18 km), colorées selon la pluie des 20
 * derniers jours ou selon l'indice de pousse. En mode indice, à partir du zoom FINE_MIN_ZOOM,
 * des carrés de 500 m précisent l'indice là où poussent les arbres hôtes (voir fineGrid.ts).
 */
export class MeteoLayer {
  private controller: AbortController | null = null;
  private status: MeteoStatus = { state: 'off' };
  private readonly listeners = new Set<(s: MeteoStatus) => void>();
  /** Des carrés fins sont dessinés : la grille des cases s'efface aux zooms où ils apparaissent. */
  private fineShown = false;
  readonly refresh = debounce(() => void this.update(), 500);

  constructor(
    private readonly map: MapLibreMap,
    private readonly store: Store,
  ) {}

  /** Les forêts s'estompent aux zooms de la grille fine (mode indice, carrés dessinés). */
  get dimsForests(): boolean {
    return this.fineShown && this.store.state.weatherMode === 'indice';
  }

  onStatus(listener: (s: MeteoStatus) => void): void {
    this.listeners.add(listener);
    listener(this.status);
  }

  private setStatus(status: MeteoStatus): void {
    this.status = status;
    for (const l of this.listeners) l(status);
  }

  private setFine(fine: FineStatus): void {
    if (this.status.state === 'ok') this.setStatus({ ...this.status, fine });
  }

  /** Couleurs, étiquettes et visibilité selon le mode et le champignon choisis. */
  applyMode(): void {
    const state = this.store.state;
    const on = state.weatherMode !== 'off';
    setMeteoVisible(this.map, on);
    setFineVisible(this.map, state.weatherMode === 'indice');
    if (!on) {
      this.controller?.abort();
      this.showFine(false);
      this.setStatus({ state: 'off' });
      return;
    }
    if (state.weatherMode === 'pluie') {
      const steps = RAIN_STEPS.flatMap((s, i) => (i === 0 ? [s.color] : [s.min, s.color]));
      this.map.setPaintProperty(LAYERS.meteoFill, 'fill-color', ['step', ['get', 'rain20'], ...steps] as never);
      this.map.setPaintProperty(LAYERS.meteoFill, 'fill-opacity', 0.38);
      this.map.setLayoutProperty(LAYERS.meteoLabel, 'text-field', ['concat', ['to-string', ['get', 'rain20']], ' mm']);
    } else {
      this.paintIndex(indexMushroom(state));
    }
    this.refresh();
  }

  private paintIndex(id: MushroomId): void {
    const level = ['get', `l_${id}`];
    const colors = LEVELS.flatMap((l, i) => [i, l.color]);
    const labels = LEVELS.flatMap((l, i) => (i === 0 ? [] : [i, l.label]));
    const opacity = ['match', level, 0, 0.04, 1, 0.16, 2, 0.26, 3, 0.36, 0];
    const text = ['match', level, ...labels, ''];
    // Avec les carrés fins, la grille des cases reste en fond, très pâle et sans étiquettes.
    const fade = (normal: unknown, faded: unknown): unknown =>
      this.fineShown ? ['step', ['zoom'], normal, FINE_MIN_ZOOM, faded] : normal;
    // Vue d'ensemble (France entière) : couleurs plus soutenues, sinon les petites cases se perdent
    // sur le fond de carte ; opacité normale à partir du zoom 9.
    const fillOpacity: unknown[] = ['interpolate', ['linear'], ['zoom'], 6, ['*', 2, opacity], 9, opacity];
    if (this.fineShown) fillOpacity.push(FINE_MIN_ZOOM - 0.01, opacity, FINE_MIN_ZOOM, ['*', 0.35, opacity]);
    this.map.setPaintProperty(LAYERS.meteoFill, 'fill-color', ['match', level, ...colors, 'rgba(0,0,0,0)'] as never);
    this.map.setPaintProperty(LAYERS.meteoFill, 'fill-opacity', fillOpacity as never);
    this.map.setLayoutProperty(LAYERS.meteoLabel, 'text-field', fade(text, '') as never);

    const coverage = ['get', `c_${id}`];
    const hostOnly = ['>', coverage, 0];
    for (const layer of [LAYERS.meteoFineFill, LAYERS.meteoFineLine, LAYERS.meteoFineLabel]) {
      this.map.setFilter(layer, hostOnly as never);
    }
    // Défavorable : contour seul. Puis de plus en plus soutenu ; un carré plus couvert d'arbres
    // hôtes est plus opaque.
    this.map.setPaintProperty(LAYERS.meteoFineFill, 'fill-color', ['match', level, ...colors, 'rgba(0,0,0,0)'] as never);
    this.map.setPaintProperty(
      LAYERS.meteoFineFill,
      'fill-opacity',
      ['*', ['match', level, 0, 0, 1, 0.5, 2, 0.68, 3, 0.85, 0], ['+', 0.6, ['*', 0.4, coverage]]] as never,
    );
    this.map.setPaintProperty(LAYERS.meteoFineLine, 'line-color', ['match', level, 0, '#5d5d7e', 3, '#4a1a03', 'rgba(0,0,0,0)'] as never);
    this.map.setPaintProperty(
      LAYERS.meteoFineLine,
      'line-width',
      ['interpolate', ['linear'], ['zoom'], FINE_MIN_ZOOM, ['match', level, 3, 1.2, 0.6], 16, ['match', level, 3, 2.4, 1.2]] as never,
    );
    this.map.setLayoutProperty(LAYERS.meteoFineLabel, 'text-field', ['match', level, 2, LEVELS[2]?.label ?? '', 3, LEVELS[3]?.label ?? '', ''] as never);
  }

  private showFine(on: boolean): void {
    if (!on) this.map.getSource<GeoJSONSource>(SOURCES.meteoFine)?.setData({ type: 'FeatureCollection', features: [] });
    if (on === this.fineShown) return;
    this.fineShown = on;
    if (this.store.state.weatherMode === 'indice') this.paintIndex(indexMushroom(this.store.state));
    applyOpacity(this.map, this.store.state.opacity, this.dimsForests);
  }

  private async update(): Promise<void> {
    const state = this.store.state;
    if (state.weatherMode === 'off') return;
    if (this.map.getZoom() < WEATHER_MIN_ZOOM) {
      this.showFine(false);
      this.setStatus({ state: 'zoom' });
      return;
    }
    // Vue limitée à l'emprise de la France : pas de météo ailleurs, et jamais trop de cases.
    const b = this.map.getBounds();
    const [west, south, east, north] = FRANCE_BOUNDS;
    const view = {
      west: Math.max(b.getWest(), west),
      south: Math.max(b.getSouth(), south),
      east: Math.min(b.getEast(), east),
      north: Math.min(b.getNorth(), north),
    };
    this.controller?.abort();
    if (view.west >= view.east || view.south >= view.north) {
      this.map.getSource<GeoJSONSource>(SOURCES.meteo)?.setData({ type: 'FeatureCollection', features: [] });
      this.showFine(false);
      this.setStatus({ state: 'outside' });
      return;
    }
    const cells = cellsForBounds(view, WEATHER_MAX_CELLS);
    if (!cells) {
      this.showFine(false);
      this.setStatus({ state: 'many' });
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    this.setStatus({ state: 'loading' });
    try {
      const weather = await weatherForCells(cells, controller.signal);
      if (controller.signal.aborted) return;
      if (weather.tooMany) {
        this.showFine(false);
        this.setStatus({ state: 'many' });
        return;
      }
      const series = weather.series;
      const month = new Date().getMonth() + 1;
      const today = todayKey();
      let day = '';
      const features: Feature[] = [];
      for (const c of cells) {
        const s = series.get(c.id);
        if (!s) continue;
        const w = summarize(s, today);
        if (w.lastDate && w.lastDate > day) day = w.lastDate;
        const properties: Record<string, number> = {
          rain20: Math.round(w.rain20),
          elevation: Math.round(w.elevation),
          lastRain: w.events[0]?.daysAgo ?? -1,
        };
        for (const m of MUSHROOMS) {
          const score = scoreMushroom(m, w, month);
          properties[`l_${m.id}`] = score.level;
          properties[`s_${m.id}`] = Math.round(score.score * 100) / 100;
        }
        features.push({ type: 'Feature', id: c.id, properties, geometry: boxPolygon(c) });
      }
      this.map.getSource<GeoJSONSource>(SOURCES.meteo)?.setData({ type: 'FeatureCollection', features });
      const fine: FineStatus = state.weatherMode === 'indice' ? { state: 'loading' } : { state: 'off' };
      this.setStatus({ state: 'ok', cells: features.length, day, shared: weather.shared, fine });
      if (state.weatherMode === 'indice') await this.updateFine(series, controller.signal);
      else this.showFine(false);
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) return;
      this.setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Carrés de 500 m : relevé des forêts et des sols, altitudes IGN, indice de chaque carré. */
  private async updateFine(series: ReadonlyMap<string, DailySeries>, signal: AbortSignal): Promise<void> {
    if (this.map.getZoom() < FINE_MIN_ZOOM) {
      this.showFine(false);
      this.setFine({ state: 'zoom' });
      return;
    }
    const b = this.map.getBounds();
    const cells = fineCellsForBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    if (!cells) {
      this.showFine(false);
      this.setFine({ state: 'many' });
      return;
    }
    await waitForIdle(this.map, signal);
    const samples = sampleCells(this.map, cells.filter((c) => series.has(c.parentId)));
    const forested = cells.filter((c) => hasForest(samples.get(c.id)));

    const altitudes = altitudeCache();
    const center = this.map.getCenter();
    const distance = (c: FineCell): number => (c.lat - center.lat) ** 2 + ((c.lon - center.lng) * 0.7) ** 2;
    const missing = forested.filter((c) => !altitudes.has(c.id)).sort((a, z) => distance(a) - distance(z));
    track('ign.altitude.cacheHits', forested.length - missing.length);

    let count = this.renderFine(forested, samples, series, false);
    let altitudeOk = true;
    if (missing.length) {
      try {
        await fetchAltitudes(missing, signal, (start, values) => {
          values.forEach((z, k) => {
            const c = missing[start + k];
            if (c) altitudes.set(c.id, z);
          });
          saveAltitudes();
          if (!signal.aborted) count = this.renderFine(forested, samples, series, false);
        });
      } catch (error) {
        if (signal.aborted || isAbort(error)) return;
        console.warn('[grille fine]', error);
        altitudeOk = false;
        count = this.renderFine(forested, samples, series, true); // températures de la case
      }
    }
    if (!signal.aborted) this.setFine({ state: 'ok', count, altitude: altitudeOk });
  }

  /**
   * Dessine les carrés dont l'altitude est connue (ou tous, avec `fallback`, à l'altitude de la
   * case). Renvoie le nombre de carrés avec arbres hôtes pour le champignon affiché.
   */
  private renderFine(
    cells: readonly FineCell[],
    samples: ReadonlyMap<string, Sample[]>,
    series: ReadonlyMap<string, DailySeries>,
    fallback: boolean,
  ): number {
    const altitudes = altitudeCache();
    const month = new Date().getMonth() + 1;
    const today = todayKey();
    const shown = indexMushroom(this.store.state);
    let count = 0;
    const features: Feature[] = [];
    for (const c of cells) {
      const parent = series.get(c.parentId);
      const sample = samples.get(c.id);
      if (!parent || !sample) continue;
      const z = altitudes.get(c.id);
      if (z === undefined && !fallback) continue;
      const w = summarize(atAltitude(parent, z ?? null), today);
      const properties: Record<string, number> = { z: z ?? Math.round(parent.elevation) };
      let any = false;
      for (const m of MUSHROOMS) {
        const s = scoreFineCell(m, w, month, sample);
        properties[`l_${m.id}`] = s?.level ?? 0;
        properties[`c_${m.id}`] = s ? Math.round(s.coverage * 100) / 100 : 0;
        if (s) any = true;
        if (s && m.id === shown) count++;
      }
      if (any) features.push({ type: 'Feature', id: c.id, properties, geometry: boxPolygon(c, FINE_INSET) });
    }
    this.map.getSource<GeoJSONSource>(SOURCES.meteoFine)?.setData({ type: 'FeatureCollection', features });
    this.showFine(features.length > 0);
    return count;
  }
}

function fineText(fine: FineStatus): string {
  switch (fine.state) {
    case 'off':
      return '';
    case 'zoom':
      return ` Zoomez davantage (niveau ${FINE_MIN_ZOOM}) pour des carrés de 500 m.`;
    case 'many':
      return ' Trop de carrés de 500 m à l’écran : zoomez un peu.';
    case 'loading':
      return ' Carrés de 500 m : relevé des forêts et des altitudes…';
    case 'ok':
      return (
        ` ${fine.count} carré${fine.count > 1 ? 's' : ''} de 500 m avec arbres hôtes.` +
        (fine.altitude ? '' : ' Altitude IGN indisponible : températures de la case.')
      );
  }
}

/** Texte d'état pour la légende. */
export function describeStatus(s: MeteoStatus, state: AppState): string {
  switch (s.state) {
    case 'off':
      return 'Grille masquée.';
    case 'zoom':
      return 'Zoomez un peu pour afficher la grille météo.';
    case 'outside':
      return 'Pas de météo hors de la France métropolitaine.';
    case 'many':
      return 'Trop de cases à l’écran : zoomez un peu.';
    case 'loading':
      return 'Chargement de la météo des 30 derniers jours…';
    case 'error':
      return 'Météo indisponible pour le moment (réseau ?).';
    case 'ok': {
      const what =
        state.weatherMode === 'pluie'
          ? 'pluie cumulée'
          : `indice ${MUSHROOM_BY_ID.get(indexMushroom(state))?.label.toLowerCase() ?? ''}`;
      const date = s.day ? new Date(`${s.day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '';
      const source = s.shared ? '' : ' Fichiers météo du site indisponibles ou trop anciens : Open-Meteo interrogé directement.';
      return `${s.cells} cases de ${CELL_KM} km · ${what}${date ? `, pluie connue jusqu’au ${date}` : ''}.${source}${fineText(s.fine)}`;
    }
  }
}
