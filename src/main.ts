import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import { BDFORET, INITIAL_VIEW, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from './config';
import { countClasses } from './counts';
import { byId, h, toast } from './dom';
import { LegendPanel } from './legend';
import {
  LAYERS,
  SOURCES,
  applyBasemap,
  applyOpacity,
  applySelection,
  applyState,
  buildStyle,
  setHighlight,
} from './mapStyle';
import { forestPopupContent } from './popup';
import { initSearch } from './search';
import { Store, loadInitialState, persistState } from './state';
import { initLegendToggle, initToolbar } from './toolbar';

// ── État ──────────────────────────────────────────────────────────────────────
const wideScreen = window.matchMedia('(min-width: 641px)').matches;
const store = new Store(loadInitialState(wideScreen)); // légende ouverte d'office sur grand écran
persistState(store);

// ── Carte ─────────────────────────────────────────────────────────────────────
const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(store.state),
  center: INITIAL_VIEW.center,
  zoom: INITIAL_VIEW.zoom,
  minZoom: MAP_MIN_ZOOM,
  maxZoom: MAP_MAX_ZOOM,
  hash: 'carte', // position dans l'URL : #carte=zoom/lat/lon
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
});
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');
if (!wideScreen) {
  // Petit écran : attribution repliée derrière le bouton ⓘ pour ne pas masquer la carte.
  map.once('idle', () =>
    document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'),
  );
}

// ── Interface ─────────────────────────────────────────────────────────────────
const app = byId('app');
const legend = new LegendPanel(byId('legend'), store);
initLegendToggle(store);
initToolbar(map, store);
initSearch(byId<HTMLFormElement>('search'), map);
store.subscribe((state) => app.classList.toggle('legend-open', state.legendOpen));
app.classList.toggle('legend-open', store.state.legendOpen);

// Bandeau « Zoomez pour filtrer » sous le zoom des tuiles vectorielles.
const zoomHint = byId('zoom-hint');
const zoomButton = h('button', { class: 'zoom-hint__btn', type: 'button' }, 'Zoomer ici');
zoomButton.addEventListener('click', () => map.easeTo({ zoom: BDFORET.minZoom + 0.5 }));
zoomHint.replaceChildren(h('span', {}, 'Zoomez pour filtrer les types de forêt'), zoomButton);
const updateZoomUi = (): void => {
  const active = map.getZoom() >= BDFORET.minZoom;
  zoomHint.hidden = active;
  legend.setFilteringActive(active);
};
map.on('zoom', updateZoomUi);
updateZoomUi();

// ── Liaison état → carte ──────────────────────────────────────────────────────
map.on('load', () => {
  applyState(map, store.state); // l'état a pu changer pendant le chargement du style
  store.subscribe((state, prev) => {
    if (state.selected !== prev.selected) applySelection(map, state.selected);
    if (state.opacity !== prev.opacity) applyOpacity(map, state.opacity);
    if (state.basemap !== prev.basemap) applyBasemap(map, state.basemap);
  });
});

// ── Clic sur un polygone : bulle d'information + surbrillance ──────────────────
let popup: maplibregl.Popup | null = null;

map.on('click', LAYERS.fill, (event) => {
  const feature = event.features?.[0];
  if (!feature) return;
  const props = (feature.properties ?? {}) as Record<string, unknown>;

  popup?.remove(); // déclenche « close » et efface l'ancienne surbrillance
  setHighlight(map, typeof props['id'] === 'string' ? props['id'] : null);

  const current = new maplibregl.Popup({ className: 'forest-popup', maxWidth: '320px', focusAfterOpen: false })
    .setLngLat(event.lngLat)
    .setDOMContent(forestPopupContent(props, event.lngLat))
    .addTo(map);
  current.on('close', () => {
    if (popup !== current) return;
    popup = null;
    setHighlight(map, null);
  });
  popup = current;
});
map.on('mouseenter', LAYERS.fill, () => {
  map.getCanvas().style.cursor = 'pointer';
});
map.on('mouseleave', LAYERS.fill, () => {
  map.getCanvas().style.cursor = '';
});

// ── Comptage des types présents dans la zone (pastilles de la légende) ─────────
let countsDirty = true;
map.on('moveend', () => {
  countsDirty = true;
});
map.on('sourcedata', (event) => {
  if (event.sourceId === SOURCES.bdForet) countsDirty = true;
});
map.on('idle', () => {
  if (!countsDirty) return;
  countsDirty = false;
  legend.setCounts(countClasses(map));
});

// ── Erreurs réseau ─────────────────────────────────────────────────────────────
let tileErrorShown = false;
map.on('error', (event) => {
  const sourceId = (event as { sourceId?: string }).sourceId;
  console.warn('[carte]', sourceId ?? '', event.error?.message ?? event.error);
  if (sourceId === SOURCES.bdForet && !tileErrorShown) {
    tileErrorShown = true;
    toast('La BD Forêt ne répond pas pour le moment (réseau ou service IGN).', 5000);
  }
});

// En développement, `map` et `store` sont accessibles depuis la console du navigateur.
if (import.meta.env.DEV) Object.assign(window, { map, store });
