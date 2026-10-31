import type { Feature, Polygon } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { WEATHER_MIN_ZOOM } from './config';
import { debounce } from './dom';
import { LEVELS, MUSHROOMS, MUSHROOM_BY_ID, scoreMushroom, type MushroomId } from './mushrooms';
import { LAYERS, SOURCES, setMeteoVisible } from './mapStyle';
import type { AppState, Store } from './state';
import { cellsForBounds, summarize, weatherForCells, type GridCell } from './weather';

export type MeteoStatus =
  | { state: 'off' }
  | { state: 'zoom' }
  | { state: 'loading' }
  | { state: 'ok'; cells: number; day: string }
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

function cellPolygon(c: GridCell): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [c.west, c.south],
        [c.east, c.south],
        [c.east, c.north],
        [c.west, c.north],
        [c.west, c.south],
      ],
    ],
  };
}

/**
 * Grille météo sur la zone affichée : une cellule ≈ 4,5 km, colorée selon la pluie des 20
 * derniers jours ou selon l'indice de pousse (météo seule, à l'altitude moyenne de la cellule).
 */
export class MeteoLayer {
  private controller: AbortController | null = null;
  private status: MeteoStatus = { state: 'off' };
  private readonly listeners = new Set<(s: MeteoStatus) => void>();
  readonly refresh = debounce(() => void this.update(), 500);

  constructor(
    private readonly map: MapLibreMap,
    private readonly store: Store,
  ) {}

  onStatus(listener: (s: MeteoStatus) => void): void {
    this.listeners.add(listener);
    listener(this.status);
  }

  private setStatus(status: MeteoStatus): void {
    this.status = status;
    for (const l of this.listeners) l(status);
  }

  /** Couleurs, étiquettes et visibilité selon le mode et le champignon choisis. */
  applyMode(): void {
    const state = this.store.state;
    const on = state.weatherMode !== 'off';
    setMeteoVisible(this.map, on);
    if (!on) {
      this.controller?.abort();
      this.setStatus({ state: 'off' });
      return;
    }
    if (state.weatherMode === 'pluie') {
      const steps = RAIN_STEPS.flatMap((s, i) => (i === 0 ? [s.color] : [s.min, s.color]));
      this.map.setPaintProperty(LAYERS.meteoFill, 'fill-color', ['step', ['get', 'rain20'], ...steps] as never);
      this.map.setPaintProperty(LAYERS.meteoFill, 'fill-opacity', 0.38);
      this.map.setLayoutProperty(LAYERS.meteoLabel, 'text-field', ['concat', ['to-string', ['get', 'rain20']], ' mm']);
    } else {
      const key = `l_${indexMushroom(state)}`;
      const colors = LEVELS.flatMap((l, i) => [i, l.color]);
      this.map.setPaintProperty(LAYERS.meteoFill, 'fill-color', ['match', ['get', key], ...colors, 'rgba(0,0,0,0)'] as never);
      this.map.setPaintProperty(LAYERS.meteoFill, 'fill-opacity', ['match', ['get', key], 0, 0.04, 1, 0.16, 2, 0.26, 3, 0.36, 0] as never);
      const labels = LEVELS.flatMap((l, i) => (i === 0 ? [] : [i, l.label]));
      this.map.setLayoutProperty(LAYERS.meteoLabel, 'text-field', ['match', ['get', key], ...labels, ''] as never);
    }
    this.refresh();
  }

  private async update(): Promise<void> {
    if (this.store.state.weatherMode === 'off') return;
    if (this.map.getZoom() < WEATHER_MIN_ZOOM) {
      this.setStatus({ state: 'zoom' });
      return;
    }
    const b = this.map.getBounds();
    const cells = cellsForBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, 120);
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.setStatus({ state: 'loading' });
    try {
      const series = await weatherForCells(cells, controller.signal);
      if (controller.signal.aborted) return;
      const month = new Date().getMonth() + 1;
      let day = '';
      const features: Feature[] = [];
      for (const c of cells) {
        const s = series.get(c.id);
        if (!s) continue;
        day = s.dates[s.dates.length - 1] ?? day;
        const w = summarize(s);
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
        features.push({ type: 'Feature', id: c.id, properties, geometry: cellPolygon(c) });
      }
      const source = this.map.getSource<GeoJSONSource>(SOURCES.meteo);
      source?.setData({ type: 'FeatureCollection', features });
      this.setStatus({ state: 'ok', cells: features.length, day });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      this.setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** Texte d'état pour la légende. */
export function describeStatus(s: MeteoStatus, state: AppState): string {
  switch (s.state) {
    case 'off':
      return 'Grille masquée.';
    case 'zoom':
      return 'Zoomez un peu pour afficher la grille météo.';
    case 'loading':
      return 'Chargement de la météo des 20 derniers jours…';
    case 'error':
      return 'Météo indisponible pour le moment (réseau ?).';
    case 'ok': {
      const what =
        state.weatherMode === 'pluie'
          ? 'pluie cumulée'
          : `indice ${MUSHROOM_BY_ID.get(indexMushroom(state))?.label.toLowerCase() ?? ''}`;
      const date = s.day ? new Date(`${s.day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '';
      return `${s.cells} cellules de 4,5 km · ${what}${date ? ` au ${date}` : ''}.`;
    }
  }
}
