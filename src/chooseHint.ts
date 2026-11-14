/**
 * Bandeau « Choisissez un champignon » : tant qu'aucun n'est choisi, en haut de la carte, avec les
 * puces dedans (demande de Clément du 15/11/2026).
 *
 * Il remplace « Zoomez pour filtrer les types de forêt », qui occupait cet emplacement pour un
 * conseil que la légende donne déjà dans sa section « Types de forêt ». Sur téléphone, légende
 * fermée, rien à l'écran ne disait par où commencer.
 *  - Les puces sont dans le bandeau : un geste, sans rien ouvrir. On ne dit pas « à gauche » : sur
 *    téléphone la légende est un tiroir en bas, et sur grand écran elle peut être fermée.
 *  - Mêmes puces que la légende (`mushroomChip`) : moyenne de France, champignon hors saison grisé.
 *  - Il se ferme (qui ne veut que la carte des forêts ne l'a pas sous les yeux toute la visite), et
 *    s'efface dès qu'un champignon est choisi, ou que la grille d'indice a quelque chose à montrer :
 *    l'emplacement est alors celui du champignon de chargement et du bandeau « risque de chou
 *    blanc ». Sans champignon choisi, la grille d'indice montre les cèpes ; s'ils sont hors saison
 *    (janvier à avril) elle ne dessine rien et ces deux-là ne s'affichent jamais : le bandeau reste.
 *  - Quand il se retire alors que le clavier y était (une puce choisie, la croix), le clavier passe
 *    au bouton de la légende : masqué sous lui, il repartirait du début de la page.
 */
import { h } from './dom';
import { loadFranceStats } from './franceStats';
import { icon } from './icons';
import { mushroomChip, pickMushroom, type FranceAverages } from './legendExtras';
import { indexMushroom } from './meteoLayer';
import { MUSHROOMS, MUSHROOM_BY_ID, currentMonth, noEstimate } from './mushrooms';
import type { Store } from './state';

export function initChooseHint(el: HTMLElement, store: Store): void {
  const title = h('p', { id: 'choose-hint-title', class: 'choose-hint__title' }, 'Choisissez un champignon');
  const chips = h('div', { class: 'presets', role: 'group', 'aria-labelledby': title.id });
  const notes = h('div', { class: 'visually-hidden' });
  const all = MUSHROOMS.map((m) => mushroomChip(m, `choix-${m.id}`, () => pickMushroom(store, m)));
  for (const chip of all) {
    chips.append(chip.button);
    notes.append(chip.note);
  }
  // (La phrase complète est sous les puces de la légende ; ici, la place compte, surtout sur téléphone.)
  const caption = h('p', { class: 'choose-hint__caption', hidden: true }, '% : chance estimée moyenne en France');
  const close = h('button', { class: 'grid-verdict__close', type: 'button', 'aria-label': 'Fermer ce message' }, icon('close'));
  el.replaceChildren(
    h(
      'div',
      { class: 'grid-verdict__box choose-hint__box' },
      h('span', { class: 'grid-verdict__icon', 'aria-hidden': 'true' }, icon('mushroom')),
      title,
      close,
      chips,
      caption,
      notes,
    ),
  );

  let dismissed = false;
  let averages: FranceAverages = null;
  const render = (): void => {
    const state = store.state;
    const month = currentMonth();
    // La grille d'indice a-t-elle quelque chose à montrer ? (Sans champignon choisi : les cèpes.)
    const shown = MUSHROOM_BY_ID.get(indexMushroom(state));
    const gridBusy = state.weatherMode === 'indice' && Boolean(shown) && !noEstimate(shown as NonNullable<typeof shown>, month);
    const hadFocus = el.contains(document.activeElement);
    el.hidden = dismissed || state.mushroom !== null || gridBusy;
    if (el.hidden) {
      if (hadFocus) document.getElementById('legend-toggle')?.focus({ preventScroll: true });
      return;
    }
    for (const chip of all) chip.sync(state, month, averages);
    caption.hidden = !averages || !MUSHROOMS.some((m) => !noEstimate(m, month) && averages?.[m.id] !== undefined);
  };
  close.addEventListener('click', () => {
    dismissed = true;
    render();
  });
  store.subscribe(render);
  void loadFranceStats().then((loaded) => {
    averages = loaded;
    render();
  });
  render();
}
