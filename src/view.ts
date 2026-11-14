/**
 * Les deux vues de la page : la carte et « Analytics ».
 *
 * La vue affichée est portée par l'adresse (`#vue=analytics`), à côté de la position que MapLibre y
 * tient à jour (`#carte=zoom/lat/lon`) : `#carte=11.5/45.92/6.19&vue=analytics` se partage et se
 * recharge tel quel. Sans `vue=analytics`, c'est la carte.
 *
 * L'îlot (index.html) bascule de l'une à l'autre. Un clic ajoute une entrée à l'historique sans
 * déclencher `hashchange` : MapLibre ne déplace donc pas la carte, qui reste où elle était.
 * Précédent et Suivant du navigateur rendent à chaque entrée sa vue (et, par MapLibre, sa position).
 *
 * Dans la vue Analytics, pas de lien interne du type `href="#section"` : il remplacerait tout le
 * fragment de l'adresse, `vue=analytics` compris, et ramènerait à la carte.
 */
import { byId } from './dom';

export type ViewId = 'map' | 'analytics';

type Listener = (view: ViewId) => void;

const PARAM = 'vue';
const ANALYTICS_PART = `${PARAM}=analytics`;
const TITLES: Readonly<Record<ViewId, string>> = {
  map: 'Forêt Explorer',
  analytics: 'Analytics — Forêt Explorer',
};
/** Annonce lue par les lecteurs d'écran au changement de vue (rien d'autre ne le leur dit). */
const ANNOUNCEMENTS: Readonly<Record<ViewId, string>> = {
  map: 'Vue Carte affichée',
  analytics: 'Vue Analytics affichée',
};

const changeListeners = new Set<Listener>();
const leaveListeners = new Set<Listener>();
let links: HTMLAnchorElement[] = [];

/**
 * Morceaux du fragment d'adresse (« a=1&b=2 »), tels quels. Pas de `URLSearchParams` : il encoderait
 * les « / » de `carte=zoom/lat/lon`, que MapLibre ne saurait plus lire.
 */
const hashParts = (): string[] => location.hash.slice(1).split('&').filter(Boolean);

/** Vue demandée par l'adresse. Même règle que le script en tête d'index.html. */
const viewInUrl = (): ViewId => (hashParts().includes(ANALYTICS_PART) ? 'analytics' : 'map');

let shown: ViewId = viewInUrl();

/** Vue affichée. */
export const currentView = (): ViewId => shown;

/** Adresse de la page pour une vue : seul `vue=` change, la position (`carte=`) est gardée. */
function urlFor(view: ViewId): string {
  const kept = hashParts().filter((part) => part.split('=')[0] !== PARAM);
  if (view === 'analytics') kept.push(ANALYTICS_PART);
  // Toujours une adresse complète : `pushState` ignore une chaîne vide, et un « # » seul resterait affiché.
  return `${location.pathname}${location.search}${kept.length ? `#${kept.join('&')}` : ''}`;
}

/** Prévenu à chaque changement de vue : îlot, Précédent / Suivant, adresse modifiée à la main. */
export function onViewChange(listener: Listener): void {
  changeListeners.add(listener);
}

/**
 * Prévenu juste avant de quitter une vue par l'îlot, tant que son adresse est encore l'entrée
 * courante de l'historique (la carte y écrit alors sa position exacte).
 */
export function onViewLeave(listener: Listener): void {
  leaveListeners.add(listener);
}

/** Aligne la page sur l'adresse. Sans effet si rien n'a changé (Précédent déclenche deux événements). */
function sync(): void {
  const view = viewInUrl();
  const root = document.documentElement;
  if (view === 'analytics') root.dataset['view'] = 'analytics';
  else delete root.dataset['view'];
  document.title = TITLES[view];
  let current: HTMLAnchorElement | undefined;
  for (const link of links) {
    if (link.dataset['view'] === view) {
      link.setAttribute('aria-current', 'page');
      current = link;
    } else link.removeAttribute('aria-current');
  }
  // La vue masquée ne garde pas le clavier : sans cela, hors de Chrome, les flèches déplaceraient
  // encore la carte invisible au lieu de faire défiler la vue Analytics.
  const hiddenView = byId(view === 'analytics' ? 'app' : 'analytics');
  if (hiddenView.contains(document.activeElement)) current?.focus({ preventScroll: true });

  if (view === shown) return;
  shown = view;
  byId('view-status').textContent = ANNOUNCEMENTS[view];
  for (const listener of changeListeners) listener(view);
}

/** Affiche une vue et l'inscrit dans l'historique (Précédent ramène à la vue quittée). */
export function showView(view: ViewId): void {
  if (view === viewInUrl()) return;
  for (const listener of leaveListeners) listener(shown);
  history.pushState(null, '', urlFor(view));
  sync();
}

/** Branche l'îlot et l'historique du navigateur. */
export function initViewSwitch(): void {
  const nav = byId('view-switch');
  links = [...nav.querySelectorAll<HTMLAnchorElement>('a[data-view]')];
  nav.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-view]') : null;
    // Clic simple seulement : avec Ctrl, Cmd, Maj ou Alt, le navigateur ouvre le lien ailleurs.
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    showView(link.dataset['view'] === 'analytics' ? 'analytics' : 'map');
  });
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
  sync();
}
