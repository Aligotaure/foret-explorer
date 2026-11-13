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
import { showTour, withdrawTour } from './tour';
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
  const message = import.meta.env.DEV
    ? `Cette vue n’a pas pu se charger : ${String(error)}. Si le contenu de la vue Analytics vient d’être modifié, « npm run check » dit où est l’erreur.`
    : 'Cette vue n’a pas pu se charger. Vérifiez la connexion, puis rechargez la page.';
  box.replaceChildren(h('span', {}, message), reload);
  box.hidden = false;
}

/** L'alerte affichée pendant l'avertissement (fenêtre modale) n'a pas été lue : on la redit après. */
function repeatFailure(): void {
  const box = byId('view-error');
  if (!box.hidden) box.replaceChildren(...box.childNodes);
}

/** Présentation due : un premier accord vient d'être donné, et le visiteur ne l'a pas encore fermée (rien n'est gardé). */
let tourDue = false;

/**
 * Accueil de la carte : l'avertissement à accepter, puis, pour un premier accord seulement, « La carte
 * en 3 gestes ». Quittée sans avoir été fermée (passage à la vue Analytics), la présentation revient
 * avec la carte, directement : l'accord, lui, est déjà donné.
 */
async function welcome(): Promise<void> {
  if (await showDisclaimer()) tourDue = true;
  if (tourDue && currentView() === 'map' && (await showTour())) tourDue = false;
  repeatFailure();
}

function show(view: ViewId): void {
  byId('view-error').hidden = true; // le message ne concernait que la vue qu'on quitte
  if (!loading.has(view)) {
    // Tant que le code de la vue n'est pas arrivé, les lecteurs d'écran la savent en cours de chargement.
    const root = byId(view === 'map' ? 'app' : 'analytics');
    root.setAttribute('aria-busy', 'true');
    loading.set(
      view,
      loaders[view]()
        .catch((error: unknown) => {
          loading.delete(view); // nouvel essai à la prochaine ouverture de la vue
          // Le visiteur est déjà passé à l'autre vue : le message attendra son retour (et un nouvel essai).
          if (currentView() === view) reportFailure(view, error);
          else console.warn('[vue]', view, error);
        })
        .finally(() => root.removeAttribute('aria-busy')),
    );
  }
  // L'avertissement ne concerne que la carte : il s'affiche avec elle, sans attendre qu'elle soit
  // téléchargée, et se retire si le visiteur passe à la vue Analytics avant de l'avoir accepté.
  if (view === 'map') void welcome();
  else {
    // Une fenêtre modale restée ouverte couvrirait la vue Analytics et la figerait.
    withdrawDisclaimer();
    withdrawTour();
  }
}

initViewSwitch();
onViewChange(show);
show(currentView());
