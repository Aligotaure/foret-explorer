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
  FINE_STEP_LAT,
  FINE_STEP_LON,
  altitudeCache,
  fineCellsForBounds,
  FINE_POINTS,
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
import {
  CHANCE_THRESHOLD,
  HOTSPOT_MIN_CHANCE,
  LEVELS,
  MUSHROOM_BY_ID,
  chanceOf,
  currentMonth,
  noEstimate,
  offSeasonText,
  scoreMushroom,
  weatherCeiling,
  type Mushroom,
  type MushroomId,
} from './mushrooms';
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
  /** Mode indice, champignon montré hors saison : rien n'est chargé, calculé ni dessiné pour lui. */
  | { state: 'offSeason' }
  /**
   * `day` : dernier jour connu (`estimated` : d'après la prévision, en attendant la mise à jour du
   * jour) ; `shared` : fichiers communs (sinon Open-Meteo en direct) ; `sub` : indice détaillé par
   * carrés de 4,5 km ; `hosts` : les arbres hôtes de chaque carré sont connus (sinon tout est coloré) ;
   * `best` : meilleure chance estimée de la vue, si elle atteint CHANCE_THRESHOLD ; `spots` : vue
   * d'ensemble du mode indice, où des pastilles marquent les secteurs à HOTSPOT_MIN_CHANCE ou plus.
   */
  | { state: 'ok'; cells: number; day: string; estimated: boolean; shared: boolean; sub: boolean; hosts: boolean; best: number | null; spots: boolean; fine: FineStatus }
  | { state: 'error'; message: string };

/** Pastilles de la vue d'ensemble, au plus. */
const HOTSPOT_MAX = 12;

/** Un secteur candidat à une pastille : sa chance estimée, son niveau, où la poser. */
export interface Hotspot {
  p: number;
  l: number;
  x: number;
  y: number;
}

/**
 * Pastilles de la vue d'ensemble : les secteurs à HOTSPOT_MIN_CHANCE ou plus, les plus forts d'abord,
 * espacés d'un septième de la largeur de la vue (`width`, en degrés), HOTSPOT_MAX au plus.
 */
export function pickHotspots(candidates: readonly Hotspot[], width: number, max = HOTSPOT_MAX): Hotspot[] {
  const gap = width / 7;
  const picked: Hotspot[] = [];
  for (const c of [...candidates].filter((c) => c.p >= HOTSPOT_MIN_CHANCE).sort((a, b) => b.p - a.p)) {
    if (picked.length >= max) break;
    if (picked.some((o) => Math.abs(o.x - c.x) < gap && Math.abs(o.y - c.y) < gap * 0.7)) continue;
    picked.push(c);
  }
  return picked;
}

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

type GridCell = NonNullable<ReturnType<typeof cellsForBounds>>[number];

/** Dernier relevé de la vue : de quoi redessiner la grille tout de suite, sans rien redemander. */
interface GridData {
  cells: readonly GridCell[];
  series: ReadonlyMap<string, DailySeries>;
  /** Fichiers météo communs (sinon Open-Meteo en direct). */
  shared: boolean;
  /** Les arbres hôtes de chaque carré sont connus (fichier des parts chargé). */
  hosts: boolean;
  /** Emprise de la vue (dans la France) : pastilles et meilleure chance ne regardent qu'elle. */
  view: Box;
}

/** Dernier relevé des carrés de 500 m (forêts et sols de la vue). */
interface FineData {
  cells: readonly FineCell[];
  samples: ReadonlyMap<string, Sample[]>;
  series: ReadonlyMap<string, DailySeries>;
  /** Altitude IGN indisponible : carrés dessinés à l'altitude du carré de 4,5 km. */
  fallback: boolean;
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

/** Dernier zoom d'une couche (plage de zoom du quadrillage). */
const MAX_LAYER_ZOOM = 24;

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
 * poussent les arbres hôtes (voir fineGrid.ts). En deçà, des cases entières, et une pastille sur les
 * secteurs « favorables » : sa chance est celle du meilleur carré de 4,5 km de la case (à l'altitude
 * de ce carré), pas celle de la case entière, qui ne vaut qu'à l'altitude médiane (en montagne les
 * pastilles disparaîtraient des vallées).
 *
 * Champignon montré hors saison (`noEstimate`) : rien n'est chargé, calculé ni dessiné.
 *
 * Coût du dessin (mesuré le 14/11/2026, navigateur sans carte graphique) : chaque image redessinée
 * coûte 0,1 à 0,3 s, et tout changement d'une expression qui lit une propriété des carrés fait
 * refaire à MapLibre toutes les tuiles de la source. D'où trois règles :
 *  - les carrés ne portent que les valeurs du champignon montré, sous des noms fixes (`l` niveau,
 *    `p` chance estimée, `c` part d'arbres hôtes) : les expressions ne changent pas avec le champignon ;
 *  - un carré éteint n'est pas envoyé à la carte ;
 *  - un contenu identique au précédent n'est pas renvoyé (`setSource`).
 * Contrepartie : le bon contenu doit partir dès que le champignon ou le mode change. `redraw()` le
 * refait donc tout de suite à partir du dernier relevé gardé (`data`, `fineData`), sans attendre le
 * réseau ni le repos de la carte ; sinon les carrés montrent un instant les valeurs de l'ancien
 * champignon sous le nom du nouveau.
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
  private data: GridData | null = null;
  private fineData: FineData | null = null;

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
        this.setSource(SOURCES.meteoTop, []);
      this.dropFine();
      this.setStatus({ state: 'off' });
      return;
    }
    if (state.weatherMode === 'pluie') {
      const steps = RAIN_STEPS.flatMap((s, i) => (i === 0 ? [s.color] : [s.min, s.color]));
      this.map.setPaintProperty(LAYERS.meteoFill, 'fill-color', ['step', ['get', 'rain20'], ...steps] as never);
      this.map.setPaintProperty(LAYERS.meteoFill, 'fill-opacity', 0.38);
      this.map.setPaintProperty(LAYERS.meteoLine, 'line-opacity', gridLineOpacity(GRID_LINE_OPACITY) as never);
      this.map.setLayerZoomRange(LAYERS.meteoLine, WEATHER_MIN_ZOOM, MAX_LAYER_ZOOM);
      this.map.setLayoutProperty(LAYERS.meteoLabel, 'text-field', ['concat', ['to-string', ['get', 'rain20']], ' mm']);
    } else {
      this.paintIndex();
    }
    // Tout de suite, avec ce qu'on a déjà : le mode ou le champignon vient de changer, la carte ne
    // bouge pas. Puis une mise à jour, sans attendre (elle ne renvoie rien si rien n'a changé).
    this.redraw();
    window.clearTimeout(this.timer);
    void this.update();
  }

  /** Redessine la grille et les carrés de 500 m à partir du dernier relevé, sans rien redemander. */
  private redraw(): void {
    if (this.offSeason()) return this.showOffSeason();
    if (!this.data) return;
    const index = this.store.state.weatherMode === 'indice';
    const fine = index && this.map.getZoom() >= FINE_MIN_ZOOM ? this.fineData : null;
    this.drawGrid(!index ? { state: 'off' } : fine ? { state: 'ok', count: this.renderFine(fine), altitude: !fine.fallback } : { state: 'loading' });
  }

  /** Champignon montré par la grille d'indice (undefined : mode pluie ou grille éteinte). */
  private shown(): Mushroom | undefined {
    const state = this.store.state;
    return state.weatherMode === 'indice' ? MUSHROOM_BY_ID.get(indexMushroom(state)) : undefined;
  }

  /** Mode indice et champignon montré hors saison : il n'y a rien à estimer (voir `noEstimate`). */
  private offSeason(): boolean {
    const shown = this.shown();
    return Boolean(shown) && noEstimate(shown as Mushroom, currentMonth());
  }

  /**
   * Hors saison : la grille, les pastilles et les carrés de 500 m sont retirés, rien n'est demandé.
   * Le dernier relevé (`data`) est gardé : revenir à un champignon de saison redessine dans l'instant.
   */
  private showOffSeason(): void {
    window.clearTimeout(this.timer);
    this.controller?.abort();
    this.setSource(SOURCES.meteo, []);
    this.setSource(SOURCES.meteoTop, []);
    this.dropFine();
    this.setStatus({ state: 'offSeason' });
  }

  /**
   * Expressions du mode indice. Elles ne dépendent pas du champignon (voir en tête de classe) :
   * rappelées avec les mêmes valeurs, MapLibre n'en fait rien. Seul `fineDone` les change.
   */
  private paintIndex(): void {
    // Les cases du mode pluie ne portent ni `l`, ni `p`, ni `c` : s'il en reste un instant dans la
    // source quand on passe à l'indice, elles valent 0 partout, donc éteintes (voir `unlit`).
    const level = ['coalesce', ['get', 'l'], 0];
    const colors = LEVELS.flatMap((l, i) => [i, l.color]);
    // Sous le seuil, un secteur ne vaut pas le déplacement : presque effacé, sans étiquette.
    const chance = ['coalesce', ['get', 'p'], 0];
    // Arbres hôtes du carré (`c`, part de sa surface ; −1 : inconnue, on dessine comme avant) :
    // d'autant plus soutenu qu'il est boisé. Sous le seuil il est éteint (en mode indice, un carré
    // éteint n'est de toute façon pas dans la source).
    const cover = ['coalesce', ['get', 'c'], 0];
    const unlit = ['all', ['>=', cover, 0], ['<', cover, HOST_MIN_COVER]];
    const wooded = ['case', ['<', cover, 0], 1, unlit, 0, ['interpolate', ['linear'], cover, HOST_MIN_COVER, 0.45, HOST_FULL_COVER, 1]];
    const opacity = ['*', ['match', level, 0, 0.04, 1, 0.1, 2, 0.26, 3, 0.36, 0], wooded];
    const text = ['case', ['>=', chance, CHANCE_THRESHOLD], ['concat', ['to-string', chance], ' %'], ''];
    // Étiquettes : seulement celles des carrés de 4,5 km (`sub` = 1), jamais celles des cases entières
    // (en vue d'ensemble, ce sont les pastilles qui portent les pourcentages). Sans cette condition,
    // en passant le zoom 10 les cases encore dans la source afficheraient un instant leur pourcentage
    // de case, que les carrés contrediraient une demi-seconde plus tard. Avec les carrés fins, la
    // grille reste en fond, très pâle et sans étiquettes.
    const squareText = ['case', ['==', ['get', 'sub'], 1], text, ''];
    const textByZoom: unknown[] = ['step', ['zoom'], '', WEATHER_SUB_LABEL_MIN_ZOOM, squareText];
    if (this.fineDone) textByZoom.push(FINE_MIN_ZOOM, '');
    // Vue d'ensemble (France entière) : couleurs plus soutenues, sinon les petites cases se perdent
    // sur le fond de carte ; opacité normale à partir du zoom 9.
    const fillOpacity: unknown[] = ['interpolate', ['linear'], ['zoom'], 6, ['*', 2, opacity], 9, opacity];
    if (this.fineDone) fillOpacity.push(FINE_MIN_ZOOM - 0.01, opacity, FINE_MIN_ZOOM, ['*', 0.35, opacity]);
    this.map.setPaintProperty(LAYERS.meteoFill, 'fill-color', ['match', level, ...colors, 'rgba(0,0,0,0)'] as never);
    this.map.setPaintProperty(LAYERS.meteoFill, 'fill-opacity', fillOpacity as never);
    this.map.setPaintProperty(LAYERS.meteoLine, 'line-opacity', gridLineOpacity(['case', unlit, 0, GRID_LINE_OPACITY]) as never);
    // Quadrillage : seulement avec les carrés de 4,5 km. Son opacité lit une propriété des carrés, donc
    // MapLibre trace la couche même là où elle ne se voit pas ; hors de sa plage de zoom, il ne la
    // trace pas du tout (19 ms sur 68 par image au zoom 8,2, mesuré sans carte graphique). Sous le
    // zoom des carrés, la teinte des cases suffit à les séparer. Rappelé avec la même plage : sans effet.
    this.map.setLayerZoomRange(LAYERS.meteoLine, WEATHER_SUB_MIN_ZOOM, MAX_LAYER_ZOOM);
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
   * Vue d'ensemble : une pastille sur les secteurs « favorables » de la vue (`pickHotspots`). Rend la
   * meilleure chance estimée de la vue (null : aucun secteur à CHANCE_THRESHOLD ou plus).
   */
  private showHotspots(candidates: readonly Hotspot[], view: Box): number | null {
    const seen = candidates.filter((c) => c.x >= view.west && c.x <= view.east && c.y >= view.south && c.y <= view.north);
    const points: Feature[] = pickHotspots(seen, view.east - view.west).map((c) => ({
      type: 'Feature',
      properties: { p: c.p, color: LEVELS[c.l]?.color ?? '#e07a1f' },
      geometry: { type: 'Point', coordinates: [c.x, c.y] },
    }));
    this.setSource(SOURCES.meteoTop, points);
    const best = Math.max(0, ...seen.map((c) => c.p));
    return best >= CHANCE_THRESHOLD ? best : null;
  }

  /** Plus de carrés de 500 m à montrer (zoom, mode, vue hors de France) : leur relevé est oublié aussi. */
  private dropFine(): void {
    this.fineData = null;
    this.showFine(false);
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

  /** Vide la grille : rien à montrer pour cette vue (zoom trop petit, hors de France, trop de cases). */
  private clearGrid(status: MeteoStatus): void {
    this.data = null;
    this.setSource(SOURCES.meteo, []);
    this.setSource(SOURCES.meteoTop, []);
    this.dropFine();
    this.setStatus(status);
  }

  private async update(): Promise<void> {
    const state = this.store.state;
    if (state.weatherMode === 'off') return;
    this.controller?.abort();
    if (this.offSeason()) return this.showOffSeason();
    if (this.map.getZoom() < WEATHER_MIN_ZOOM) return this.clearGrid({ state: 'zoom' });
    // Vue limitée à l'emprise de la France : pas de météo ailleurs, et jamais trop de cases.
    const b = this.map.getBounds();
    const [west, south, east, north] = FRANCE_BOUNDS;
    const view = {
      west: Math.max(b.getWest(), west),
      south: Math.max(b.getSouth(), south),
      east: Math.min(b.getEast(), east),
      north: Math.min(b.getNorth(), north),
    };
    if (view.west >= view.east || view.south >= view.north) return this.clearGrid({ state: 'outside' });
    const cells = cellsForBounds(view, WEATHER_MAX_CELLS);
    if (!cells) return this.clearGrid({ state: 'many' });
    const controller = new AbortController();
    this.controller = controller;
    // « Chargement… » seulement s'il n'y a encore rien à l'écran pour cette grille.
    if (!this.data) this.setStatus({ state: 'loading' });
    try {
      // Arbres hôtes de chaque carré : sans eux, le pourcentage ne regardait que la météo.
      const hosts = await loadForestShare();
      if (controller.signal.aborted) return;
      // En secours (fichiers météo injoignables), Open-Meteo n'est interrogé que pour les cases qui
      // seront dessinées : en mode indice, pas pour celles dont aucun carré n'est allumé (villes, mer,
      // plaines sans arbres hôtes). Les fichiers communs, eux, se lisent par blocs entiers.
      const shown = this.shown();
      const lit = hosts && shown ? (c: GridCell): boolean => (hostCoverOfCell(c.id, shown)?.best ?? 0) >= 0 : undefined;
      const weather = await weatherForCells(cells, controller.signal, lit);
      if (controller.signal.aborted) return;
      if (weather.tooMany) return this.clearGrid({ state: 'many' });
      this.data = { cells, series: weather.series, shared: weather.shared, hosts, view };
      const index = this.store.state.weatherMode === 'indice';
      this.drawGrid(index ? { state: 'loading' } : { state: 'off' });
      if (index) await this.updateFine(weather.series, controller.signal);
      else this.dropFine();
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) return;
      this.setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Dessine la grille à partir du dernier relevé (`data`) et de l'état du moment : cases entières ou
   * carrés de 4,5 km, pluie ou indice du champignon montré. `fine` : état des carrés de 500 m à
   * annoncer avec.
   */
  private drawGrid(fine: FineStatus): void {
    const data = this.data;
    const state = this.store.state;
    if (!data || state.weatherMode === 'off') return;
    const { series, hosts } = data;
    const month = currentMonth();
    const today = todayKey();
    const index = state.weatherMode === 'indice';
    // L'indice se détaille par carrés de 4,5 km ; la pluie, elle, est la même dans toute la case.
    const subdivide = index && this.map.getZoom() >= WEATHER_SUB_MIN_ZOOM;
    const shown = this.shown();
    let day = '';
    let estimated = false;
    let count = 0;
    let detailed = false;
    const features: Feature[] = [];
    const spots: Hotspot[] = [];
    /**
     * `host` : arbres hôtes du champignon montré dans ce carré (null : inconnus, météo seule) ;
     * `lit` : le carré est allumé (assez d'arbres hôtes, pas d'abord une ville : `isLit`).
     */
    const add = (id: string, weatherOf: () => WeatherSummary, box: Box, sub: 0 | 1, host: { cover: number; quality: number } | null, lit: boolean): void => {
      // En mode indice un carré éteint n'est pas dessiné du tout : il n'est ni calculé ni envoyé.
      if (index && !lit) return;
      const w = weatherOf();
      const properties: Record<string, number> = {
        rain20: Math.round(w.rain20),
        elevation: Math.round(w.elevation),
        sub,
        x: +((box.west + box.east) / 2).toFixed(4),
        y: +((box.south + box.north) / 2).toFixed(4),
      };
      if (index) {
        // Champignon montré seulement : niveau, chance estimée, part d'arbres hôtes (−1 : inconnue).
        // Arbres hôtes connus : l'indice vaut pour eux (qualité moyenne des hôtes du carré). En mode
        // pluie, rien de tout cela : changer de champignon n'y change pas le contenu de la source.
        const score = shown ? scoreMushroom(shown, w, month, host ? { hostQuality: host.quality } : {}) : null;
        properties['l'] = score?.level ?? 0;
        properties['p'] = score?.chance ?? 0;
        properties['c'] = host ? round2(host.cover) : -1;
      }
      features.push({ type: 'Feature', id, properties, geometry: boxPolygon(box) });
    };
    for (const c of data.cells) {
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
        const cell = index && hosts && shown ? hostCoverOfCell(c.id, shown) : null;
        // Allumée dès qu'un de ses carrés l'est (sa teinte suit la moyenne) : une case de plaine avec
        // une seule vraie forêt ne doit pas s'éteindre en vue d'ensemble puis réapparaître en zoomant.
        const lit = !cell || cell.best >= 0;
        const host = cell && lit ? { cover: Math.max(cell.cover, HOST_MIN_COVER), quality: cell.quality } : cell;
        // Case entière : à l'altitude médiane de ses carrés plutôt qu'à celle du point de relevé.
        // (Aux zooms des carrés, une case sans altitudes de carrés, en secours, est ce qu'on a de
        // plus fin : `sub` = 1, elle porte alors son étiquette.)
        add(c.id, () => summaryAtAltitude(w, medianAltitude(s)), c, subdivide ? 1 : 0, host, lit);
        if (index && !subdivide && shown && lit) {
          const spot = this.bestSquare(shown, c, s, w, month, hosts);
          if (spot) spots.push(spot);
        }
      }
    }
    this.setSource(SOURCES.meteo, features);
    let best: number | null;
    if (index && !subdivide) best = this.showHotspots(spots, data.view);
    else {
      // Aux zooms des carrés de 4,5 km (et en mode pluie), pas de pastilles : la couche ne s'affiche
      // pas, inutile de lui renvoyer un contenu à chaque déplacement.
      this.setSource(SOURCES.meteoTop, []);
      const top = index ? Math.max(0, ...features.map((f) => Number(f.properties?.['p'] ?? 0))) : 0;
      best = top >= CHANCE_THRESHOLD ? top : null;
    }
    this.setStatus({ state: 'ok', cells: count, day, estimated, shared: data.shared, sub: detailed, hosts, best, spots: index && !subdivide, fine });
  }

  /**
   * Meilleur carré de 4,5 km d'une case pour le champignon montré : sa chance estimée (à son
   * altitude, pour ses arbres hôtes) et son centre. C'est le chiffre que son étiquette affichera au
   * même endroit en zoomant. null : aucun carré allumé, ou case qui ne peut pas atteindre
   * CHANCE_THRESHOLD (saison × pluie trop faibles : inutile de calculer ses seize carrés).
   * Sans altitudes de carrés (secours) ou sans arbres hôtes connus : la case entière, en son centre.
   */
  private bestSquare(shown: Mushroom, c: GridCell, s: DailySeries, w: WeatherSummary, month: number, hosts: boolean): Hotspot | null {
    if (chanceOf(weatherCeiling(shown, w, month)) < CHANCE_THRESHOLD) return null;
    const centre = (box: Box): { x: number; y: number } => ({ x: +((box.west + box.east) / 2).toFixed(4), y: +((box.south + box.north) / 2).toFixed(4) });
    if (!s.subAltitudes || !hosts) {
      const score = scoreMushroom(shown, summaryAtAltitude(w, medianAltitude(s)), month);
      return { p: score.chance, l: score.level, ...centre(c) };
    }
    let best: Hotspot | null = null;
    let bestScore = -1;
    s.subAltitudes.forEach((z, k) => {
      if (z === null) return;
      const host = hostCover(c.id, k, shown);
      if (!host || !isLit(host)) return;
      const score = scoreMushroom(shown, summaryAtAltitude(w, z), month, { hostQuality: host.quality });
      if (score.score <= bestScore) return;
      bestScore = score.score;
      best = { p: score.chance, l: score.level, ...centre(subBox(c, k)) };
    });
    return best;
  }

  /**
   * Carrés de 500 m à dessiner pour le champignon montré, parmi les carrés boisés du relevé : assez
   * d'arbres hôtes, et en ville seulement les vrais massifs (`fineCellsToDraw`). Les autres ne sont ni
   * calculés, ni envoyés à la carte, et leur altitude n'est pas demandée.
   */
  private fineToDraw({ cells, samples }: FineData): Set<string> {
    const shown = this.shown();
    if (!shown) return new Set();
    return fineCellsToDraw(
      cells.flatMap((c) => {
        const sample = samples.get(c.id);
        const share = sample ? hostShare(shown, sample) : 0;
        if (!share) return [];
        const built = hostCover(c.parentId, subIndexAt(c.lat, c.lon), shown)?.built ?? 0;
        return [{ id: c.id, share, town: built >= BUILT_MAX_COVER }];
      }),
    );
  }

  /**
   * Pour le bilan d'un coin en ville : le carré de 500 m qui contient ce point passe-t-il la règle de
   * ville pour ce champignon (assez boisé, tenu à un massif), d'après le relevé que la carte vient de
   * faire ? null : inconnu (pas de relevé fin de cette vue, ou l'un des neuf carrés autour du point
   * n'est pas relevé en entier, au bord de l'écran) ; le bilan estime alors.
   */
  townSquareKept(lat: number, lon: number, m: Mushroom): boolean | null {
    const samples = this.fineData?.samples;
    if (!samples) return null;
    const i = Math.floor(lat / FINE_STEP_LAT);
    const j = Math.floor(lon / FINE_STEP_LON);
    const around = [];
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const id = `${i + di}:${j + dj}`;
        const sample = samples.get(id);
        if (!sample || sample.length < FINE_POINTS) return null;
        around.push({ id, share: hostShare(m, sample), town: true });
      }
    }
    return fineCellsToDraw(around).has(`${i}:${j}`);
  }

  /** Carrés de 500 m : relevé des forêts et des sols, altitudes IGN, indice de chaque carré. */
  private async updateFine(series: ReadonlyMap<string, DailySeries>, signal: AbortSignal): Promise<void> {
    if (this.map.getZoom() < FINE_MIN_ZOOM) {
      this.dropFine();
      this.setFine({ state: 'zoom' });
      return;
    }
    const b = this.map.getBounds();
    const cells = fineCellsForBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    if (!cells) {
      this.dropFine();
      this.setFine({ state: 'many' });
      return;
    }
    await waitForIdle(this.map, signal);
    const samples = sampleCells(this.map, cells.filter((c) => series.has(c.parentId)));
    const forested = cells.filter((c) => hasForest(samples.get(c.id)));
    // Tous les carrés boisés sont gardés (changer de champignon les redessine dans l'instant), mais
    // l'altitude IGN n'est demandée que pour ceux qui seront dessinés pour le champignon montré :
    // avant le 14/11/2026 elle l'était pour toute forêt, lande ou parc de ville compris.
    const fine: FineData = { cells: forested, samples, series, fallback: false };
    this.fineData = fine;
    const draw = this.fineToDraw(fine);

    const altitudes = altitudeCache();
    const center = this.map.getCenter();
    const distance = (c: FineCell): number => (c.lat - center.lat) ** 2 + ((c.lon - center.lng) * 0.7) ** 2;
    const wanted = forested.filter((c) => draw.has(c.id));
    const missing = wanted.filter((c) => !altitudes.has(c.id)).sort((a, z) => distance(a) - distance(z));
    track('ign.altitude.cacheHits', wanted.length - missing.length);

    let count = this.renderFine(fine);
    if (missing.length) {
      try {
        // Les altitudes arrivent par lots : redessiner à chacun ferait refaire toutes les tuiles des
        // carrés plusieurs fois par seconde. On redessine de temps en temps, puis une fois à la fin.
        let drawn = performance.now();
        try {
          await fetchAltitudes(missing, signal, (start, values) => {
            values.forEach((z, k) => {
              const c = missing[start + k];
              if (c) altitudes.set(c.id, z);
            });
            if (signal.aborted || performance.now() - drawn < FINE_RENDER_EVERY_MS) return;
            drawn = performance.now();
            count = this.renderFine(fine);
          });
        } finally {
          // Une seule écriture dans le navigateur, à la fin ou à l'abandon : le cache entier (jusqu'à
          // 40 000 altitudes) est récrit à chaque fois, sur le fil qui dessine la carte.
          saveAltitudes();
        }
        if (!signal.aborted) count = this.renderFine(fine);
      } catch (error) {
        if (signal.aborted || isAbort(error)) return;
        console.warn('[grille fine]', error);
        fine.fallback = true; // à l'altitude du carré de 4,5 km
        count = this.renderFine(fine);
      }
    }
    if (!signal.aborted) this.setFine({ state: 'ok', count, altitude: !fine.fallback });
  }

  /**
   * Dessine les carrés du relevé à montrer pour le champignon montré (`fineToDraw`). Un carré dont
   * l'altitude IGN n'est pas encore arrivée est dessiné tout de suite à l'altitude de son carré de
   * 4,5 km, puis corrigé : sinon, au changement de champignon, les carrés disparaîtraient le temps de
   * la demande, et la grille des cases repasserait au premier plan. Renvoie le nombre de carrés dessinés.
   */
  private renderFine(fine: FineData): number {
    const { cells, samples, series } = fine;
    const altitudes = altitudeCache();
    const month = currentMonth();
    const today = todayKey();
    const shown = this.shown();
    const draw = this.fineToDraw(fine);
    const features: Feature[] = [];
    for (const c of cells) {
      const parent = series.get(c.parentId);
      const sample = samples.get(c.id);
      if (!shown || !parent || !sample || !draw.has(c.id)) continue;
      const z = altitudes.get(c.id) ?? parent.subAltitudes?.[subIndexAt(c.lat, c.lon)] ?? null;
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
    // Le relevé fin fait foi dès qu'il est fait, même s'il n'a trouvé aucun arbre hôte.
    this.showFine(features.length > 0, true);
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
    case 'offSeason': {
      const m = MUSHROOM_BY_ID.get(indexMushroom(state));
      // (Juste après un changement de mode, l'état d'avant peut encore être celui-ci : ne rien dire de faux.)
      return m && state.weatherMode === 'indice' ? `${m.label} ${offSeasonText(m)} : aucune chance estimée en ce moment.` : '';
    }
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
            : ` Meilleure chance estimée dans la vue : ≈ ${s.best} %${s.spots && s.best < HOTSPOT_MIN_CHANCE ? ` (pastilles à partir de ${HOTSPOT_MIN_CHANCE} %)` : ''}.`;
      // Sans le fichier des parts de forêt, la grille ne sait pas où sont les arbres : autant le dire.
      const blind = state.weatherMode === 'indice' && !s.hosts ? ' Arbres hôtes inconnus pour le moment : tous les secteurs sont colorés, forêt ou non.' : '';
      return `${s.cells} cases de ${CELL_KM} km · ${what}${until}.${best}${blind}${source}${fineText(s.fine)}`;
    }
  }
}
