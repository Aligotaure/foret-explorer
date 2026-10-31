import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import { BDFORET, INITIAL_VIEW, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from './config';
import { countClasses } from './counts';
import { byId, h, toast } from './dom';
import { registerSoilPatterns } from './geology';
import { LegendPanel } from './legend';
import { LAYERS, SOURCES, applyBasemap, applyGeology, applyOpacity, applySelection, applyState, buildStyle } from './mapStyle';
import { MeteoLayer } from './meteoLayer';
import { initSearch } from './search';
import { SpotPanel } from './spot';
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
registerSoilPatterns(map);

// ── Interface ─────────────────────────────────────────────────────────────────
const app = byId('app');
const meteo = new MeteoLayer(map, store);
const legend = new LegendPanel(byId('legend'), store, meteo);
const spot = new SpotPanel(byId('spot'), map, store);
initLegendToggle(store);
initToolbar(map, store);
initSearch(byId<HTMLFormElement>('search'), map);
store.subscribe((state, prev) => {
  app.classList.toggle('legend-open', state.legendOpen);
  // Sur mobile, un seul tiroir à la fois : ouvrir la légende ferme le bilan.
  if (!wideScreen && state.legendOpen && !prev.legendOpen) spot.close();
});
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
  meteo.applyMode();
  store.subscribe((state, prev) => {
    if (state.selected !== prev.selected) applySelection(map, state.selected);
    if (state.opacity !== prev.opacity) applyOpacity(map, state.opacity);
    if (state.basemap !== prev.basemap) applyBasemap(map, state.basemap);
    if (state.geology !== prev.geology) applyGeology(map, state.geology);
    if (state.weatherMode !== prev.weatherMode || state.mushroom !== prev.mushroom) meteo.applyMode();
  });
});
map.on('moveend', () => {
  if (store.state.weatherMode !== 'off') meteo.refresh();
});

// ── Clic sur la carte : bilan du coin (forêt, sol, altitude, météo, champignons) ─
map.on('click', (event) => {
  if (!wideScreen) store.update({ legendOpen: false });
  void spot.open(event.lngLat, event.point);
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
const shownErrors = new Set<string>();
map.on('error', (event) => {
  const sourceId = (event as { sourceId?: string }).sourceId;
  console.warn('[carte]', sourceId ?? '', event.error?.message ?? event.error);
  if (sourceId === SOURCES.bdForet && !shownErrors.has(sourceId)) {
    shownErrors.add(sourceId);
    toast('La BD Forêt ne répond pas pour le moment (réseau ou service IGN).', 5000);
  }
});

// En développement, `map`, `store` et `spot` sont accessibles depuis la console du navigateur.
if (import.meta.env.DEV) Object.assign(window, { map, store, spot });
