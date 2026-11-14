import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { GEOCODING_COMPLETION_URL } from './config';
import { track } from './metrics';
import { debounce, h, toast } from './dom';
import { icon } from './icons';

/** Une proposition du service d'autocomplétion de la Géoplateforme. */
export interface Suggestion {
  /** Longitude (WGS84). */
  x: number;
  /** Latitude (WGS84). */
  y: number;
  fulltext: string;
  /** "StreetAddress" ou "PositionOfInterest". */
  country?: string;
  kind?: string;
  poiType?: string[];
}

function isSuggestion(value: unknown): value is Suggestion {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return typeof o['x'] === 'number' && typeof o['y'] === 'number' && typeof o['fulltext'] === 'string';
}

/** Adresses et lieux-dits (sommets, hameaux, forêts…) correspondant au texte saisi. */
export async function fetchSuggestions(text: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const url = new URL(GEOCODING_COMPLETION_URL);
  url.searchParams.set('text', text);
  url.searchParams.set('type', 'StreetAddress,PositionOfInterest');
  url.searchParams.set('maximumResponses', '6');
  track('ign.geocoding.requests');
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Géocodage : HTTP ${response.status}`);
    const data = (await response.json()) as { results?: unknown };
    return Array.isArray(data.results) ? data.results.filter(isSuggestion) : [];
  } catch (error) {
    if (!signal?.aborted) track('ign.geocoding.errors');
    throw error;
  }
}

function zoomFor(s: Suggestion): number {
  if (s.country === 'StreetAddress') return 16;
  if (s.poiType?.includes('commune')) return 13;
  return 14.5;
}

function kindLabel(s: Suggestion): string {
  if (s.country === 'StreetAddress') return 'Adresse';
  const kind = s.poiType?.find((t) => t !== 'administratif') ?? s.kind;
  return kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Lieu';
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

/** Barre « Rechercher un lieu… » avec suggestions au clavier et à la souris. */
export function initSearch(form: HTMLFormElement, map: MapLibreMap, onChoose: () => void = () => {}): void {
  const input = form.querySelector<HTMLInputElement>('.search__input');
  const list = form.querySelector<HTMLUListElement>('.search__results');
  const submit = form.querySelector<HTMLButtonElement>('.search__submit');
  if (!input || !list || !submit) throw new Error('Barre de recherche incomplète dans index.html');
  submit.append(icon('search'));
  submit.addEventListener('mousedown', (e) => e.preventDefault()); // garde les suggestions ouvertes

  let suggestions: Suggestion[] = [];
  let active = -1;
  let requestId = 0;
  let controller: AbortController | null = null;
  let marker: maplibregl.Marker | null = null;

  const render = (): void => {
    list.replaceChildren(
      ...suggestions.map((s, i) => {
        const option = h(
          'li',
          { id: `search-option-${i}`, class: 'search__option', role: 'option', 'aria-selected': String(i === active) },
          h('span', { class: 'search__option-label' }, s.fulltext),
          h('span', { class: 'search__option-kind' }, kindLabel(s)),
        );
        option.addEventListener('mousedown', (e) => e.preventDefault()); // garde le focus dans le champ
        option.addEventListener('click', () => choose(s));
        return option;
      }),
    );
    const open = suggestions.length > 0;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (open && active >= 0) input.setAttribute('aria-activedescendant', `search-option-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const reset = (): void => {
    requestId++;
    controller?.abort();
    suggestions = [];
    active = -1;
    render();
  };

  const choose = (s: Suggestion): void => {
    reset();
    input.value = s.fulltext;
    input.blur(); // referme le clavier sur mobile
    onChoose();
    map.flyTo({ center: [s.x, s.y], zoom: zoomFor(s), essential: true });
    marker ??= new maplibregl.Marker({ color: '#6a6af4' });
    marker.setLngLat([s.x, s.y]).addTo(map);
  };

  const suggest = debounce(async (text: string) => {
    const id = ++requestId;
    controller?.abort();
    controller = new AbortController();
    try {
      const results = await fetchSuggestions(text, controller.signal);
      if (id !== requestId) return; // une saisie plus récente a pris le relais
      suggestions = results;
      active = -1;
      render();
    } catch (error) {
      if (id !== requestId || isAbort(error)) return;
      reset();
      toast('Recherche indisponible pour le moment (réseau ?)');
    }
  }, 250);

  input.addEventListener('input', () => {
    const text = input.value.trim();
    if (text.length < 3) reset();
    else suggest(text);
  });

  input.addEventListener('keydown', (event) => {
    const count = suggestions.length;
    if (event.key === 'Escape') {
      if (count) reset();
      else input.blur();
      return;
    }
    if (!count) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + count) % count;
      render();
    }
  });

  input.addEventListener('blur', reset);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const picked = suggestions[active] ?? suggestions[0];
    if (picked) {
      choose(picked);
      return;
    }
    const text = input.value.trim();
    if (text.length < 2) return;
    try {
      const [first] = await fetchSuggestions(text);
      if (first) choose(first);
      else toast(`Aucun lieu trouvé pour « ${text} »`);
    } catch {
      toast('Recherche indisponible pour le moment (réseau ?)');
    }
  });
}
