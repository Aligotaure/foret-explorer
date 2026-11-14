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
 *    s'efface dès qu'un champignon est choisi ou que la grille d'indice est allumée : l'emplacement
 *    est alors celui du champignon de chargement et du bandeau « risque de chou blanc ».
 */
import { h } from './dom';
import { loadFranceStats } from './franceStats';
import { icon } from './icons';
import { mushroomChip, pickMushroom, type FranceAverages } from './legendExtras';
import { MUSHROOMS, currentMonth, noEstimate } from './mushrooms';
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
    el.hidden = dismissed || state.mushroom !== null || state.weatherMode === 'indice';
    if (el.hidden) return;
    const month = currentMonth();
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
