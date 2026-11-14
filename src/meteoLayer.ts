import type { Feature, Polygon } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import {
  BUILT_MAX_COVER,
  FINE_MIN_ZOOM,
  FRANCE_BOUNDS,
  GRID_BUSY_MAX_MS,
  GRID_BUSY_MIN_ZOOM,
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
  isSurveyed,
  knownSamples,
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
import { BASE_STEP_LAT, BASE_STEP_LON, CELL_KM, subBox, subIndexAt } from './meteoGrid';
import {
  CHANCE_THRESHOLD,
  HOTSPOT_MIN_CHANCE,
  LEVELS,
  MUSHROOMS,
  MUSHROOM_BY_ID,
  NOTED_MIN_SCORE,
  SHOWN_MIN_SCORE,
  chanceOf,
  currentMonth,
  levelOf,
  noEstimate,
  offSeasonText,
  scoreMushroom,
  squareScore,
  weatherCeiling,
  type Level,
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
  temperaturesAt,
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
  /**
   * `hosts` : carrés qui ont assez d'arbres hôtes du champignon montré ; `count` : ceux qui sont
   * dessinés (chance estimée de 35 % ou plus) ; `best` : la meilleure chance parmi eux (0 : aucun).
   */
  | { state: 'ok'; count: number; hosts: number; best: number; altitude: boolean };

/** Ce que rend un dessin des carrés de 500 m (voir `FineStatus`). */
interface FineDrawn {
  count: number;
  hosts: number;
  best: number;
}

/**
 * Rien à mettre en avant dans la vue pour le champignon montré (aucun carré à CHANCE_THRESHOLD ou
 * plus, à l'échelle affichée) ; `better` : le champignon de saison qui y a la meilleure chance
 * estimée, s'il atteint ce seuil.
 */
export interface GridVerdict {
  mushroom: Mushroom;
  better: { mushroom: Mushroom; level: Level } | null;
}

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
/**
 * Vue dont les carrés de 500 m sont déjà relevés : le temps de laisser passer un geste enchaîné, pas
 * plus (rien n'attend les tuiles, voir `MeteoLayer.updateFine`).
 */
const KNOWN_VIEW_DELAY_MS = 120;

/** Entre l'arrivée des tuiles des carrés et la fin annoncée du calcul : le temps de les dessiner. */
const SETTLE_MS = 60;

/** Dernier zoom d'une couche (plage de zoom du quadrillage). */
const MAX_LAYER_ZOOM = 24;

const round2 = (v: number): number => Math.round(v * 100) / 100;

const sameBox = (a: Box, b: Box): boolean => a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

/** Sources que lit le relevé des carrés de 500 m : les forêts et les sols, rien d'autre. */
const SURVEY_SOURCES = [SOURCES.bdForet, SOURCES.geologie] as const;

/**
 * Attend que les tuiles des forêts et des sols de la vue soient arrivées et dessinées : c'est tout ce
 * que lit le relevé des carrés de 500 m. Avant le 14/11/2026 il attendait le repos de toute la carte
 * (`idle`), donc aussi le fond de carte et les zones protégées : une seule image du fond en retard
 * retenait tous les carrés.
 * Trois temps, parce que MapLibre ne demande les tuiles d'une nouvelle vue qu'en la dessinant :
 *  1. une image, pour qu'il ait demandé les tuiles de la vue en cours (sinon « chargé » parlerait
 *     encore de la vue d'avant, et le relevé lirait des forêts absentes) ;
 *  2. l'arrivée des tuiles des deux sources (une tuile en panne compte comme arrivée : ses carrés
 *     sont relevés avec ce qu'on a, mais pas gardés, voir `noteSurveyTile`) ;
 *  3. une image encore, pour qu'elles soient à l'écran quand `queryRenderedFeatures` les lit.
 */
function waitForSurveyTiles(map: MapLibreMap, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let stop = (): void => {};
    const onAbort = (): void => {
      stop();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    const frame = (then: () => void): void => {
      map.once('render', then);
      stop = () => map.off('render', then);
      map.triggerRepaint();
    };
    // (Source inconnue de la carte : rien à attendre d'elle.)
    const loaded = (): boolean =>
      SURVEY_SOURCES.every((id) => {
        try {
          return map.isSourceLoaded(id) !== false;
        } catch {
          return true;
        }
      });
    const done = (): void => {
      // Un déplacement entre-temps relance tout (`MeteoLayer.load` abandonne ce relevé) ; si des tuiles
      // sont redemandées d'ici là, on attend de nouveau.
      if (!loaded()) return watch();
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const watch = (): void => {
      if (loaded()) return frame(done);
      // (Une tuile qui échoue ne passe pas par `sourcedata` : on écoute aussi les erreurs.)
      const unwatch = (): void => {
        map.off('sourcedata', onData);
        map.off('error', onData);
      };
      const onData = (): void => {
        if (!loaded()) return;
        unwatch();
        frame(done);
      };
      map.on('sourcedata', onData);
      map.on('error', onData);
      stop = unwatch;
    };
    frame(watch);
  });
}

/**
 * Grille météo sur la zone affichée : les cases communes (≈ 18 km), colorées selon la pluie des 20
 * derniers jours ou selon l'indice de pousse. En mode indice, chaque case est détaillée en carrés de
 * 4,5 km à partir du zoom WEATHER_SUB_MIN_ZOOM (même pluie, températures ramenées à l'altitude de
 * chaque carré) ; à partir du zoom FINE_MIN_ZOOM, des carrés de 500 m précisent l'indice là où
 * poussent les arbres hôtes (voir fineGrid.ts). En deçà, des cases entières, et une pastille sur les
 * secteurs « favorables » : la teinte de la case et le chiffre de sa pastille sont ceux de son
 * meilleur carré de 4,5 km (à l'altitude de ce carré), pas ceux de la case entière, qui ne valent
 * qu'à son altitude médiane (en montagne les pastilles disparaîtraient des vallées).
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
  /** Les carrés de la vue sont en cours de calcul (voir `begin`). */
  private verdict: GridVerdict | null = null;
  private readonly verdictListeners = new Set<(verdict: GridVerdict | null) => void>();
  private busy = false;
  private readonly busyListeners = new Set<(busy: boolean) => void>();
  /** Numéro du dernier travail lancé : seul lui peut annoncer que le calcul est fini. */
  private work = 0;
  private busyCap: number | undefined;
  /**
   * Le plafond de la pause a été atteint (réseau ou machine trop lents) : plus de pause tant qu'un
   * calcul ne s'est pas terminé, sinon le visiteur ne pourrait zoomer que d'un cran toutes les 8 s.
   */
  private capped = false;
  /** Retire l'écoute posée par `settle` sur l'arrivée des tuiles. */
  private unwatch: (() => void) | undefined;

  /**
   * La carte a bougé : la grille est refaite une fois la carte posée. `byTracking` : c'est le suivi
   * de la position (GPS) qui l'a déplacée, pas le visiteur : le calcul n'est pas annoncé « en cours »,
   * sinon le zoom serait en pause à chaque nouvelle position, c'est-à-dire tout le temps en marchant.
   */
  readonly refresh = (byTracking = false): void => {
    // Vue dont les carrés de 500 m sont déjà relevés : rien à attendre des tuiles, donc pas de pause
    // du zoom et un délai de repos très court (les carrés viennent du relevé gardé, voir `updateFine`).
    const known = this.knownView();
    if (!byTracking) this.begin(known);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.update(), known ? KNOWN_VIEW_DELAY_MS : REFRESH_DELAY_MS);
  };

  /** Les carrés de 500 m de la vue sont-ils tous déjà relevés (cette visite ou une précédente) ? */
  private knownView(): boolean {
    if (this.store.state.weatherMode !== 'indice' || this.offSeason() || this.map.getZoom() < FINE_MIN_ZOOM) return false;
    const b = this.map.getBounds();
    const view = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    const cells = fineCellsForBounds(view);
    return cells !== null && isSurveyed(cells, view);
  }

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

  /** Prévenu quand le calcul des carrés de la vue commence (vrai) et quand ils sont dessinés (faux). */
  onBusy(listener: (busy: boolean) => void): void {
    this.busyListeners.add(listener);
    listener(this.busy);
  }

  private setBusy(busy: boolean): void {
    if (!busy) window.clearTimeout(this.busyCap);
    if (busy === this.busy) return;
    this.busy = busy;
    for (const l of this.busyListeners) l(busy);
  }

  /**
   * La vue, le mode ou le champignon vient de changer : aux zooms où cela se voit et s'attend
   * (GRID_BUSY_MIN_ZOOM, mode indice, champignon de saison), le calcul des carrés est annoncé « en
   * cours » jusqu'à ce que la carte les ait dessinés (`settle`), GRID_BUSY_MAX_MS au plus. Tout
   * travail lancé avant perd le droit d'annoncer la fin : c'est le suivant qui la dira.
   */
  private begin(known = false): void {
    this.work++;
    this.unwatch?.();
    if (known || this.capped || this.store.state.weatherMode !== 'indice' || this.offSeason() || this.map.getZoom() < GRID_BUSY_MIN_ZOOM) return this.setBusy(false);
    if (this.busy) return; // déjà en pause : le plafond court depuis son début, un déplacement ne le relance pas
    this.busyCap = window.setTimeout(() => {
      this.capped = true;
      this.setBusy(false);
    }, GRID_BUSY_MAX_MS);
    this.setBusy(true);
  }

  /**
   * Le travail `token` a envoyé ses carrés à la carte (ou n'a rien à envoyer) : le calcul est fini
   * quand leurs tuiles et celles des forêts détaillées sont arrivées (pas celles du fond de carte ni
   * des zones : sur un réseau lent, elles feraient durer la pause pour rien). Sans effet si un
   * travail plus récent a pris la suite.
   */
  private settle(token: number, known = false): void {
    if (token !== this.work) return;
    this.unwatch?.();
    // (Carrés tirés du relevé gardé : ils n'attendent pas les forêts détaillées.)
    const sources = known ? [SOURCES.meteo, SOURCES.meteoFine] : [SOURCES.meteo, SOURCES.meteoFine, SOURCES.bdForet];
    const ready = (): boolean =>
      sources.every((id) => {
        try {
          return this.map.isSourceLoaded(id);
        } catch {
          return true;
        }
      });
    const done = (): void => {
      if (token !== this.work) return;
      this.capped = false;
      this.setBusy(false);
    };
    // (Un court instant après l'arrivée des tuiles : le temps que la carte les dessine.)
    if (ready()) {
      window.setTimeout(done, SETTLE_MS);
      return;
    }
    const onData = (): void => {
      if (token !== this.work) return this.unwatch?.();
      if (!ready()) return;
      this.unwatch?.();
      window.setTimeout(done, SETTLE_MS);
    };
    this.map.on('sourcedata', onData);
    this.unwatch = () => {
      this.map.off('sourcedata', onData);
      this.unwatch = undefined;
    };
  }

  private setStatus(status: MeteoStatus): void {
    this.status = status;
    for (const l of this.listeners) l(status);
    this.updateVerdict(status);
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
      this.work++;
      this.unwatch?.();
      this.setBusy(false);
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
    this.begin();
    window.clearTimeout(this.timer);
    void this.update();
  }

  /** Redessine la grille et les carrés de 500 m à partir du dernier relevé, sans rien redemander. */
  private redraw(): void {
    if (this.offSeason()) return this.showOffSeason();
    // Le relevé gardé est celui d'une autre vue (la carte a bougé pendant que la grille était éteinte,
    // ou qu'un champignon hors saison était montré) : rien à redessiner, `update()` le refait. Sans
    // cela, un relevé de la France entière serait découpé en carrés de 4,5 km en arrivant sur une forêt.
    const view = this.viewBox();
    if (!this.data || !view || !sameBox(view, this.data.view)) return;
    const index = this.store.state.weatherMode === 'indice';
    const fine = index && this.map.getZoom() >= FINE_MIN_ZOOM ? this.fineData : null;
    this.drawGrid(!index ? { state: 'off' } : fine ? { state: 'ok', ...this.renderFine(fine), altitude: !fine.fallback } : { state: 'loading' });
  }

  /** Emprise de la vue, limitée à celle de la France (null : la vue est ailleurs). */
  private viewBox(): Box | null {
    const b = this.map.getBounds();
    const [west, south, east, north] = FRANCE_BOUNDS;
    const view = {
      west: Math.max(b.getWest(), west),
      south: Math.max(b.getSouth(), south),
      east: Math.min(b.getEast(), east),
      north: Math.min(b.getNorth(), north),
    };
    return view.west >= view.east || view.south >= view.north ? null : view;
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
    // Sous le seuil, un secteur ne vaut pas le déplacement : pâle, sans étiquette (et pas dessiné du
    // tout sous 35 % : un carré défavorable n'est pas envoyé à la carte, voir `drawGrid`).
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
    // De plus en plus soutenu avec le niveau ; un carré plus couvert d'arbres hôtes est plus opaque.
    // (Le niveau 0, défavorable, n'est plus dans la source : voir `renderFine`.)
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
    // Tout carré de 500 m dessiné porte son pourcentage, « peu probable » compris : sans lui il
    // faudrait juger à la nuance de couleur.
    this.map.setLayoutProperty(LAYERS.meteoFineLabel, 'text-field', ['concat', ['to-string', chance], ' %'] as never);
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

  /** Refait la grille de la vue, et dit quand ses carrés sont à l'écran (voir `begin`). */
  private async update(): Promise<void> {
    const token = ++this.work;
    try {
      // Les carrés de 500 m sont à l'écran dès leur premier dessin : inutile d'attendre leurs altitudes.
      await this.load((known) => this.settle(token, known));
    } finally {
      this.settle(token);
    }
  }

  private async load(drawn: (known?: boolean) => void): Promise<void> {
    const state = this.store.state;
    if (state.weatherMode === 'off') return;
    this.controller?.abort();
    if (this.offSeason()) return this.showOffSeason();
    if (this.map.getZoom() < WEATHER_MIN_ZOOM) return this.clearGrid({ state: 'zoom' });
    // Vue limitée à l'emprise de la France : pas de météo ailleurs, et jamais trop de cases.
    const view = this.viewBox();
    if (!view) return this.clearGrid({ state: 'outside' });
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
      if (index) await this.updateFine(weather.series, controller.signal, drawn);
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
    const add = (
      id: string,
      weatherOf: () => WeatherSummary,
      box: Box,
      sub: 0 | 1,
      host: { cover: number; quality: number } | null,
      lit: boolean,
      known?: { l: number; p: number },
    ): Record<string, number> | null => {
      // En mode indice un carré éteint n'est pas dessiné du tout : il n'est ni calculé ni envoyé.
      if (index && !lit) return null;
      const w = weatherOf();
      // Champignon montré seulement. Arbres hôtes connus : l'indice vaut pour eux (qualité moyenne
      // des hôtes du carré).
      const score = !index || known ? null : shown ? scoreMushroom(shown, w, month, host ? { hostQuality: host.quality } : {}) : null;
      const level = known?.l ?? score?.level ?? 0;
      // Défavorable (moins de 35 %) : pas envoyé non plus. Dessiné, il ne se voyait pas (4 %
      // d'opacité), et la carte suit une seule règle : un carré, c'est une chance qui vaut le coup d'œil.
      if (index && level === 0) return null;
      const properties: Record<string, number> = {
        rain20: Math.round(w.rain20),
        elevation: Math.round(w.elevation),
        sub,
        x: +((box.west + box.east) / 2).toFixed(4),
        y: +((box.south + box.north) / 2).toFixed(4),
      };
      if (index) {
        // Niveau, chance estimée, part d'arbres hôtes (−1 : inconnue). En mode pluie, rien de tout
        // cela : changer de champignon n'y change pas le contenu de la source.
        properties['l'] = level;
        properties['p'] = known?.p ?? score?.chance ?? 0;
        properties['c'] = host ? round2(host.cover) : -1;
      }
      features.push({ type: 'Feature', id, properties, geometry: boxPolygon(box) });
      return properties;
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
        // Vue d'ensemble du mode indice : la case prend le niveau et la chance de son meilleur carré
        // de 4,5 km (à l'altitude de ce carré, pour ses arbres hôtes), ceux que sa pastille affiche et
        // que l'étiquette du carré affichera au zoom 10. Calculée pour la case entière, à son
        // altitude médiane, elle pâlissait en montagne là où une vallée est favorable, ou fonçait là
        // où aucun de ses carrés boisés ne l'est.
        const best = index && !subdivide && shown && cell && lit ? this.bestSquare(shown, c, s, w, month) : null;
        // Sinon (pluie, secours sans altitudes de carrés, arbres hôtes inconnus) : la case entière, à
        // l'altitude médiane de ses carrés plutôt qu'à celle du point de relevé. Aux zooms des carrés,
        // une case de secours est ce qu'on a de plus fin : `sub` = 1, elle porte alors son étiquette.
        const drawn = add(c.id, () => summaryAtAltitude(w, medianAltitude(s)), c, subdivide ? 1 : 0, host, lit, best ?? undefined);
        if (index && !subdivide && drawn) spots.push(best ?? { p: drawn['p'] ?? 0, l: drawn['l'] ?? 0, x: drawn['x'] ?? 0, y: drawn['y'] ?? 0 });
      }
    }
    this.setSource(SOURCES.meteo, features);
    let best: number | null;
    if (index && !subdivide) best = this.showHotspots(spots, data.view);
    else {
      // Aux zooms des carrés de 4,5 km (et en mode pluie), pas de pastilles : la couche ne s'affiche
      // pas, inutile de lui renvoyer un contenu à chaque déplacement.
      this.setSource(SOURCES.meteoTop, []);
      // Meilleure chance de la vue : les carrés des cases qui la touchent débordent de l'écran, on ne
      // garde que ceux dont une partie s'y trouve.
      const { view } = data;
      const seen = (f: Feature): boolean => {
        const x = Number(f.properties?.['x']);
        const y = Number(f.properties?.['y']);
        return x + BASE_STEP_LON / 2 > view.west && x - BASE_STEP_LON / 2 < view.east && y + BASE_STEP_LAT / 2 > view.south && y - BASE_STEP_LAT / 2 < view.north;
      };
      const top = index ? Math.max(0, ...features.filter(seen).map((f) => Number(f.properties?.['p'] ?? 0))) : 0;
      best = top >= CHANCE_THRESHOLD ? top : null;
    }
    this.setStatus({ state: 'ok', cells: count, day, estimated, shared: data.shared, sub: detailed, hosts, best, spots: index && !subdivide, fine });
  }

  /**
   * Meilleur carré de 4,5 km allumé d'une case pour le champignon montré : sa chance estimée (à son
   * altitude, pour ses arbres hôtes), son niveau et son centre. C'est le chiffre que son étiquette
   * affichera au même endroit au zoom des carrés (`squareScore` rend le même indice que
   * `scoreMushroom`). null : pas d'altitudes de carrés (secours), ou aucun carré allumé.
   */
  private bestSquare(shown: Mushroom, c: GridCell, s: DailySeries, w: WeatherSummary, month: number): Hotspot | null {
    if (!s.subAltitudes) return null;
    const ceiling = weatherCeiling(shown, w, month);
    let top = -1;
    let at = -1;
    s.subAltitudes.forEach((z, k) => {
      if (z === null) return;
      const host = hostCover(c.id, k, shown);
      if (!host || !isLit(host)) return;
      const score = squareScore(shown, ceiling, temperaturesAt(w, z), host.quality);
      if (score <= top) return;
      top = score;
      at = k;
    });
    if (at < 0) return null;
    const box = subBox(c, at);
    return { p: chanceOf(top), l: levelOf(top), x: +((box.west + box.east) / 2).toFixed(4), y: +((box.south + box.north) / 2).toFixed(4) };
  }

  /**
   * Carrés de 500 m à dessiner pour le champignon montré, parmi les carrés boisés du relevé : assez
   * d'arbres hôtes, et en ville seulement les vrais massifs (`fineCellsToDraw`). Les autres ne sont ni
   * calculés, ni envoyés à la carte, et leur altitude n'est pas demandée.
   */
  private fineToDraw({ cells, samples }: FineData, shown = this.shown()): Set<string> {
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
  private async updateFine(series: ReadonlyMap<string, DailySeries>, signal: AbortSignal, drawn: (known?: boolean) => void): Promise<void> {
    if (this.map.getZoom() < FINE_MIN_ZOOM) {
      this.dropFine();
      this.setFine({ state: 'zoom' });
      return;
    }
    const b = this.map.getBounds();
    const view = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    const cells = fineCellsForBounds(view);
    if (!cells) {
      this.dropFine();
      this.setFine({ state: 'many' });
      return;
    }
    // Relevés déjà gardés (cette visite ou une précédente) : ils se dessinent sans attendre les tuiles
    // des forêts, qui ne servent plus qu'aux carrés jamais vus en entier.
    const toSurvey = cells.filter((c) => series.has(c.parentId));
    const known = knownSamples(toSurvey);
    const surveyed = isSurveyed(toSurvey, view);
    let samples: ReadonlyMap<string, Sample[]> = known;
    if (known.size < toSurvey.length) {
      // Vue déjà relevée (il ne manque que des carrés du bord de l'écran, jamais vus en entier) : on
      // dessine tout de suite ce qu'on sait, plus ce qui est affiché en ce moment (un carré du bord,
      // relevé en partie, ne disparaît pas le temps du nouveau relevé). Sinon on attend comme avant :
      // quelques carrés connus dans un coin ne valent ni d'estomper la grille des cases, ni de faire
      // refaire deux fois les tuiles des carrés.
      if (surveyed) {
        const seen = new Map(known);
        for (const c of toSurvey) {
          const shown = seen.has(c.id) ? undefined : this.fineData?.samples.get(c.id);
          if (shown) seen.set(c.id, shown);
        }
        const early: FineData = { cells: toSurvey.filter((c) => hasForest(seen.get(c.id))), samples: seen, series, fallback: false };
        this.fineData = early;
        this.renderFine(early);
        drawn(true);
      }
      await waitForSurveyTiles(this.map, signal);
      samples = sampleCells(this.map, toSurvey);
    }
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
    // … et seulement là où un carré peut être dessiné : si la saison et la pluie de la case plafonnent
    // l'indice sous le niveau montré, aucune altitude n'y changera rien (elle ne joue que sur la
    // température, qui ne fait que baisser l'indice).
    const reach = this.reach(series);
    const wanted = forested.filter((c) => draw.has(c.id) && reach(c.parentId));
    const missing = wanted.filter((c) => !altitudes.has(c.id)).sort((a, z) => distance(a) - distance(z));
    track('ign.altitude.cacheHits', wanted.length - missing.length);

    let result = this.renderFine(fine);
    drawn(surveyed);
    if (missing.length) {
      try {
        // Les altitudes arrivent par lots : redessiner à chacun ferait refaire toutes les tuiles des
        // carrés plusieurs fois par seconde. On redessine de temps en temps, puis une fois à la fin.
        let drawn = performance.now();
        let received = false;
        try {
          await fetchAltitudes(missing, signal, (start, values) => {
            values.forEach((z, k) => {
              const c = missing[start + k];
              if (c) altitudes.set(c.id, z);
            });
            received = true;
            if (signal.aborted || performance.now() - drawn < FINE_RENDER_EVERY_MS) return;
            drawn = performance.now();
            result = this.renderFine(fine);
          });
        } finally {
          // Une seule écriture dans le navigateur, à la fin ou à l'abandon, et seulement si un lot est
          // arrivé : le cache entier (jusqu'à 40 000 altitudes) est récrit à chaque fois, sur le fil
          // qui dessine la carte.
          if (received) saveAltitudes();
        }
        if (!signal.aborted) result = this.renderFine(fine);
      } catch (error) {
        if (signal.aborted || isAbort(error)) return;
        console.warn('[grille fine]', error);
        fine.fallback = true; // à l'altitude du carré de 4,5 km
        result = this.renderFine(fine);
      }
    }
    if (!signal.aborted) this.setFine({ state: 'ok', ...result, altitude: !fine.fallback });
  }

  /**
   * Dessine les carrés du relevé à montrer pour le champignon montré (`fineToDraw`). Un carré dont
   * l'altitude IGN n'est pas encore arrivée est dessiné tout de suite à l'altitude de son carré de
   * 4,5 km, puis corrigé : sinon, au changement de champignon, les carrés disparaîtraient le temps de
   * la demande, et la grille des cases repasserait au premier plan. Renvoie le nombre de carrés dessinés.
   */
  private renderFine(fine: FineData): FineDrawn {
    const { cells, samples, series } = fine;
    const altitudes = altitudeCache();
    const month = currentMonth();
    const today = todayKey();
    const shown = this.shown();
    const draw = this.fineToDraw(fine);
    const reach = this.reach(series);
    const features: Feature[] = [];
    let best = 0;
    for (const c of cells) {
      const parent = series.get(c.parentId);
      const sample = samples.get(c.id);
      if (!shown || !parent || !sample || !draw.has(c.id)) continue;
      // Case dont la saison et la pluie plafonnent l'indice sous le niveau montré : rien à calculer.
      if (!reach(c.parentId)) continue;
      const z = altitudes.get(c.id) ?? parent.subAltitudes?.[subIndexAt(c.lat, c.lon)] ?? null;
      const s = scoreFineCell(shown, summarize(atAltitude(parent, z), today), month, sample);
      // Défavorable (moins de 35 %) : pas dessiné. Avant le 14/11/2026 il l'était en contour seul,
      // des « carrés vides » que personne ne savait lire.
      if (!s || s.level === 0) continue;
      best = Math.max(best, chanceOf(s.score));
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
    return { count: features.length, hosts: draw.size, best };
  }

  /**
   * Dit, case par case, si l'indice du champignon peut y atteindre `min` : saison × pluie de la case
   * (`weatherCeiling`) en est le plafond, quels que soient l'altitude, les arbres et le sol du carré
   * (tous les autres facteurs valent 1 au plus). Calculé une fois par case.
   */
  private reach(series: ReadonlyMap<string, DailySeries>, m = this.shown(), min = SHOWN_MIN_SCORE): (cellId: string) => boolean {
    const month = currentMonth();
    const today = todayKey();
    const known = new Map<string, boolean>();
    return (cellId) => {
      let can = known.get(cellId);
      if (can === undefined) {
        const s = series.get(cellId);
        can = Boolean(m && s) && weatherCeiling(m as Mushroom, summarize(s as DailySeries, today), month) >= min;
        known.set(cellId, can);
      }
      return can;
    };
  }

  // ── Rien à mettre en avant dans la vue : le dire, et proposer mieux ──────────────────────────

  /** Prévenu quand la vue n'a rien à mettre en avant pour le champignon montré (null : elle a quelque chose). */
  onVerdict(listener: (verdict: GridVerdict | null) => void): void {
    this.verdictListeners.add(listener);
    listener(this.verdict);
  }

  /**
   * Après chaque état de la grille : la vue montre-t-elle au moins un carré à CHANCE_THRESHOLD ou
   * plus pour le champignon choisi ? On juge ce qui est affiché à cette échelle : carrés de 500 m
   * quand leur relevé est fait, carrés de 4,5 km sinon. Sous le zoom des carrés, sans les arbres
   * hôtes ou en secours, on ne dit rien.
   * Pendant le relevé des carrés de 500 m, on ne sait pas encore, sauf si la saison et la pluie de
   * toutes les cases de la vue plafonnent l'indice sous ce seuil : alors aucun carré ne l'atteindra,
   * le bandeau peut le dire tout de suite (proposition tirée des carrés de 4,5 km, précisée ensuite).
   * Sans cela il resterait, le temps du relevé, celui de la vue qu'on vient de quitter.
   */
  private updateVerdict(status: MeteoStatus): void {
    const shown = this.shown();
    const data = this.data;
    let verdict: GridVerdict | null = null;
    if (status.state === 'ok' && shown && data && this.store.state.weatherMode === 'indice' && status.hosts && status.sub && this.map.getZoom() >= WEATHER_SUB_MIN_ZOOM) {
      if (status.fine.state === 'loading') {
        const reach = this.reach(data.series, shown, NOTED_MIN_SCORE);
        if (!data.cells.some((c) => reach(c.id))) verdict = { mushroom: shown, better: this.bestOther(shown, data, null) };
      } else {
        const fine = status.fine.state === 'ok' ? this.fineData : null;
        const empty = status.fine.state === 'ok' && fine ? status.fine.best < CHANCE_THRESHOLD : status.best === null;
        if (empty) verdict = { mushroom: shown, better: this.bestOther(shown, data, fine) };
      }
    }
    const same = (a: GridVerdict | null, b: GridVerdict | null): boolean =>
      a?.mushroom.id === b?.mushroom.id && a?.better?.mushroom.id === b?.better?.mushroom.id && a?.better?.level === b?.better?.level;
    if (same(verdict, this.verdict)) return;
    this.verdict = verdict;
    for (const l of this.verdictListeners) l(verdict);
  }

  /**
   * Le champignon de saison qui a la meilleure chance estimée dans la vue, s'il atteint
   * CHANCE_THRESHOLD : calculé comme la carte le dessinerait s'il était choisi (mêmes carrés, mêmes
   * règles), pour que la proposition tienne parole une fois cliquée. Aucune donnée en plus : fichiers
   * météo, parts de forêt et relevés sont les mêmes pour tous les champignons ; seul le calcul
   * change, et une case dont le plafond (saison × pluie) est sous le seuil n'est pas regardée.
   */
  private bestOther(shown: Mushroom, data: GridData, fine: FineData | null): GridVerdict['better'] {
    const month = currentMonth();
    const today = todayKey();
    // Résumés météo gardés d'un champignon à l'autre : ils ne dépendent pas de lui.
    const cellWeather = new Map<string, WeatherSummary>();
    const squareWeather = new Map<string, WeatherSummary>();
    const weatherOf = (id: string, s: DailySeries): WeatherSummary => {
      let w = cellWeather.get(id);
      if (!w) cellWeather.set(id, (w = summarize(s, today)));
      return w;
    };
    const altitudes = altitudeCache();
    let better: GridVerdict['better'] = null;
    let top = 0;
    for (const m of MUSHROOMS) {
      if (m.id === shown.id || noEstimate(m, month)) continue;
      let score = 0;
      if (fine) {
        const draw = this.fineToDraw(fine, m);
        for (const c of fine.cells) {
          if (!draw.has(c.id)) continue;
          const parent = fine.series.get(c.parentId);
          const sample = fine.samples.get(c.id);
          if (!parent || !sample || weatherCeiling(m, weatherOf(c.parentId, parent), month) < NOTED_MIN_SCORE) continue;
          let w = squareWeather.get(c.id);
          if (!w) {
            const z = altitudes.get(c.id) ?? parent.subAltitudes?.[subIndexAt(c.lat, c.lon)] ?? null;
            squareWeather.set(c.id, (w = summarize(atAltitude(parent, z), today)));
          }
          score = Math.max(score, scoreFineCell(m, w, month, sample)?.score ?? 0);
        }
      } else {
        const { view } = data;
        for (const c of data.cells) {
          const s = data.series.get(c.id);
          if (!s?.subAltitudes) continue;
          const w = weatherOf(c.id, s);
          const ceiling = weatherCeiling(m, w, month);
          if (ceiling < NOTED_MIN_SCORE) continue;
          s.subAltitudes.forEach((z, k) => {
            if (z === null) return;
            const host = hostCover(c.id, k, m);
            if (!host || !isLit(host)) return;
            // (Comme « meilleure chance de la vue » : seulement les carrés dont une partie est à l'écran.)
            const box = subBox(c, k);
            if (box.east <= view.west || box.west >= view.east || box.north <= view.south || box.south >= view.north) return;
            score = Math.max(score, squareScore(m, ceiling, temperaturesAt(w, z), host.quality));
          });
        }
      }
      const chance = chanceOf(score);
      if (chance >= CHANCE_THRESHOLD && chance > top) {
        top = chance;
        better = { mushroom: m, level: levelOf(score) };
      }
    }
    return better;
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
        ` ${fine.hosts} carré${fine.hosts > 1 ? 's' : ''} de 500 m avec arbres hôtes` +
        (fine.count === fine.hosts ? '.' : fine.count ? `, dont ${fine.count} à 35 % ou plus.` : `, aucun à 35 % ou plus.`) +
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
      const blind = state.weatherMode === 'indice' && !s.hosts ? ' Arbres hôtes inconnus pour le moment : les secteurs sont colorés, forêt ou non.' : '';
      return `${s.cells} cases de ${CELL_KM} km · ${what}${until}.${best}${blind}${source}${fineText(s.fine)}`;
    }
  }
}
