import { DEFAULT_OPACITY, STORAGE_KEY } from './config';
import { ALL_CODES } from './forestClasses';
import { MUSHROOM_BY_ID, type MushroomId } from './mushrooms';

export type BasemapId = 'plan' | 'ortho';

/** Grille météo : masquée, pluie cumulée sur 20 jours, ou indice de pousse du champignon choisi. */
export type WeatherMode = 'off' | 'pluie' | 'indice';

export interface AppState {
  /** Codes `code_tfv` affichés sur la carte. */
  selected: ReadonlySet<string>;
  /** Opacité de la couche forêt (0–1). */
  opacity: number;
  basemap: BasemapId;
  /** Dans la légende, n'afficher que les types présents dans la zone visible. */
  onlyPresent: boolean;
  /** Champignon recherché (« Je cherche… »), ou null. */
  mushroom: MushroomId | null;
  weatherMode: WeatherMode;
  /** Couche « nature du sol » (motifs) affichée. */
  geology: boolean;
  /** Zones protégées affichées (par défaut : oui, la cueillette y est souvent interdite). */
  zones: boolean;
  /** Contours des forêts publiques affichés. */
  publicForests: boolean;
  /** Panneau « Légendes » ouvert (non persisté : dépend de l'écran). */
  legendOpen: boolean;
}

type Listener = (state: AppState, prev: AppState) => void;

/** Mini-store observable : une seule source de vérité pour la carte et l'interface. */
export class Store {
  private current: AppState;
  private readonly listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.current = initial;
  }

  get state(): AppState {
    return this.current;
  }

  update(patch: Partial<AppState>): void {
    const prev = this.current;
    this.current = { ...prev, ...patch };
    for (const listener of this.listeners) listener(this.current, prev);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

interface PersistedState {
  selected?: unknown;
  opacity?: unknown;
  basemap?: unknown;
  onlyPresent?: unknown;
  mushroom?: unknown;
  weatherMode?: unknown;
  geology?: unknown;
  zones?: unknown;
  publicForests?: unknown;
}

/** État initial : préférences sauvegardées si elles existent, sinon valeurs par défaut. */
export function loadInitialState(legendOpen: boolean): AppState {
  const defaults: AppState = {
    selected: new Set(ALL_CODES),
    opacity: DEFAULT_OPACITY,
    basemap: 'plan',
    onlyPresent: false,
    mushroom: null,
    weatherMode: 'off',
    geology: false,
    zones: true,
    publicForests: false,
    legendOpen,
  };

  let saved: PersistedState | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    saved = raw ? (JSON.parse(raw) as PersistedState) : null;
  } catch {
    saved = null; // stockage indisponible (navigation privée…) : on garde les défauts
  }
  if (!saved || typeof saved !== 'object') return defaults;

  const known = new Set(ALL_CODES);
  const selected = Array.isArray(saved.selected)
    ? new Set(saved.selected.filter((c): c is string => typeof c === 'string' && known.has(c)))
    : defaults.selected;
  const opacity =
    typeof saved.opacity === 'number' && saved.opacity >= 0.1 && saved.opacity <= 1
      ? saved.opacity
      : defaults.opacity;
  const basemap: BasemapId = saved.basemap === 'ortho' ? 'ortho' : 'plan';
  const mushroom =
    typeof saved.mushroom === 'string' && MUSHROOM_BY_ID.has(saved.mushroom as MushroomId)
      ? (saved.mushroom as MushroomId)
      : null;
  const weatherMode: WeatherMode =
    saved.weatherMode === 'pluie' || saved.weatherMode === 'indice' ? saved.weatherMode : 'off';

  return {
    ...defaults,
    selected,
    opacity,
    basemap,
    onlyPresent: saved.onlyPresent === true,
    mushroom,
    weatherMode,
    geology: saved.geology === true,
    zones: saved.zones !== false,
    publicForests: saved.publicForests === true,
  };
}

/** Sauvegarde les préférences dans localStorage (sans bloquer si c'est impossible). */
export function persistState(store: Store): void {
  let timer: number | undefined;
  store.subscribe((state) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const data: PersistedState = {
        selected: [...state.selected],
        opacity: state.opacity,
        basemap: state.basemap,
        onlyPresent: state.onlyPresent,
        mushroom: state.mushroom,
        weatherMode: state.weatherMode,
        geology: state.geology,
        zones: state.zones,
        publicForests: state.publicForests,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        /* quota ou stockage bloqué : tant pis, l'appli fonctionne sans */
      }
    }, 300);
  });
}
