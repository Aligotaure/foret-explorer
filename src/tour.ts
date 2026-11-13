/**
 * « La carte en 3 gestes » : présentation montrée une fois, juste après le premier accord donné à
 * l'avertissement (src/main.ts), et à la demande depuis la légende (« Comment ça marche ? »).
 *
 * Ce n'est pas une porte : elle se ferme par son bouton, par Échap ou par un clic à côté, et rien
 * n'est gardé dans le navigateur. Le schéma de l'écran est dessiné en HTML et CSS (pas une capture :
 * net partout, jamais périmé, et il montre la bonne disposition sur téléphone, où il n'y a ni volet
 * gauche ni volet droit) ; il est décoratif, la liste numérotée dit tout.
 *
 * Chargé avec la page d'entrée : n'importer ici que dom.ts et icons.ts, rien de la carte.
 */
import { h } from './dom';
import { icon } from './icons';

/** Fermetures ignorées juste après l'ouverture : « Voir la carte » apparaît là où l'on vient d'appuyer pour accepter. */
const GUARD_MS = 500;

/** Présentation à l'écran : sa promesse, et de quoi la retirer sans la tenir pour vue. */
let current: { promise: Promise<boolean>; withdraw: () => void } | null = null;

const blob = (style: string): HTMLElement => h('span', { class: 'tour-map__blob', style });
const square = (style: string): HTMLElement => h('span', { class: 'tour-map__square', style });
const num = (n: number, style?: string): HTMLElement => h('span', { class: 'tour-num', style, 'aria-hidden': 'true' }, String(n));
const bars = (): HTMLElement => h('div', { class: 'tour-bars' }, ...[20, 90, 10, 60, 0, 35, 75].map((v) => h('i', { style: `height: ${v}%` })));

/** Grand écran : la légende à gauche, la carte, le bilan du coin touché à droite. */
function wideScreen(): HTMLElement {
  return h(
    'div',
    { class: 'tour__screen tour__screen--wide', 'aria-hidden': 'true' },
    h(
      'div',
      { class: 'tour-panel' },
      h('div', { class: 'tour-panel__head' }, 'Légendes'),
      h(
        'div',
        { class: 'tour-panel__body' },
        h('div', { class: 'tour-chips' }, h('span', { class: 'tour-chip tour-chip--on' }), h('span', { class: 'tour-chip' }), h('span', { class: 'tour-chip' })),
        h('div', { class: 'tour-line tour-line--switch' }),
        h('div', { class: 'tour-line tour-line--switch' }),
        h('div', { class: 'tour-line' }),
      ),
    ),
    h(
      'div',
      { class: 'tour-map' },
      blob('left: -8%; top: 8%; width: 58%; height: 52%; background: var(--tour-a)'),
      blob('left: 44%; top: -12%; width: 62%; height: 58%; background: var(--tour-b)'),
      blob('left: 22%; top: 52%; width: 70%; height: 56%; background: var(--tour-c)'),
      square('left: 6%; top: 14%; width: 30%; height: 38%; background: rgba(233, 196, 106, 0.55)'),
      square('left: 38%; top: 14%; width: 30%; height: 38%; background: rgba(224, 122, 31, 0.7)'),
      square('left: 38%; top: 54%; width: 30%; height: 38%; background: rgba(163, 59, 11, 0.78)'),
      h('span', { class: 'tour-map__chance', style: 'left: 40%; top: 24%' }, '≈ 55 %'),
      h('span', { class: 'tour-map__chance', style: 'left: 40%; top: 77%' }, '≈ 74 %'),
      h('span', { class: 'tour-map__pin', style: 'left: 60%; top: 56%' }),
    ),
    h(
      'div',
      { class: 'tour-panel' },
      h('div', { class: 'tour-panel__head' }, 'Ce coin'),
      h('div', { class: 'tour-panel__body' }, h('div', { class: 'tour-line' }), h('div', { class: 'tour-line' }), bars(), h('span', { class: 'tour-chance' }, '≈ 74 %')),
    ),
    num(1, 'left: 10px; top: 6px'),
    num(2, 'left: calc(30% + 8px); top: 8px'),
    num(3, 'left: calc(72% + 10px); top: 6px'),
  );
}

/** Téléphone : le bouton de la légende en haut à gauche, la carte, le bilan en tiroir bas. */
function phoneScreen(): HTMLElement {
  return h(
    'div',
    { class: 'tour__screen tour__screen--phone', 'aria-hidden': 'true' },
    blob('left: -10%; top: 12%; width: 70%; height: 30%; background: var(--tour-a)'),
    blob('left: 40%; top: 6%; width: 75%; height: 34%; background: var(--tour-b)'),
    blob('left: 10%; top: 38%; width: 85%; height: 30%; background: var(--tour-c)'),
    square('left: 8%; top: 18%; width: 40%; height: 19%; background: rgba(224, 122, 31, 0.7)'),
    square('left: 52%; top: 18%; width: 40%; height: 19%; background: rgba(233, 196, 106, 0.55)'),
    square('left: 52%; top: 39%; width: 40%; height: 19%; background: rgba(163, 59, 11, 0.78)'),
    h('span', { class: 'tour-map__chance', style: 'left: 12%; top: 25%' }, '≈ 55 %'),
    h('span', { class: 'tour-map__pin', style: 'left: 66%; top: 44%' }),
    h('span', { class: 'tour-phone__menu' }),
    h('span', { class: 'tour-phone__island' }),
    h('div', { class: 'tour-phone__sheet' }, h('div', { class: 'tour-panel__head' }, 'Ce coin'), h('div', { class: 'tour-line' }), bars(), h('span', { class: 'tour-chance' }, '≈ 74 %')),
    num(1, 'left: 22px; top: 22px'),
    num(2, 'left: 8px; top: 40%'),
    num(3, 'left: 5px; bottom: calc(40% - 14px)'),
  );
}

/** Un geste : son numéro (celui du schéma), son nom, et où cela se passe selon la disposition. */
function step(n: number, title: string, wide: string, phone = wide): HTMLLIElement {
  const where = wide === phone ? [wide] : [h('span', { class: 'tour__wide' }, wide), h('span', { class: 'tour__phone' }, phone)];
  return h('li', {}, num(n), h('span', {}, h('strong', {}, title), ' ', ...where));
}

/**
 * Affiche la présentation ; la promesse se résout à vrai quand le visiteur la ferme, à faux si elle
 * est retirée (il a quitté la carte). Déjà à l'écran : rien de plus.
 */
export function showTour(): Promise<boolean> {
  if (current) return current.promise;

  const heading = h('h2', { id: 'tour-heading', class: 'tour__heading', tabindex: '-1' }, 'La carte en 3 gestes');
  const close = h('button', { class: 'tour__close', type: 'button' }, 'Voir la carte');
  const dialog = h(
    'dialog',
    { class: 'tour', 'aria-labelledby': 'tour-heading' },
    h('div', { class: 'tour__head' }, h('span', { class: 'tour__icon' }, icon('mushroom')), heading),
    h(
      'div',
      { class: 'tour__body' },
      h(
        'div',
        { class: 'tour__layout' },
        wideScreen(),
        phoneScreen(),
        h(
          'ol',
          { class: 'tour__steps', role: 'list' },
          step(1, 'Choisissez un champignon', 'à gauche, dans la légende, avec ce que la carte affiche : météo, forêts, sol.', 'dans la légende : bouton en haut à gauche.'),
          step(2, 'Zoomez sur un secteur coloré', 'le % est une chance estimée, jamais une certitude.'),
          step(3, 'Touchez un coin', 'à droite, son bilan : forêt, sol, pluie, droit de cueillir.', 'son bilan s’ouvre en bas : forêt, sol, pluie, droit de cueillir.'),
        ),
      ),
      h('p', { class: 'tour__note' }, 'Un pourcentage élevé n’est ni une promesse d’en trouver, ni un droit de cueillir.'),
    ),
    h('div', { class: 'tour__foot' }, h('p', { class: 'tour__again' }, 'À revoir depuis la légende : « Comment ça marche ? »'), close),
  );

  let withdraw = (): void => {};
  const promise = new Promise<boolean>((resolve) => {
    const app = document.getElementById('app');
    let done = false;
    const finish = (seen: boolean): void => {
      if (done) return;
      done = true;
      current = null;
      if (dialog.open) dialog.close(); // rend le clavier à l'élément qui avait ouvert la fenêtre
      dialog.remove();
      if (app) app.inert = false;
      resolve(seen);
    };
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      // Très vieux navigateur sans <dialog> modal : on fige la carte nous-mêmes.
      dialog.setAttribute('open', '');
      if (app) app.inert = true;
    }
    const opened = Date.now();
    // Le clavier sur le titre, pas sur le bouton : une touche Entrée répétée ne la referme pas sans qu'elle ait été vue.
    heading.focus({ preventScroll: true });

    const settled = (): boolean => Date.now() - opened >= GUARD_MS;
    close.addEventListener('click', () => {
      if (settled()) finish(true);
    });
    // Clic à côté : il arrive sur la fenêtre elle-même (son voile), pas sur son contenu.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && settled()) finish(true);
    });
    // Échap (fermeture native) ou bouton Précédent d'Android.
    dialog.addEventListener('close', () => finish(true));
    withdraw = () => finish(false);
  });
  current = { promise, withdraw };
  return promise;
}

/** Retire la présentation sans la tenir pour vue : le visiteur a quitté la carte. */
export function withdrawTour(): void {
  current?.withdraw();
}
