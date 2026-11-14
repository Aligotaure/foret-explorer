import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { byId, h, toast } from './dom';
import { ALL_CODES } from './forestClasses';
import { icon, type IconName } from './icons';
import { ABOUT_URL } from './legal';
import type { AppState, Store } from './state';

function toolButton(name: IconName, label: string): HTMLButtonElement {
  return h('button', { class: 'btn-square', type: 'button', 'aria-label': label, title: label }, icon(name));
}

function setLabel(button: HTMLButtonElement, label: string): void {
  button.setAttribute('aria-label', label);
  button.title = label;
}

/** Bouton en haut à gauche : ouvre/ferme la légende ; pastille = nombre de types affichés. */
export function initLegendToggle(store: Store): void {
  const button = byId<HTMLButtonElement>('legend-toggle');
  const badge = h('span', { class: 'badge', 'aria-hidden': 'true' });
  button.append(icon('legend'), badge);
  button.addEventListener('click', () => store.update({ legendOpen: !store.state.legendOpen }));

  const sync = (state: AppState): void => {
    button.setAttribute('aria-expanded', String(state.legendOpen));
    button.classList.toggle('is-active', state.legendOpen);
    setLabel(button, state.legendOpen ? 'Masquer la légende' : 'Afficher la légende');
    const n = state.selected.size;
    badge.textContent = String(n);
    badge.hidden = n === ALL_CODES.length; // pastille seulement quand un filtre est actif
  };
  store.subscribe(sync);
  sync(store.state);
}

/**
 * Barres d'outils de droite : fond de carte, géolocalisation, plein écran, zoom. Rend les deux boutons
 * de zoom, que `gridLoader.ts` met en pause pendant le calcul des carrés.
 */
export function initToolbar(map: MapLibreMap, store: Store): HTMLButtonElement[] {
  const basemap = toolButton('map', 'Fond de carte');
  basemap.addEventListener('click', () =>
    store.update({ basemap: store.state.basemap === 'plan' ? 'ortho' : 'plan' }),
  );

  // Contrôle natif de MapLibre (point bleu + cercle de précision) ; son bouton est masqué
  // en CSS et piloté par le nôtre.
  const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showAccuracyCircle: true,
    fitBoundsOptions: { maxZoom: 15 },
  });
  map.addControl(geolocate, 'top-right');
  const locate = toolButton('locate', 'Me localiser');
  locate.addEventListener('click', () => {
    if (!window.isSecureContext || !('geolocation' in navigator)) {
      toast('Géolocalisation impossible ici : ouvrez la carte en https (ou sur localhost).', 5000);
      return;
    }
    if (!geolocate.trigger()) toast('Géolocalisation pas encore prête, réessayez dans un instant');
  });
  geolocate.on('trackuserlocationstart', () => locate.setAttribute('aria-pressed', 'true'));
  geolocate.on('trackuserlocationend', () => locate.setAttribute('aria-pressed', 'false'));
  geolocate.on('error', () => {
    locate.setAttribute('aria-pressed', 'false');
    toast('Position introuvable (autorisation refusée ou signal GPS absent)');
  });

  // Conditions, mentions légales, confidentialité et conseils de cueillette.
  const aboutLabel = 'À propos : conseils, conditions, mentions légales';
  const about = h('a', { class: 'btn-square', href: ABOUT_URL, 'aria-label': aboutLabel, title: aboutLabel }, icon('info'));

  byId('toolbar-top').append(basemap, locate, about);

  const bottom = byId('toolbar-bottom');
  if (document.fullscreenEnabled) {
    const fullscreen = toolButton('expand', 'Plein écran');
    fullscreen.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => toast('Plein écran indisponible'));
    });
    document.addEventListener('fullscreenchange', () => {
      const on = document.fullscreenElement !== null;
      fullscreen.replaceChildren(icon(on ? 'shrink' : 'expand'));
      setLabel(fullscreen, on ? 'Quitter le plein écran' : 'Plein écran');
    });
    bottom.append(fullscreen);
  }
  // En pause (`aria-disabled`, pas `disabled` : le bouton garde le clavier), un clic ne fait rien.
  const paused = (button: HTMLButtonElement): boolean => button.getAttribute('aria-disabled') === 'true';
  const zoomIn = toolButton('plus', 'Zoomer');
  zoomIn.addEventListener('click', () => {
    if (!paused(zoomIn)) map.zoomIn();
  });
  const zoomOut = toolButton('minus', 'Dézoomer');
  zoomOut.addEventListener('click', () => {
    if (!paused(zoomOut)) map.zoomOut();
  });
  bottom.append(h('div', { class: 'toolbar__group' }, zoomIn, zoomOut));

  const sync = (state: AppState): void => {
    const ortho = state.basemap === 'ortho';
    basemap.setAttribute('aria-pressed', String(ortho));
    setLabel(basemap, ortho ? 'Revenir au Plan IGN' : 'Afficher les photographies aériennes');
  };
  store.subscribe(sync);
  sync(store.state);
  return [zoomIn, zoomOut];
}
