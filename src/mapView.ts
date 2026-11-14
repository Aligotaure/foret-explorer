/**
 * La vue « Carte » : état, carte MapLibre, panneaux, liaison état → carte.
 *
 * Module chargé par main.ts à la première ouverture de la vue (jamais pour la seule vue Analytics).
 * Les feuilles de style et l'avertissement d'ouverture sont du ressort de main.ts.
 */
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { BDFORET, FRANCE_BOUNDS, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from './config';
import { countClasses } from './counts';
import { byId, debounce, h, toast } from './dom';
import { registerSoilPatterns } from './geology';
import { LegendPanel } from './legend';
import {
  LAYERS,
  SOURCES,
  applyBasemap,
  applyGeology,
  applyOpacity,
  applySelection,
  applyState,
  applyZones,
  buildStyle,
} from './mapStyle';
import { MeteoLayer } from './meteoLayer';
import { flush, sessionTotals, startMetrics, track, trackMapRequest } from './metrics';
import { initSearch } from './search';
import { SpotPanel } from './spot';
import { Store, loadInitialState, persistState } from './state';
import { STORAGE_PREFIX } from './legal';
import { initLegendToggle, initToolbar } from './toolbar';
import { currentView, onViewChange, onViewLeave } from './view';
import { loadZonesInfo, noteZonesError, registerZonePattern } from './zones';

// ── État ──────────────────────────────────────────────────────────────────────
const wideScreen = window.matchMedia('(min-width: 641px)').matches;
const store = new Store(loadInitialState(wideScreen)); // légende ouverte d'office sur grand écran
persistState(store);
startMetrics(!wideScreen);
void loadZonesInfo();

// ── Carte ─────────────────────────────────────────────────────────────────────
// Vue de départ : celle de l'adresse (#carte=zoom/lat/lon), sinon la dernière vue sur cet appareil,
// sinon la France entière.
const VIEW_KEY = `${STORAGE_PREFIX}vue`;
function savedView(): { center: [number, number]; zoom: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as { c?: unknown; z?: unknown } | null;
    const [lng, lat] = Array.isArray(v?.c) ? (v.c as unknown[]) : [];
    if (typeof lng === 'number' && typeof lat === 'number' && typeof v?.z === 'number' && Math.abs(lat) < 85 && Math.abs(lng) <= 180) {
      return { center: [lng, lat], zoom: v.z };
    }
  } catch {
    /* stockage indisponible */
  }
  return null;
}
const lastView = savedView();
// Précédent ou Suivant vers une entrée « Analytics » : la carte, masquée, ne doit pas repartir à la
// position que portait cette entrée quand on l'avait quittée (MapLibre suit `carte=` à chaque
// changement d'adresse). Cet écouteur, posé avant la carte, passe donc avant le sien et l'arrête ;
// l'entrée reprend alors la position réelle, que le lien « Carte » de l'îlot gardera.
window.addEventListener('hashchange', (event) => {
  if (currentView() !== 'analytics') return;
  event.stopImmediatePropagation();
  map.fire('moveend'); // MapLibre réécrit `carte=` dans l'adresse
});
// Tuiles servies par le site (nature du sol, zones) : archives PMTiles lues par morceaux.
maplibregl.addProtocol('pmtiles', new Protocol().tile);
const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(store.state),
  ...(lastView ?? { bounds: FRANCE_BOUNDS, fitBoundsOptions: { padding: 16 } }),
  minZoom: MAP_MIN_ZOOM,
  maxZoom: MAP_MAX_ZOOM,
  hash: 'carte', // position dans l'URL : #carte=zoom/lat/lon
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  // Pas de fondu des étiquettes : il fait redessiner la carte pendant 0,3 s après chaque changement,
  // soit plusieurs images de trop sur un appareil sans carte graphique (voir meteoLayer.ts).
  fadeDuration: 0,
  // Compte les tuiles et polices demandées (consommation des API), sans modifier la requête.
  transformRequest: (url, resourceType) => {
    trackMapRequest(url, resourceType);
    return { url };
  },
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
registerZonePattern(map);

// ── Vue Analytics : la carte reste chargée, masquée (position, légende et bilan intacts) ──
// En la quittant par l'îlot, un déplacement en cours s'arrête : sa position d'arrivée est alors écrite
// dans l'adresse de la carte, que le bouton Précédent du navigateur retrouvera (sauf si MapLibre vient
// d'écrire l'adresse : il attend 0,3 s entre deux écritures, et la suivante arrive trop tard).
onViewLeave((view) => {
  if (view === 'map') map.stop();
});
onViewChange((view) => {
  if (view === 'map') map.triggerRepaint(); // image fraîche au retour, quel que soit le navigateur
});

// ── Interface ─────────────────────────────────────────────────────────────────
const app = byId('app');
const meteo = new MeteoLayer(map, store);
const legend = new LegendPanel(byId('legend'), store, meteo);
const spot = new SpotPanel(byId('spot'), map, store, meteo);
initLegendToggle(store);
initToolbar(map, store);
initSearch(byId<HTMLFormElement>('search'), map);
store.subscribe((state, prev) => {
  app.classList.toggle('legend-open', state.legendOpen);
  // Sur mobile, un seul tiroir à la fois : ouvrir la légende ferme le bilan.
  if (!wideScreen && state.legendOpen && !prev.legendOpen) spot.close();
  // Le bilan ouvert suit le champignon recherché (carte dépliée, mention « recherché »).
  if (state.mushroom !== prev.mushroom) spot.refresh();
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
    if (state.opacity !== prev.opacity) applyOpacity(map, state.opacity, meteo.dimsForests);
    if (state.basemap !== prev.basemap) applyBasemap(map, state.basemap);
    if (state.geology !== prev.geology) applyGeology(map, state.geology);
    if (state.zones !== prev.zones || state.publicForests !== prev.publicForests) applyZones(map, state);
    if (state.weatherMode !== prev.weatherMode || state.mushroom !== prev.mushroom) meteo.applyMode();
  });
});
map.on('moveend', () => {
  if (store.state.weatherMode !== 'off') meteo.refresh();
});
// Dernière vue, reprise à la prochaine visite (sans #carte= dans l'adresse).
map.on(
  'moveend',
  debounce(() => {
    const c = map.getCenter();
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ c: [+c.lng.toFixed(5), +c.lat.toFixed(5)], z: +map.getZoom().toFixed(2) }));
    } catch {
      /* stockage indisponible : on repartira de la France entière */
    }
  }, 1000),
);

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
  // (Une tuile absente d'une archive du site, en mer ou à l'étranger, n'est pas une erreur : le
  // protocole rend alors une tuile vide.)
  // BD Forêt : l'IGN répond 404 pour une tuile sans forêt (ville, mer, étranger) : pas une panne.
  const status = (event.error as { status?: number } | undefined)?.status;
  if (status === 404 && (sourceId === SOURCES.bdForet || sourceId === SOURCES.bdForetRaster)) return;
  console.warn('[carte]', sourceId ?? '', event.error?.message ?? event.error);
  if (sourceId === SOURCES.geologie) track('pages.geology.errors');
  else if (sourceId === SOURCES.zones) {
    // Tuile des zones en panne (réseau…) : le bilan ne doit plus affirmer qu'une forêt est privée.
    track('pages.zones.errors');
    noteZonesError();
  } else if (sourceId) track('ign.tiles.errors');
  if (sourceId === SOURCES.bdForet && !shownErrors.has(sourceId)) {
    shownErrors.add(sourceId);
    toast('La BD Forêt ne répond pas pour le moment (réseau ou service IGN).', 5000);
  }
});

// En développement, `map`, `store`, `spot`, `meteo` et `metrics.totals()` sont accessibles depuis la console.
if (import.meta.env.DEV) Object.assign(window, { map, store, spot, meteo, metrics: { totals: sessionTotals, flush } });
