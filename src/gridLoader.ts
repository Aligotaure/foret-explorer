/**
 * Calcul des carrés en cours : un petit champignon qui se remplit, et le zoom en pause.
 *
 * Aux échelles de 2 km et moins (voir GRID_BUSY_MIN_ZOOM), les carrés d'une nouvelle vue mettent un
 * moment à arriver : tuiles détaillées des forêts, puis relevé des carrés de 500 m. Pendant ce temps
 * la carte ne montre rien de neuf, et chaque cran de zoom donné en plus relance tout le travail. Tant
 * que `MeteoLayer` annonce le calcul en cours (`onBusy`), le champignon s'affiche et le zoom ne répond
 * plus : molette, pincement, double clic, cadre de zoom, touches + et −, boutons + et −. Se déplacer
 * reste possible, et la pause est bornée par `MeteoLayer` (GRID_BUSY_MAX_MS).
 *
 * Les gestes sont arrêtés avant que MapLibre les reçoive (écouteurs en capture sur le conteneur de
 * la carte), et non coupés dans MapLibre (`handler.disable()`) :
 *  - couper la molette en plein zoom laisse MapLibre « en train de zoomer » : la carte ne retrouve
 *    plus son repos, et la molette ne répond plus ensuite ;
 *  - molette coupée, MapLibre n'annule plus l'événement : un pincement au pavé tactile (ou
 *    Ctrl + molette) agrandirait toute la page ;
 *  - pincement coupé, MapLibre rend le geste au navigateur (`touch-action`), qui zoomerait la page.
 * Seul le double clic (et le double toucher) est coupé dans MapLibre : il n'a pas d'état en cours.
 * Reste possible pendant la pause : le zoom « double toucher puis glisser », rare.
 *
 * Le champignon est décoratif (`aria-hidden`) : l'annoncer à chaque déplacement serait un bavardage.
 * Les boutons de zoom passent en `aria-disabled` (ils gardent le clavier) et sont décrits par
 * « Zoom en pause pendant le calcul des carrés ».
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { h } from './dom';
import { icon } from './icons';

/** Un calcul plus court que cela ne montre rien : pas de champignon qui clignote. */
const SHOW_AFTER_MS = 250;
/** Le champignon reste plein un instant avant de disparaître : on le voit finir de se remplir. */
const FULL_MS = 220;

/** Touches de zoom de MapLibre (codes du clavier : =, + du pavé numérique, −, selon le navigateur). */
const ZOOM_KEY_CODES = new Set([61, 107, 171, 187, 189, 109, 173]);

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
  const note = h('span', { id: 'zoom-pause-note', hidden: true }, 'Zoom en pause pendant le calcul des carrés.');
  el.after(note);

  const container = map.getContainer();
  let paused = false;
  const stop = (event: Event): void => {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };
  // Molette (et pincement au pavé tactile, que le navigateur envoie comme une molette).
  container.addEventListener('wheel', (event) => paused && stop(event), { capture: true, passive: false });
  // Pincement : tout toucher à deux doigts ou plus. À un doigt, la carte se déplace toujours.
  for (const type of ['touchstart', 'touchmove'] as const) {
    container.addEventListener(type, (event) => paused && event.touches.length > 1 && stop(event), { capture: true, passive: false });
  }
  // Cadre de zoom : Maj + glisser.
  container.addEventListener('mousedown', (event) => paused && event.shiftKey && event.button === 0 && stop(event), true);
  // Touches + et − (les flèches, elles, déplacent toujours la carte).
  container.addEventListener(
    'keydown',
    (event) => {
      if (paused && ZOOM_KEY_CODES.has(event.keyCode) && !event.altKey && !event.ctrlKey && !event.metaKey) event.stopPropagation();
    },
    true,
  );

  const pause = (on: boolean): void => {
    if (on === paused) return;
    paused = on;
    if (on) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    for (const button of zoomButtons) {
      if (on) {
        button.setAttribute('aria-disabled', 'true');
        button.setAttribute('aria-describedby', note.id);
      } else {
        button.removeAttribute('aria-disabled');
        button.removeAttribute('aria-describedby');
      }
    }
    // (Pour les styles et pour les tests.)
    container.classList.toggle('zoom-paused', on);
  };

  let showing: number | undefined;
  let hiding: number | undefined;
  grid.onBusy((busy) => {
    window.clearTimeout(showing);
    window.clearTimeout(hiding);
    pause(busy);
    if (busy) {
      el.classList.remove('is-full');
      // Affiché après un court délai seulement (l'animation de remplissage part alors de zéro).
      if (el.hidden) showing = window.setTimeout(() => (el.hidden = false), SHOW_AFTER_MS);
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
