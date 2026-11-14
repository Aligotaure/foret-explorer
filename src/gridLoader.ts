/**
 * Calcul des carrés en cours : un petit champignon qui se remplit, et le zoom en pause.
 *
 * Aux échelles de 2 km et moins (voir GRID_BUSY_MIN_ZOOM), les carrés d'une nouvelle vue mettent un
 * moment à arriver : tuiles détaillées des forêts, puis relevé des carrés de 500 m. Pendant ce temps
 * la carte ne montre rien de neuf, et chaque cran de zoom donné en plus relance tout le travail. Tant
 * que `MeteoLayer` annonce le calcul en cours (`onBusy`), le champignon s'affiche et le zoom ne répond
 * plus : molette, double clic, pincement, cadre de zoom, touches + et −, boutons + et −. Se déplacer
 * reste possible, et la pause est bornée par `MeteoLayer` (GRID_BUSY_MAX_MS).
 *
 * Le champignon est décoratif (`aria-hidden`) : la légende annonce déjà l'état de la grille aux
 * lecteurs d'écran, et le répéter à chaque déplacement serait un bavardage. Les boutons de zoom
 * passent en `aria-disabled` (ils gardent le clavier).
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { h } from './dom';
import { icon } from './icons';

/** Le champignon reste plein un instant avant de disparaître : on le voit finir de se remplir. */
const FULL_MS = 220;

const ZOOM_KEYS = new Set(['+', '=', '-', '_']);

export function initGridLoader(
  el: HTMLElement,
  map: MapLibreMap,
  grid: { onBusy(listener: (busy: boolean) => void): void },
  zoomButtons: readonly HTMLButtonElement[],
): void {
  // Deux champignons superposés : le contour, et le même, plein, dans un cache dont la hauteur monte.
  el.replaceChildren(
    h('span', { class: 'grid-loader__icon' }, icon('mushroom'), h('span', { class: 'grid-loader__fill' }, icon('mushroom'))),
    h('span', { class: 'grid-loader__text' }, 'Calcul des carrés…'),
  );

  let locked = false;
  const lock = (on: boolean): void => {
    if (on === locked) return;
    locked = on;
    for (const handler of [map.scrollZoom, map.doubleClickZoom, map.touchZoomRotate, map.boxZoom]) {
      // (`touchZoomRotate.enable()` ne rallume pas la rotation, coupée dans mapView.ts.)
      if (on) handler.disable();
      else handler.enable();
    }
    for (const button of zoomButtons) {
      if (on) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }
  };
  // Touches + et − : arrêtées avant que la carte les reçoive (les flèches, elles, déplacent toujours).
  map.getContainer().addEventListener(
    'keydown',
    (event) => {
      if (locked && ZOOM_KEYS.has(event.key)) event.stopPropagation();
    },
    true,
  );

  let hiding: number | undefined;
  grid.onBusy((busy) => {
    window.clearTimeout(hiding);
    lock(busy);
    if (busy) {
      el.classList.remove('is-full');
      if (el.hidden) el.hidden = false; // l'animation de remplissage repart de zéro
      return;
    }
    if (el.hidden) return;
    el.classList.add('is-full');
    hiding = window.setTimeout(() => {
      el.hidden = true;
      el.classList.remove('is-full');
    }, FULL_MS);
  });
}
