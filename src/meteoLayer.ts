import type { Feature, Polygon } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import {
  BUILT_MAX_COVER,
  FINE_MIN_ZOOM,
  FRANCE_BOUNDS,
  HOST_FULL_COVER,
  HOST_MIN_COVER,
  WEATHER_MAX_CELLS,
  WEATHER_MIN_ZOOM,
  WEATHER_SUB_LABEL_MIN_ZOOM,
  WEATHER_SUB_MIN_ZOOM,
} from './config';
import {
  altitudeCache,
  fineCellsForBounds,
  hasForest,
  fineCellsToDraw,
  hostShare,
  sampleCells,
  saveAltitudes,
  scoreFineCell,
  type FineCell,
  type Sample,
} from './fineGrid';
import { hostCover, hostCoverOfCell, isLit, loadForestShare } from './forestShare';
import { track } from './metrics';
import { CELL_KM, subBox, subIndexAt } from './meteoGrid';
import { CHANCE_THRESHOLD, LEVELS, MUSHROOM_BY_ID, chanceOf, scoreMushroom, type MushroomId } from './mushrooms';
import { LAYERS, SOURCES, applyOpacity, setFineVisible, setMeteoVisible } from './mapStyle';
import type { AppState, Store } from './state';
import {
  atAltitude,
  cellsForBounds,
  fetchAltitudes,
  medianAltitude,
  summarize,
  summaryAtAltitude,
  todayKey,
  weatherForCells,
  type DailySeries,
  type WeatherSummary,
} from './weather';

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
  /**
   * `day` : dernier jour connu (`estimated` : d'après la prévision, en attendant la mise à jour du
   * jour) ; `shared` : fichiers communs (sinon Open-Meteo en direct) ; `sub` : indice détaillé par
   * carrés de 4,5 km ; `hosts` : les arbres hôtes de chaque carré sont connus (sinon tout est coloré).
   */
  | { state: 'ok'; cells: number; day: string; estimated: boolean; shared: boolean; sub: boolean; hosts: boolean; best: number | null; fine: FineStatus }
  | { state: 'error'; message: string };

/** Pastilles de la vue d'ensemble, au plus. */
const HOTSPOT_MAX = 12;

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

/** Quadrillage des cases : absent en vue d'ensemble (les cases ne font que quelques pixels). */
const GRID_LINE_OPACITY = 0.25;
const gridLineOpacity = (opacity: unknown): unknown[] => ['interpolate', ['linear'], ['zoom'], 6.5, 0, 8, opacity];

/** Marge entre deux carrés fins : une mosaïque se lit mieux qu'un damier collé. */
const FINE_INSET = 0.06;

/** Pendant que leurs altitudes arrivent, les carrés de 500 m sont redessinés au plus à ce rythme. */
const FINE_RENDER_EVERY_MS = 1200;

/** Déplacement de la carte : on attend qu'elle se pose avant de refaire la grille. */
const REFRESH_DELAY_MS = 500;

const round2 = (v: number): number => Math.round(v * 100) / 100;

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
 * derniers jours ou selon l'indice de pousse. En mode indice, chaque case est détaillée en carrés de
 * 4,5 km à partir du zoom WEATHER_SUB_MIN_ZOOM (même pluie, températures ramenées à l'altitude de
 * chaque carré) ; à partir du zoom FINE_MIN_ZOOM, des carrés de 500 m précisent l'indice là où
 * poussent les arbres hôtes (voir fineGrid.ts).
 *
 * Coût du dessin (mesuré le 14/11/2026, navigateur sans carte graphique) : chaque image redessinée
 * coûte 0,1 à 0,3 s, et tout changement d'une expression qui lit une propriété des carrés fait
 * refaire à MapLibre toutes les tuiles de la source. D'où trois règles :
 *  - les carrés ne portent que les valeurs du champignon montré, sous des noms fixes (`l` niveau,
 *    `p` chance estimée, `c` part d'arbres hôtes) : les expressions ne changent pas avec le champignon ;
 *  - un carré éteint n'est pas envoyé à la carte ;
 *  - un contenu identique au précédent n'est pas renvoyé (`setSource`).
 */
export class MeteoLayer {
  private controller: AbortController | null = null;
  private status: MeteoStatus = { state: 'off' };
  private readonly listeners = new Set<(s: MeteoStatus) => void>();
  /** Des carrés fins sont dessinés : les forêts s'estompent aux zooms où ils apparaissent. */
  private fineShown = false;
  /**
   * Le relevé fin de la vue est fait (zoom des carrés de 500 m) : la grille des cases passe en fond,
   * sans étiquette, même s'il n'a trouvé aucun arbre hôte. Sans cela, un grand carré plein et son
   * pourcentage revenaient sur un village ou un centre-ville dès qu'on zoomait dessus.
   */
  private fineDone = false;
  /** Dernier contenu envoyé à chaque source de la grille. */
  private readonly sent = new Map<string, string>([
    [SOURCES.meteo, '[]'],
    [SOURCES.meteoFine, '[]'],
    [SOURCES.meteoTop, '[]'],
  ]);
  private timer: number | undefined;

  /** La carte a bougé : la grille est refaite une fois la carte posée. */
  readonly refresh = (): void => {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.update(), REFRESH_DELAY_MS);
  };

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

  /**
   * Remplace le contenu d'une source, sauf s'il n'a pas changé : à chaque `setData`, MapLibre refait
   * toutes les tuiles de la source et redessine la carte plusieurs fois.
   */
  private setSource(source: string, features: readonly Feature[]): void {
    const json = JSON.stringify(features);
    if (this.sent.get(source) === json) return;
    this.sent.set(source, json);
    this.map.getSource<GeoJSONSource>(source)?.setData({ type: 'FeatureCollection', features } as never);
  }

  /** Couleurs, étiquettes et visibilité selon le mode et le champignon choisis. */
  applyMode(): void {
    const state = this.store.state;
    const on = state.weatherMode !== 'off';
    setMeteoVisible(this.map, on);
    setFineVisible(this.map, state.weatherMode === 'indice');
    if (!on) {
      window.clearTimeout(this.timer);
      this.controller?.abort();
      this.showHotspots([], 1);
      this.showFine(false);
      this.setStatus({ state: 'off' });
      return;
    }
    if (state.weatherMode === 'pluie') {
      const steps = RAIN_STEPS.flatMap((s, i) => (i === 0 ? [s.color] : [s.min, s.color]));
      this.map.setPaintProperty(LAYERS.meteoFill, 'fill-color', ['step', ['get', 'rain20'], ...steps] as never);
      this.map.setPaintProperty(LAYERS.meteoFill, 'fill-opacity', 0.38);
      this.map.setPaintProperty(LAYERS.meteoLine, 'line-opacity', gridLineOpacity(GRID_LINE_OPACITY) as never);
      this.map.setLayoutProperty(LAYERS.meteoLabel, 'text-field', ['concat', ['to-string', ['get', 'rain20']], ' mm']);
    } else {
      this.paintIndex();
    }
    // Tout de suite, sans attendre : le mode ou le champignon vient de changer, la carte ne bouge pas.
    window.clearTimeout(this.timer);
    void this.update();
  }

  /**
   * Expressions du mode indice. Elles ne dépendent pas du champignon (voir en tête de classe) :
   * rappelées avec les mêmes valeurs, MapLibre n'en fait rien. Seul `fineDone` les change.
   */
  private paintIndex(): void {
    const level = ['get', 'l'];
    const colors = LEVELS.flatMap((l, i) => [i, l.color]);
    // Sous le seuil, un secteur ne vaut pas le déplacement : presque effacé, sans étiquette.
    const chance = ['get', 'p'];
    // Arbres hôtes du carré (`c`, part de sa surface ; −1 : inconnue, on dessine comme avant) :
    // d'autant plus soutenu qu'il est boisé. Sous le seuil il est éteint : en mode indice il n'est
    // pas dans la source, mais les cases du mode pluie y restent un instant quand on change de mode.
    const cover = ['get', 'c'];
    const unlit = ['all', ['>=', cover, 0], ['<', cover, HOST_MIN_COVER]];
    const wooded = ['case', ['<', cover, 0], 1, unlit, 0, ['interpolate', ['linear'], cover, HOST_MIN_COVER, 0.45, HOST_FULL_COVER, 1]];
    const opacity = ['*', ['match', level, 0, 0.04, 1, 0.1, 2, 0.26, 3, 0.36, 0], wooded];
    const text = ['case', ['>=', chance, CHANCE_THRESHOLD], ['concat', ['to-string', chance], ' %'], ''];
    // Étiquettes : celles des cases entières en vue d'ensemble, celles des carrés de 4,5 km quand ils
    // sont assez grands ; avec les carrés fins, la grille reste en fond, très pâle et sans étiquettes.
    // (En vue d'ensemble, ce sont les pastilles des meilleurs secteurs qui portent les pourcentages.)
    const textByZoom: unknown[] = ['step', ['zoom'], '', WEATHER_SUB_LABEL_MIN_ZOOM, text];
    if (this.fineDone) textByZoom.push(FINE_MIN_ZOOM, '');
    // Vue d'ensemble (France entière) : couleurs plus soutenues, sinon les petites cases se perdent
    // sur le fond de carte ; opacité normale à partir du zoom 9.
    const fillOpacity: unknown[] = ['interpolate', ['linear'], ['zoom'], 6, ['*', 2, opacity], 9, opacity];
    if (this.fineDone) fillOpacity.push(FINE_MIN_ZOOM - 0.01, opacity, FINE_MIN_ZOOM, ['*', 0.35, opacity]);
    this.map.setPaintProperty(LAYERS.meteoFill, 'fill-color', ['match', level, ...colors, 'rgba(0,0,0,0)'] as never);
    this.map.setPaintProperty(LAYERS.meteoFill, 'fill-opacity', fillOpacity as never);
    this.map.setPaintProperty(LAYERS.meteoLine, 'line-opacity', gridLineOpacity(['case', unlit, 0, GRID_LINE_OPACITY]) as never);
    this.map.setLayoutProperty(LAYERS.meteoLabel, 'text-field', textByZoom as never);

    // Carrés de 500 m : la source ne contient que ceux qui ont des arbres hôtes du champignon montré.
    const coverage = ['get', 'c'];
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
    this.map.setLayoutProperty(LAYERS.meteoFineLabel, 'text-field', text as never);
  }

  /**
   * Vue d'ensemble : une pastille sur chacun des meilleurs secteurs (chance ≥ CHANCE_THRESHOLD), les
   * plus forts d'abord, espacés d'un septième de la vue, HOTSPOT_MAX au plus. Rend la meilleure
   * chance de la vue (null : aucun secteur au-dessus du seuil).
   */
  private showHotspots(features: readonly Feature[], width: number): number | null {
    const gap = width / 7;
    const ranked = features
      .map((f) => ({
        p: Number(f.properties?.p ?? 0),
        l: Number(f.properties?.l ?? 0),
        x: Number(f.properties?.x),
        y: Number(f.properties?.y),
      }))
      .filter((c) => c.p >= CHANCE_THRESHOLD)
      .sort((a, b) => b.p - a.p);
    const picked: typeof ranked = [];
    for (const c of ranked) {
      if (picked.length >= HOTSPOT_MAX) break;
      if (picked.some((o) => Math.abs(o.x - c.x) < gap && Math.abs(o.y - c.y) < gap * 0.7)) continue;
      picked.push(c);
    }
    const points: Feature[] = picked.map((c) => ({
      type: 'Feature',
      properties: { p: c.p, color: LEVELS[c.l]?.color ?? '#e07a1f' },
      geometry: { type: 'Point', coordinates: [c.x, c.y] },
    }));
    this.setSource(SOURCES.meteoTop, points);
    return ranked[0]?.p ?? null;
  }

  /** `done` : le relevé fin de la vue est fait, qu'il ait trouvé des arbres hôtes (`on`) ou non. */
  private showFine(on: boolean, done = on): void {
    if (!on) this.setSource(SOURCES.meteoFine, []);
    if (on === this.fineShown && done === this.fineDone) return;
    this.fineShown = on;
    this.fineDone = done;
    if (this.store.state.weatherMode === 'indice') this.paintIndex();
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
      this.setSource(SOURCES.meteo, []);
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
      // L'indice se détaille par carrés de 4,5 km ; la pluie, elle, est la même dans toute la case.
      const subdivide = state.weatherMode === 'indice' && this.map.getZoom() >= WEATHER_SUB_MIN_ZOOM;
      let day = '';
      let estimated = false;
      let count = 0;
      let detailed = false;
      const features: Feature[] = [];
      // Arbres hôtes de chaque carré : sans eux, le pourcentage ne regardait que la météo. Chargés
      // en mode pluie aussi : en passant à la chance estimée, les carrés déjà là sont repeints tout
      // de suite, et ils doivent déjà savoir où sont les arbres (sinon les villes s'allument un instant).
      const hosts = await loadForestShare();
      if (controller.signal.aborted) return;
      const shown = MUSHROOM_BY_ID.get(indexMushroom(state));
      const index = state.weatherMode === 'indice';
      /**
       * `host` : arbres hôtes du champignon montré dans ce carré (null : inconnus, météo seule) ;
       * `lit` : le carré est allumé (assez d'arbres hôtes, pas d'abord une ville : `isLit`).
       */
      const add = (id: string, weatherOf: () => WeatherSummary, box: Box, sub: 0 | 1, host: { cover: number; quality: number } | null, lit: boolean, spot: Box = box): void => {
        // Arbres hôtes connus : l'indice vaut pour eux (qualité moyenne des hôtes du carré). En mode
        // indice un carré éteint n'est pas dessiné du tout : il n'est ni calculé ni envoyé à la carte.
        if (index && !lit) return;
        const w = weatherOf();
        const score = lit && shown ? scoreMushroom(shown, w, month, host ? { hostQuality: host.quality } : {}) : null;
        features.push({
          type: 'Feature',
          id,
          properties: {
            rain20: Math.round(w.rain20),
            elevation: Math.round(w.elevation),
            sub,
            // Où poser la pastille de la vue d'ensemble : au centre, ou sur le carré le plus boisé d'une case.
            x: +((spot.west + spot.east) / 2).toFixed(4),
            y: +((spot.south + spot.north) / 2).toFixed(4),
            // Champignon montré seulement : niveau, chance estimée, part d'arbres hôtes (−1 : inconnue ;
            // 0 : carré éteint, gardé pour le mode pluie).
            l: score?.level ?? 0,
            p: score?.chance ?? 0,
            c: !host ? -1 : lit ? round2(host.cover) : 0,
          },
          geometry: boxPolygon(box),
        });
      };
      for (const c of cells) {
        const s = series.get(c.id);
        if (!s) continue;
        const w = summarize(s, today);
        if (w.lastDate && w.lastDate >= day) {
          estimated = w.lastDate > day ? w.estimated : estimated || w.estimated;
          day = w.lastDate;
        }
        count++;
        if (subdivide && s.subAltitudes) {
          detailed = true;
          s.subAltitudes.forEach((z, k) => {
            if (z === null) return;
            const host = hosts && shown ? hostCover(c.id, k, shown) : null;
            add(`${c.id}/${k}`, () => summaryAtAltitude(w, z), subBox(c, k), 1, host, !host || isLit(host));
          });
        } else {
          const cell = hosts && shown ? hostCoverOfCell(c.id, shown) : null;
          // Allumée dès qu'un de ses carrés l'est (sa teinte suit la moyenne) : une case de plaine avec
          // une seule vraie forêt ne doit pas s'éteindre en vue d'ensemble puis réapparaître en zoomant.
          const lit = !cell || cell.best >= 0;
          const host = cell && lit ? { cover: Math.max(cell.cover, HOST_MIN_COVER), quality: cell.quality } : cell;
          // Case entière : à l'altitude médiane de ses carrés plutôt qu'à celle du point de relevé.
          add(c.id, () => summaryAtAltitude(w, medianAltitude(s)), c, 0, host, lit, cell && cell.best >= 0 ? subBox(c, cell.best) : c);
        }
      }
      this.setSource(SOURCES.meteo, features);
      const best = this.showHotspots(index ? features : [], view.east - view.west);
      const fine: FineStatus = state.weatherMode === 'indice' ? { state: 'loading' } : { state: 'off' };
      this.setStatus({ state: 'ok', cells: count, day, estimated, shared: weather.shared, sub: detailed, hosts, best, fine });
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
        // Les altitudes arrivent par lots : redessiner à chacun ferait refaire toutes les tuiles des
        // carrés plusieurs fois par seconde. On redessine de temps en temps, puis une fois à la fin.
        let drawn = performance.now();
        await fetchAltitudes(missing, signal, (start, values) => {
          values.forEach((z, k) => {
            const c = missing[start + k];
            if (c) altitudes.set(c.id, z);
          });
          saveAltitudes();
          if (signal.aborted || performance.now() - drawn < FINE_RENDER_EVERY_MS) return;
          drawn = performance.now();
          count = this.renderFine(forested, samples, series, false);
        });
        if (!signal.aborted) count = this.renderFine(forested, samples, series, false);
      } catch (error) {
        if (signal.aborted || isAbort(error)) return;
        console.warn('[grille fine]', error);
        altitudeOk = false;
        count = this.renderFine(forested, samples, series, true); // à l'altitude du carré de 4,5 km
      }
    }
    if (!signal.aborted) this.setFine({ state: 'ok', count, altitude: altitudeOk });
  }

  /**
   * Dessine les carrés dont l'altitude est connue (ou tous, avec `fallback`, à l'altitude de la
   * case). Renvoie le nombre de carrés dessinés : ceux qui ont des arbres hôtes du champignon montré.
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
    const shown = MUSHROOM_BY_ID.get(indexMushroom(this.store.state));
    const features: Feature[] = [];
    // Seuls les carrés avec assez d'arbres hôtes du champignon montré sont dessinés (en ville, la
    // règle est plus sévère) : les autres ne sont ni calculés ni envoyés à la carte.
    const draw = shown
      ? fineCellsToDraw(
          cells.flatMap((c) => {
            const sample = samples.get(c.id);
            const share = sample ? hostShare(shown, sample) : 0;
            if (!share) return [];
            const built = hostCover(c.parentId, subIndexAt(c.lat, c.lon), shown)?.built ?? 0;
            return [{ id: c.id, share, town: built >= BUILT_MAX_COVER }];
          }),
          new Set(samples.keys()),
        )
      : new Set<string>();
    for (const c of cells) {
      const parent = series.get(c.parentId);
      const sample = samples.get(c.id);
      if (!shown || !parent || !sample || !draw.has(c.id)) continue;
      const known = altitudes.get(c.id);
      if (known === undefined && !fallback) continue;
      // Altitude IGN indisponible : celle du carré de 4,5 km qui contient ce carré.
      const z = known ?? parent.subAltitudes?.[subIndexAt(c.lat, c.lon)] ?? null;
      const s = scoreFineCell(shown, summarize(atAltitude(parent, z), today), month, sample);
      if (!s) continue;
      features.push({
        type: 'Feature',
        id: c.id,
        properties: { z: z ?? Math.round(parent.elevation), l: s.level, p: chanceOf(s.score), c: round2(s.coverage) },
        geometry: boxPolygon(c, FINE_INSET),
      });
    }
    this.setSource(SOURCES.meteoFine, features);
    // Tous les carrés boisés ont leur altitude (ou on s'en passe) : le relevé fin fait foi, même vide.
    this.showFine(features.length > 0, features.length > 0 || fallback || cells.every((c) => altitudes.has(c.id)));
    return features.length;
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
        (fine.altitude ? '' : ' Altitude IGN indisponible : températures à l’altitude du carré de 4,5 km.')
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
          : `indice ${MUSHROOM_BY_ID.get(indexMushroom(state))?.label.toLowerCase() ?? ''}${s.sub ? ', par carrés de 4,5 km selon leur altitude' : ''}`;
      const date = s.day ? new Date(`${s.day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '';
      const source = s.shared ? '' : ' Fichiers météo du site indisponibles ou trop anciens : Open-Meteo interrogé directement.';
      const until = date ? `, pluie connue jusqu’au ${date}${s.estimated ? ' (dernier jour estimé d’après la prévision)' : ''}` : '';
      const best =
        state.weatherMode !== 'indice'
          ? ''
          : s.best === null
            ? ` Aucun secteur à ${CHANCE_THRESHOLD} % ou plus dans la vue.`
            : ` Meilleure chance estimée dans la vue : ≈ ${s.best} %.`;
      // Sans le fichier des parts de forêt, la grille ne sait pas où sont les arbres : autant le dire.
      const blind = state.weatherMode === 'indice' && !s.hosts ? ' Arbres hôtes inconnus pour le moment : tous les secteurs sont colorés, forêt ou non.' : '';
      return `${s.cells} cases de ${CELL_KM} km · ${what}${until}.${best}${blind}${source}${fineText(s.fine)}`;
    }
  }
}
