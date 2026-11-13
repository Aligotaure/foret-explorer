import { BDFORET } from './config';
import { h } from './dom';
import { ALL_CODES, FOREST_CLASSES, GROUPS, PRESETS, codesOfGroup, type GroupId } from './forestClasses';
import { icon } from './icons';
import { ABOUT_URL } from './legal';
import { mushroomSection, soilSection, weatherSection, zonesSection } from './legendExtras';
import type { MeteoLayer } from './meteoLayer';
import type { AppState, BasemapId, Store } from './state';
import { collapsible, sectionTitle } from './ui';

interface Row {
  item: HTMLLIElement;
  input: HTMLInputElement;
  count: HTMLSpanElement;
}

const BASEMAPS: readonly { id: BasemapId; label: string }[] = [
  { id: 'plan', label: 'Plan IGN' },
  { id: 'ortho', label: 'Photographies aériennes' },
];

/**
 * Panneau « Légendes » inspiré de cartes.gouv.fr : chaque type de forêt a sa case à
 * cocher. Le panneau ne touche jamais la carte : il lit et modifie le Store, et
 * mapView.ts répercute les changements sur MapLibre.
 */
export class LegendPanel {
  private readonly rows = new Map<string, Row>();
  private readonly groups = new Map<GroupId, { el: HTMLElement; input: HTMLInputElement }>();
  private readonly presets = new Map<string, HTMLButtonElement>();
  private readonly basemapInputs = new Map<BasemapId, HTMLInputElement>();
  private readonly summary = h('p', { class: 'legend-summary', 'aria-live': 'polite' });
  private readonly zoomNote = h(
    'p',
    { class: 'legend-note', hidden: true },
    `Zoomez (niveau ${BDFORET.minZoom} ou plus) pour filtrer et compter les types. ` +
      'En dessous, la carte montre l’aperçu officiel, non filtrable.',
  );
  private readonly emptyNote = h('p', { class: 'legend-empty', hidden: true }, 'Aucun type de forêt dans la zone affichée.');
  private readonly onlyPresentInput = h('input', { type: 'checkbox', class: 'cb cb--dark' });
  private readonly allInput = h('input', { type: 'checkbox', class: 'cb', 'data-all': 'true' });
  private readonly opacityInput = h('input', {
    type: 'range',
    min: 10,
    max: 100,
    step: 5,
    'aria-label': 'Opacité de la couche forêt',
  });
  private readonly opacityValue = h('output', {});
  private readonly basemapTitle = h('h3', { class: 'layer__title' });
  private counts: ReadonlyMap<string, number> | null = null;
  private readonly extras: { sync(state: AppState): void }[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly store: Store,
    private readonly meteo: MeteoLayer,
  ) {
    this.render();
    this.sync(store.state);
    store.subscribe((state) => this.sync(state));
  }

  /** Nombre de polygones par code dans la zone affichée, ou `null` si inconnu (petit zoom). */
  setCounts(counts: ReadonlyMap<string, number> | null): void {
    this.counts = counts;
    for (const [code, row] of this.rows) {
      if (!counts) {
        row.count.hidden = true;
        continue;
      }
      const n = counts.get(code) ?? 0;
      row.count.hidden = false;
      row.count.textContent = n.toLocaleString('fr-FR');
      row.count.classList.toggle('is-zero', n === 0);
      row.count.title =
        n === 0 ? 'Absent de la zone affichée' : `${n} polygone${n > 1 ? 's' : ''} dans la zone affichée`;
    }
    this.updateVisibility(this.store.state);
  }

  /** Sous le zoom des tuiles vectorielles, le filtrage ne s'applique pas encore. */
  setFilteringActive(active: boolean): void {
    this.zoomNote.hidden = active;
  }

  private render(): void {
    const close = h('button', { class: 'panel__close', type: 'button', 'aria-label': 'Fermer la légende' }, icon('close'));
    close.addEventListener('click', () => this.store.update({ legendOpen: false }));

    const header = h(
      'div',
      { class: 'panel__header' },
      h('span', { class: 'panel__icon' }, icon('legend')),
      h('h2', { class: 'panel__title' }, 'Légendes'),
      close,
    );
    const mushrooms = mushroomSection(this.store);
    const zones = zonesSection(this.store);
    const soils = soilSection(this.store);
    const weather = weatherSection(this.store, this.meteo);
    this.extras.push(mushrooms, zones, soils, weather);
    const link = (text: string, anchor: string): HTMLAnchorElement => h('a', { href: `${ABOUT_URL}#${anchor}` }, text);
    const body = h(
      'div',
      { class: 'panel__body' },
      mushrooms.el,
      this.renderForestSection(),
      zones.el,
      soils.el,
      weather.el,
      this.renderBasemapSection(),
      h(
        'footer',
        { class: 'legend-footer' },
        link('Avant de cueillir', 'identifier'),
        link('Conditions', 'conditions'),
        link('Mentions légales', 'mentions-legales'),
        link('Confidentialité', 'confidentialite'),
      ),
    );
    this.root.replaceChildren(header, body);
  }

  private renderForestSection(): HTMLElement {
    const presets = h('div', { class: 'presets', role: 'group', 'aria-label': 'Sélections rapides' });
    for (const preset of PRESETS) {
      const button = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false' }, preset.label);
      button.addEventListener('click', () => this.store.update({ selected: new Set(preset.codes) }));
      this.presets.set(preset.id, button);
      presets.append(button);
    }

    this.onlyPresentInput.addEventListener('change', () =>
      this.store.update({ onlyPresent: this.onlyPresentInput.checked }),
    );
    const onlyPresent = h(
      'label',
      { class: 'switch-line' },
      this.onlyPresentInput,
      'Seulement les types présents dans la zone',
    );

    const card = h(
      'div',
      { class: 'legend-card' },
      h('label', { class: 'legend-all' }, this.allInput, h('span', {}, 'Tous les types')),
    );
    for (const group of GROUPS) {
      const groupInput = h('input', { type: 'checkbox', class: 'cb', 'data-group': group.id });
      const list = h('ul', { class: 'legend-list' });
      for (const cls of FOREST_CLASSES.filter((c) => c.group === group.id)) {
        const input = h('input', { type: 'checkbox', class: 'cb', value: cls.code });
        const count = h('span', { class: 'legend-item__count', hidden: true });
        const item = h(
          'li',
          { 'data-code': cls.code },
          h(
            'label',
            { class: 'legend-item', title: `${cls.label} (${cls.code}) — double-clic : afficher seul` },
            input,
            h('span', { class: 'swatch', style: `--swatch: ${cls.color}` }),
            h('span', { class: 'legend-item__label' }, cls.short),
            count,
          ),
        );
        list.append(item);
        this.rows.set(cls.code, { item, input, count });
      }
      const el = h(
        'div',
        { class: 'legend-group', 'data-group': group.id },
        h('label', { class: 'legend-group__header' }, groupInput, h('span', {}, group.label)),
        list,
      );
      this.groups.set(group.id, { el, input: groupInput });
      card.append(el);
    }
    card.append(this.emptyNote);

    card.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const group = target.dataset['group'] as GroupId | undefined;
      if (target.dataset['all']) this.store.update({ selected: new Set(target.checked ? ALL_CODES : []) });
      else if (group) this.setCodes(codesOfGroup(group), target.checked);
      else if (target.value) this.setCodes([target.value], target.checked);
    });
    // Double-clic sur un type : n'afficher que lui.
    card.addEventListener('dblclick', (event) => {
      const item = (event.target as Element).closest<HTMLElement>('li[data-code]');
      const code = item?.dataset['code'];
      if (!code) return;
      event.preventDefault();
      this.store.update({ selected: new Set([code]) });
    });

    this.opacityInput.addEventListener('input', () =>
      this.store.update({ opacity: Number(this.opacityInput.value) / 100 }),
    );
    const opacity = h('label', { class: 'opacity' }, h('span', {}, 'Opacité'), this.opacityInput, this.opacityValue);

    const content = h(
      'div',
      {},
      h('div', { class: 'legend-tools' }, presets, this.summary, onlyPresent),
      this.zoomNote,
      card,
      opacity,
      h(
        'details',
        { class: 'legend-help' },
        h('summary', {}, 'Comprendre la légende'),
        h(
          'p',
          {},
          'Forêt fermée : les arbres couvrent au moins 40 % du sol ; ouverte : de 10 à 40 %. ',
          '« Pur » : une essence fait au moins 75 % du couvert.',
        ),
        h('p', {}, 'Double-clic sur un type pour n’afficher que lui.'),
        h(
          'p',
          { class: 'legend-source' },
          'Source : IGN, BD Forêt® V2 (photo-interprétation 2007–2018 selon les départements).',
        ),
      ),
    );
    return collapsible(sectionTitle('Carte forestière (BD Forêt® V2)', 'tree'), content, true).el;
  }

  private renderBasemapSection(): HTMLElement {
    const list = h('div', { class: 'basemaps', role: 'radiogroup', 'aria-label': 'Fond de carte' });
    for (const basemap of BASEMAPS) {
      const input = h('input', { type: 'radio', name: 'basemap', value: basemap.id });
      input.addEventListener('change', () => {
        if (input.checked) this.store.update({ basemap: basemap.id });
      });
      this.basemapInputs.set(basemap.id, input);
      list.append(h('label', { class: 'basemap-option' }, input, h('span', {}, basemap.label)));
    }
    return collapsible(this.basemapTitle, list, false).el;
  }


  private setCodes(codes: readonly string[], on: boolean): void {
    const selected = new Set(this.store.state.selected);
    for (const code of codes) {
      if (on) selected.add(code);
      else selected.delete(code);
    }
    this.store.update({ selected });
  }

  private sync(state: AppState): void {
    const { selected } = state;
    this.root.hidden = !state.legendOpen;

    for (const [code, row] of this.rows) {
      const on = selected.has(code);
      row.input.checked = on;
      row.item.classList.toggle('is-off', !on);
    }
    for (const [groupId, group] of this.groups) {
      const codes = codesOfGroup(groupId);
      const n = codes.filter((code) => selected.has(code)).length;
      group.input.checked = n === codes.length;
      group.input.indeterminate = n > 0 && n < codes.length;
    }
    this.allInput.checked = selected.size > 0 && ALL_CODES.every((code) => selected.has(code));
    this.allInput.indeterminate = selected.size > 0 && !this.allInput.checked;
    for (const preset of PRESETS) {
      const active = preset.codes.length === selected.size && preset.codes.every((code) => selected.has(code));
      this.presets.get(preset.id)?.setAttribute('aria-pressed', String(active));
    }

    this.onlyPresentInput.checked = state.onlyPresent;
    const percent = Math.round(state.opacity * 100);
    this.opacityInput.value = String(percent);
    this.opacityValue.textContent = `${percent} %`;
    for (const [id, input] of this.basemapInputs) input.checked = id === state.basemap;
    this.basemapTitle.textContent = BASEMAPS.find((b) => b.id === state.basemap)?.label ?? 'Fond de carte';
    for (const extra of this.extras) extra.sync(state);

    this.updateVisibility(state);
  }

  /** Masque les types absents de la zone si l'option est cochée, et met à jour le résumé. */
  private updateVisibility(state: AppState): void {
    const counts = this.counts;
    const filterRows = state.onlyPresent && counts !== null;
    let anyVisible = false;
    let present = 0;

    for (const [groupId, group] of this.groups) {
      let groupVisible = false;
      for (const code of codesOfGroup(groupId)) {
        const row = this.rows.get(code);
        if (!row) continue;
        const isPresent = (counts?.get(code) ?? 0) > 0;
        if (isPresent) present++;
        const visible = !filterRows || isPresent;
        row.item.hidden = !visible;
        groupVisible ||= visible;
      }
      group.el.hidden = !groupVisible;
      anyVisible ||= groupVisible;
    }
    this.emptyNote.hidden = anyVisible;

    const n = state.selected.size;
    let text = `${n} / ${ALL_CODES.length} type${n > 1 ? 's' : ''} affiché${n > 1 ? 's' : ''}`;
    if (counts) text += ` · ${present} présent${present > 1 ? 's' : ''} dans la zone`;
    this.summary.textContent = text;
  }
}
