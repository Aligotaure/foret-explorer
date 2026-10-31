/**
 * Sections ajoutées au panneau « Légendes » : « Je cherche… », nature du sol, météo.
 * Comme le reste du panneau, elles ne touchent jamais la carte : elles lisent et modifient le Store.
 */
import { GEOLOGY } from './config';
import { h } from './dom';
import { CLASS_BY_CODE } from './forestClasses';
import { RAIN_STEPS, describeStatus, indexMushroom, type MeteoLayer } from './meteoLayer';
import { LEVELS, MUSHROOMS, MUSHROOM_BY_ID, hostCodes, type Mushroom } from './mushrooms';
import { SOIL_CLASSES, drawPattern } from './soils';
import type { AppState, Store } from './state';
import { collapsible, sectionTitle, switchInput } from './ui';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function seasonText(m: Mushroom): string {
  const months = Object.entries(m.season)
    .filter(([, w]) => (w ?? 0) >= 0.5)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
  // Saison à cheval sur l'année (ex. octobre → janvier) : on garde l'ordre naturel.
  const first = months[0];
  const last = months[months.length - 1];
  return first && last ? `${MONTHS[first - 1]} à ${MONTHS[last - 1]}` : '—';
}

/** Mélanges et forêts mixtes : regroupés en « et leurs mélanges » pour rester lisible. */
const MIXTURES = new Set(['FF1-00-00', 'FF2-00-00', 'FF2-80-80', 'FF2-90-90', 'FF31', 'FF32', 'FO3']);

function hostText(m: Mushroom): string {
  const typical = Object.entries(m.hosts).filter(([, w]) => w >= 0.8);
  const names = typical
    .filter(([code]) => !MIXTURES.has(code))
    .map(([code]) => CLASS_BY_CODE.get(code)?.short.replace(/ purs?$/, '').toLowerCase())
    .filter((x): x is string => Boolean(x));
  const mixed = typical.some(([code]) => MIXTURES.has(code));
  return `${[...new Set(names)].join(', ')}${mixed ? ', et leurs mélanges' : ''}`;
}

function soilText(m: Mushroom): string {
  return SOIL_CLASSES.filter((s) => m.soils[s.id] >= 0.9)
    .map((s) => s.label.toLowerCase())
    .join(', ');
}

/** « Je cherche… » : choisir un champignon affiche ses forêts hôtes et son indice de pousse. */
export function mushroomSection(store: Store): { el: HTMLElement; sync(state: AppState): void } {
  const chips = h('div', { class: 'presets', role: 'group', 'aria-label': 'Champignon recherché' });
  const buttons = new Map<string, HTMLButtonElement>();
  for (const m of MUSHROOMS) {
    const button = h('button', { class: 'chip chip--mushroom', type: 'button', 'aria-pressed': 'false' }, m.label);
    button.addEventListener('click', () => {
      if (store.state.mushroom === m.id) {
        store.update({ mushroom: null });
        return;
      }
      store.update({ mushroom: m.id, selected: new Set(hostCodes(m)), weatherMode: 'indice' });
    });
    buttons.set(m.id, button);
    chips.append(button);
  }
  const card = h('div', { class: 'mushroom-card' });
  const content = h('div', {}, chips, card);
  const section = collapsible(sectionTitle('Je cherche…', 'mushroom'), content, true);

  const sync = (state: AppState): void => {
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(state.mushroom === id));
    const m = state.mushroom ? MUSHROOM_BY_ID.get(state.mushroom) : undefined;
    if (!m) {
      card.replaceChildren(
        h(
          'p',
          { class: 'legend-hint' },
          'Choisissez un champignon : la carte montre ses forêts hôtes et, sur une grille, l’indice de pousse calculé avec la météo des 20 derniers jours. Touchez ensuite la carte pour le bilan d’un coin.',
        ),
      );
      return;
    }
    const [, start, end] = m.lag;
    card.replaceChildren(
      h('p', { class: 'mushroom-card__summary' }, h('em', {}, m.latin), ' — ', m.summary),
      h(
        'dl',
        { class: 'mushroom-card__facts' },
        h('dt', {}, 'Arbres'),
        h('dd', {}, hostText(m)),
        h('dt', {}, 'Sols'),
        h('dd', {}, soilText(m)),
        h('dt', {}, 'Après la pluie'),
        h('dd', {}, `${start} à ${end} jours`),
        h('dt', {}, 'Températures'),
        h('dd', {}, `${m.temp[0]} à ${m.temp[1]} °C en moyenne`),
        h('dt', {}, 'Saison'),
        h('dd', {}, seasonText(m)),
      ),
    );
  };
  return { el: section.el, sync };
}

/** Nature du sol : motifs sur la carte, champignons favorisés entre parenthèses. */
export function soilSection(store: Store): { el: HTMLElement; sync(state: AppState): void } {
  const toggle = switchInput('Afficher la nature du sol');
  toggle.addEventListener('change', () => store.update({ geology: toggle.checked }));

  const rows = new Map<string, HTMLLIElement>();
  const list = h('ul', { class: 'soil-list' });
  for (const s of SOIL_CLASSES) {
    const swatch = h('span', { class: 'swatch swatch--pattern', 'aria-hidden': 'true' });
    swatch.style.backgroundImage = `url(${drawPattern(s.pattern, 16, 2).toDataURL()})`;
    const item = h(
      'li',
      { class: 'soil-item', 'data-soil': s.id },
      swatch,
      h(
        'span',
        { class: 'soil-item__text' },
        h('strong', {}, s.label),
        ` (${s.mushrooms})`,
        h('small', {}, s.ground),
      ),
    );
    rows.set(s.id, item);
    list.append(item);
  }
  const content = h(
    'div',
    {},
    h('div', { class: 'legend-card legend-card--soil' }, list),
    h(
      'p',
      { class: 'legend-hint' },
      `Couverture : ${GEOLOGY.coverage}, à partir du zoom ${GEOLOGY.minZoom}. La géologie donne la tendance du sol (acide, calcaire…), pas le sol exact. Source : BRGM, carte géologique au 1/50 000.`,
    ),
  );
  const section = collapsible(sectionTitle('Nature du sol', 'strata'), content, false, toggle);
  let wasOn = store.state.geology;

  const sync = (state: AppState): void => {
    if (state.geology && !wasOn) section.setExpanded(true); // montrer la légende à l'allumage
    wasOn = state.geology;
    toggle.checked = state.geology;
    const m = state.mushroom ? MUSHROOM_BY_ID.get(state.mushroom) : undefined;
    for (const [id, row] of rows) {
      const pref = m ? m.soils[id as keyof Mushroom['soils']] : 0;
      row.classList.toggle('is-favored', Boolean(m) && pref >= 0.9);
      row.title = m ? `${m.label} : ${pref >= 0.9 ? 'sol favorable' : pref >= 0.6 ? 'sol correct' : 'sol peu favorable'}` : '';
    }
  };
  return { el: section.el, sync };
}

/** Météo des 20 derniers jours : pluie cumulée ou indice de pousse, sur une grille. */
export function weatherSection(store: Store, meteo: MeteoLayer): { el: HTMLElement; sync(state: AppState): void } {
  const toggle = switchInput('Afficher la grille météo');
  toggle.addEventListener('change', () =>
    store.update({ weatherMode: toggle.checked ? (store.state.mushroom ? 'indice' : 'pluie') : 'off' }),
  );

  const radios = h('div', { class: 'basemaps', role: 'radiogroup', 'aria-label': 'Grille météo' });
  const inputs = new Map<string, HTMLInputElement>();
  const indexLabel = h('span', {});
  for (const [mode, label] of [
    ['pluie', h('span', {}, 'Pluie cumulée')],
    ['indice', indexLabel],
  ] as const) {
    const input = h('input', { type: 'radio', name: 'meteo', value: mode });
    input.addEventListener('change', () => {
      if (input.checked) store.update({ weatherMode: mode });
    });
    inputs.set(mode, input);
    radios.append(h('label', { class: 'basemap-option' }, input, label));
  }

  const scale = h('ul', { class: 'scale' });
  const status = h('p', { class: 'legend-hint', 'aria-live': 'polite' });
  const content = h(
    'div',
    {},
    radios,
    scale,
    status,
    h(
      'p',
      { class: 'legend-hint' },
      'Cases de 4,5 km, températures ramenées à l’altitude moyenne de chaque case. Pour un coin précis (forêt, sol, altitude exacte), touchez la carte. Météo : Open-Meteo.',
    ),
  );
  const section = collapsible(sectionTitle('Météo des 20 derniers jours', 'rain'), content, false, toggle);
  let wasOn = store.state.weatherMode !== 'off';

  let lastStatus: Parameters<typeof describeStatus>[0] = { state: 'off' };
  meteo.onStatus((s) => {
    lastStatus = s;
    status.textContent = describeStatus(s, store.state);
  });

  const sync = (state: AppState): void => {
    const on = state.weatherMode !== 'off';
    if (on && !wasOn) section.setExpanded(true); // montrer l'échelle des couleurs à l'allumage
    wasOn = on;
    toggle.checked = on;
    for (const [mode, input] of inputs) {
      input.checked = state.weatherMode === mode;
      input.disabled = state.weatherMode === 'off';
    }
    const m = MUSHROOM_BY_ID.get(indexMushroom(state));
    indexLabel.textContent = `Indice de pousse : ${m?.label.toLowerCase() ?? ''}`;
    const items =
      state.weatherMode === 'indice'
        ? LEVELS.map((l) => [l.color, l.label] as const)
        : RAIN_STEPS.map((s) => [s.color, s.label] as const);
    scale.replaceChildren(
      ...items.map(([color, label]) => h('li', {}, h('span', { class: 'swatch', style: `--swatch: ${color}` }), label)),
    );
    scale.hidden = state.weatherMode === 'off';
    status.textContent = describeStatus(lastStatus, state);
  };
  return { el: section.el, sync };
}
