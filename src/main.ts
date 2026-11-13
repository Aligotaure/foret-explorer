/**
 * Point d'entrée : l'îlot et les deux vues de la page (carte, Analytics).
 *
 * Chaque vue est téléchargée à sa première ouverture. Arriver sur « Analytics » ne charge donc ni
 * MapLibre ni aucune tuile ; la carte, une fois chargée, reste en mémoire quand on la quitte :
 * position, légende et bilan sont intacts au retour (src/mapView.ts).
 */
// MapLibre d'abord : style.css corrige quelques-unes de ses règles (échelle, coin bas droit).
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import './analytics.css';
import { showDisclaimer, withdrawDisclaimer } from './disclaimer';
import { byId, h } from './dom';
import { currentView, initViewSwitch, onViewChange, type ViewId } from './view';

const loaders: Readonly<Record<ViewId, () => Promise<unknown>>> = {
  map: () => import('./mapView'),
  analytics: () => import('./analyticsView'),
};
const loading = new Map<ViewId, Promise<unknown>>();

/** Le code d'une vue n'est pas arrivé (réseau coupé, site republié entre-temps) : on le dit. */
function reportFailure(view: ViewId, error: unknown): void {
  console.warn('[vue]', view, error);
  const reload = h('button', { class: 'view-error__btn', type: 'button' }, 'Recharger');
  reload.addEventListener('click', () => location.reload());
  const box = byId('view-error');
  box.replaceChildren(h('span', {}, 'Cette vue n’a pas pu se charger. Vérifiez la connexion, puis rechargez la page.'), reload);
  box.hidden = false;
}

function show(view: ViewId): void {
  if (!loading.has(view)) {
    loading.set(
      view,
      loaders[view]().catch((error: unknown) => {
        loading.delete(view); // nouvel essai à la prochaine ouverture de la vue
        reportFailure(view, error);
      }),
    );
  }
  // L'avertissement ne concerne que la carte : il s'affiche avec elle, sans attendre qu'elle soit
  // téléchargée, et se retire si le visiteur passe à la vue Analytics avant de l'avoir accepté.
  if (view === 'map') void showDisclaimer();
  else withdrawDisclaimer();
}

initViewSwitch();
onViewChange(show);
show(currentView());
