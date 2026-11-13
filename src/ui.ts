import { h } from './dom';
import { icon } from './icons';

let sectionCounter = 0;

export interface Collapsible {
  el: HTMLElement;
  setExpanded(open: boolean): void;
}

/**
 * Section repliable du panneau (titre + bouton chevron), comme sur cartes.gouv.fr.
 * `extra` s'affiche dans l'en-tête, entre le titre et le chevron (ex. un interrupteur).
 * Le chevron est le vrai bouton (clavier, lecteurs d'écran) ; un clic ou un toucher sur le titre
 * fait la même chose, pour ne pas avoir à viser un carré de 34 px.
 */
export function collapsible(title: HTMLElement, content: HTMLElement, expanded: boolean, extra?: HTMLElement): Collapsible {
  const id = `legend-section-${++sectionCounter}`;
  content.id = id;
  content.classList.add('layer__content');

  const toggle = h('button', { class: 'layer__toggle', type: 'button', 'aria-controls': id });
  let open = expanded;
  const render = (): void => {
    content.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Replier la section' : 'Déplier la section');
    toggle.replaceChildren(icon(open ? 'chevronUp' : 'chevronDown'));
  };
  const flip = (): void => {
    open = !open;
    render();
  };
  toggle.addEventListener('click', flip);
  title.classList.add('layer__title--toggle');
  title.addEventListener('click', flip);
  render();

  const el = h('section', { class: 'layer' }, h('div', { class: 'layer__header' }, title, extra ?? null, toggle), content);
  return {
    el,
    setExpanded(value: boolean) {
      open = value;
      render();
    },
  };
}

/** Interrupteur on/off (vraie case à cocher, stylée en bascule). */
export function switchInput(label: string): HTMLInputElement {
  return h('input', { type: 'checkbox', role: 'switch', class: 'switch', 'aria-label': label, title: label });
}

/** Titre de section avec une icône. */
export function sectionTitle(text: string, iconName?: Parameters<typeof icon>[0]): HTMLElement {
  return h('h3', { class: 'layer__title' }, iconName ? h('span', { class: 'layer__icon' }, icon(iconName)) : null, text);
}
