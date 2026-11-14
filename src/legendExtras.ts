/**
 * Sections ajoutées au panneau « Légendes » : « Je cherche… », nature du sol, météo.
 * Comme le reste du panneau, elles ne touchent jamais la carte : elles lisent et modifient le Store.
 */
import { BDFORET, BUILT_MAX_COVER, FINE_MIN_ZOOM, GEOLOGY, HOST_MIN_COVER, WEATHER_SUB_MIN_ZOOM, ZONES } from './config';
import { h } from './dom';
import { CLASS_BY_CODE } from './forestClasses';
import { ABOUT_URL } from './legal';
import { CELL_KM } from './meteoGrid';
import { RAIN_STEPS, describeStatus, indexMushroom, type MeteoLayer } from './meteoLayer';
import {
  CHANCE_THRESHOLD,
  GENERAL_CAUTION,
  HOTSPOT_MIN_CHANCE,
  LEVELS,
  MUSHROOMS,
  MUSHROOM_BY_ID,
  currentMonth,
  hostCodes,
  isDormant,
  noEstimate,
  offSeasonText,
  seasonText,
  type Mushroom,
} from './mushrooms';
import { SOIL_CLASSES, drawPattern } from './soils';
import type { AppState, Store } from './state';
import { collapsible, sectionTitle, switchInput } from './ui';
import { onZonesInfo, zonesInfo } from './zones';

/** Mélanges et forêts mixtes : regroupés en « et leurs mélanges » pour rester lisible. */
const MIXTURES = new Set(['FF1-00-00', 'FF2-00-00', 'FF2-80-80', 'FF2-90-90', 'FF31', 'FF32', 'FO3']);

function hostText(m: Mushroom): string {
  if (m.trees) return m.trees;
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
  // Hors saison de plus d'un mois : puce grisée et en tirets (pas la couleur seule), toujours
  // cliquable : sa fiche et ses forêts hôtes servent à préparer la saison. Le nom du bouton ne change
  // pas ; « hors saison (…) » est sa description (aria-describedby), lue après lui.
  const notes = h('div', { class: 'visually-hidden' });
  const noteOf = new Map<string, HTMLElement>();
  for (const m of MUSHROOMS) {
    const note = h('span', { id: `saison-${m.id}` });
    noteOf.set(m.id, note);
    notes.append(note);
    const button = h('button', { class: 'chip chip--mushroom', type: 'button', 'aria-pressed': 'false' }, m.label);
    button.addEventListener('click', () => {
      if (store.state.mushroom === m.id) {
        store.update({ mushroom: null });
        return;
      }
      // Hors saison, la grille d'indice n'aurait rien à montrer : on garde le mode météo en cours
      // (la pluie, si elle était affichée) au lieu de la remplacer par une grille vide.
      if (noEstimate(m, currentMonth())) store.update({ mushroom: m.id, selected: new Set(hostCodes(m)) });
      else store.update({ mushroom: m.id, selected: new Set(hostCodes(m)), weatherMode: 'indice' });
    });
    buttons.set(m.id, button);
    chips.append(button);
  }
  const card = h('div', { class: 'mushroom-card' });
  const content = h('div', {}, chips, notes, card);
  const section = collapsible(sectionTitle('Je cherche…', 'mushroom'), content, true);
  // La fiche est refaite à chaque changement d'état : on retient si ses conditions sont dépliées.
  let factsOpen = false;

  const sync = (state: AppState): void => {
    const month = currentMonth();
    for (const [id, b] of buttons) {
      b.setAttribute('aria-pressed', String(state.mushroom === id));
      // Refait à chaque passage, pas seulement à la construction : le mois peut changer en cours de visite.
      const mushroom = MUSHROOM_BY_ID.get(id as Mushroom['id']);
      const dormant = Boolean(mushroom) && isDormant(mushroom as Mushroom, month);
      const note = noteOf.get(id);
      b.classList.toggle('chip--dormant', dormant);
      if (dormant && note && mushroom) {
        note.textContent = offSeasonText(mushroom);
        b.setAttribute('aria-describedby', note.id);
      } else {
        if (note) note.textContent = '';
        b.removeAttribute('aria-describedby');
      }
    }
    const m = state.mushroom ? MUSHROOM_BY_ID.get(state.mushroom) : undefined;
    if (!m) {
      card.replaceChildren(
        h(
          'p',
          { class: 'legend-hint' },
          'Choisissez un champignon : la carte estime sa chance là où poussent ses arbres hôtes, d’après la météo des derniers jours. Touchez-la ensuite pour le bilan d’un coin.',
        ),
      );
      return;
    }
    const [, start, end] = m.lag;
    const dormant = isDormant(m, month);
    const outOfSeason = noEstimate(m, month);
    const facts = h(
      'details',
      { class: 'legend-help mushroom-card__more', open: factsOpen },
      h('summary', {}, 'Ses conditions : arbres, sols, saison'),
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
    facts.addEventListener('toggle', () => {
      factsOpen = facts.open;
    });
    card.replaceChildren(
      h('p', { class: 'mushroom-card__summary' }, h('em', {}, m.latin), ' — ', m.summary),
      ...(dormant
        ? [
            h(
              'p',
              { class: 'mushroom-card__season' },
              `Hors saison en ce moment (saison : ${seasonText(m)}) : aucune chance estimée n’est calculée. Ses forêts hôtes sont cochées dans « Types de forêt » (visibles à partir du zoom ${BDFORET.minZoom}).`,
            ),
          ]
        : outOfSeason
          ? [h('p', { class: 'mushroom-card__season' }, `Hors saison en ce moment : aucune chance estimée avant la saison (${seasonText(m)}).`)]
          : []),
      // Lien vers une fiche de référence : libellé neutre, espèce nommée (l'entrée est souvent un
      // groupe), site tiers annoncé. L'encadré de précaution reste la dernière chose lue.
      h(
        'p',
        { class: 'mushroom-card__link' },
        h(
          'a',
          { class: 'legend-link', href: m.sheet.url, target: '_blank', rel: 'noopener noreferrer' },
          'Photos et description : ',
          h('em', {}, m.sheet.species),
          ' sur MycoDB (site tiers) ↗',
          h('span', { class: 'visually-hidden' }, ' (nouvel onglet)'),
        ),
      ),
      facts,
      h(
        'div',
        { class: 'mushroom-card__caution', role: 'note' },
        ...(m.caution ? [h('p', {}, h('strong', {}, 'Attention : '), m.caution)] : []),
        h('p', {}, GENERAL_CAUTION),
      ),
    );
  };
  return { el: section.el, sync };
}

/** « Droit de cueillir » : zones protégées (affichées par défaut) et forêts publiques, à titre indicatif. */
export function zonesSection(store: Store): { el: HTMLElement; sync(state: AppState): void } {
  const protectedToggle = switchInput('Afficher les zones protégées');
  protectedToggle.addEventListener('change', () => store.update({ zones: protectedToggle.checked }));
  const publicToggle = switchInput('Afficher les forêts publiques');
  publicToggle.addEventListener('change', () => store.update({ publicForests: publicToggle.checked }));

  const row = (toggle: HTMLInputElement, kind: string, title: string, text: string): HTMLElement =>
    h(
      'div',
      { class: 'zone-row' },
      h('span', { class: `zone-swatch zone-swatch--${kind}`, 'aria-hidden': 'true' }),
      h('span', { class: 'zone-row__text' }, h('strong', {}, title), h('small', {}, text)),
      toggle,
    );
  const status = h('p', { class: 'legend-hint' });
  const content = h(
    'div',
    {},
    h(
      'div',
      { class: 'legend-card legend-card--zones' },
      row(
        protectedToggle,
        'protected',
        'Zones protégées',
        'Réserves naturelles et biologiques, cœurs de parc national, arrêtés de biotope, terrains des conservatoires : la cueillette y est souvent interdite ou limitée.',
      ),
      row(
        publicToggle,
        'public',
        'Forêts publiques',
        'Forêts domaniales et communales : cueillette familiale en général tolérée, sauf interdiction. Ailleurs, la forêt est le plus souvent privée : il faut l’accord du propriétaire.',
      ),
    ),
    status,
    h('p', { class: 'legend-hint' }, h('a', { class: 'legend-link', href: `${ABOUT_URL}#regles` }, 'Règles de cueillette et quantités')),
  );
  const describe = (): void => {
    const { state, info } = zonesInfo();
    const day = info?.genere ? new Date(info.genere) : null;
    const when = day && !Number.isNaN(day.getTime()) ? `, données du ${day.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : '';
    status.textContent =
      state === 'missing'
        ? 'Données des zones indisponibles pour le moment : le bilan d’un coin ne dit rien du statut du terrain.'
        : `${ZONES.coverage}, à partir du zoom ${ZONES.minZoom}${when}. Sources : PatriNat (OFB, MNHN) et IGN (BD TOPO, d’après l’ONF). Indicatif : seuls les textes officiels et les panneaux sur place font foi.`;
  };
  onZonesInfo(describe);
  describe();
  // Même intitulé que dans le bilan d'un coin : « Où cueillir » pouvait se lire « où l'on a le droit ».
  const section = collapsible(sectionTitle('Droit de cueillir', 'shield'), content, false);
  const sync = (state: AppState): void => {
    protectedToggle.checked = state.zones;
    publicToggle.checked = state.publicForests;
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
  const section = collapsible(sectionTitle('Nature du sol', 'strata'), content, store.state.geology, toggle);
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

/** Météo : pluie des 20 derniers jours ou chance estimée du champignon recherché, sur une grille. */
export function weatherSection(store: Store, meteo: MeteoLayer): { el: HTMLElement; sync(state: AppState): void } {
  const toggle = switchInput('Afficher la grille météo');
  toggle.addEventListener('change', () => {
    // Allumer la grille montre l'indice du champignon choisi, sauf s'il est hors saison : la grille
    // d'indice serait vide, alors que la pluie a quelque chose à montrer.
    const chosen = store.state.mushroom ? MUSHROOM_BY_ID.get(store.state.mushroom) : undefined;
    store.update({ weatherMode: toggle.checked ? (chosen && !noEstimate(chosen, currentMonth()) ? 'indice' : 'pluie') : 'off' });
  });

  const radios = h('div', { class: 'basemaps', role: 'radiogroup', 'aria-label': 'Grille météo' });
  const inputs = new Map<string, HTMLInputElement>();
  const indexLabel = h('span', {});
  for (const [mode, label] of [
    ['pluie', h('span', {}, 'Pluie des 20 derniers jours')],
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
  // Toujours sous les yeux quand la grille est allumée : ce que vaut le chiffre. Le mode d'emploi, lui, se déplie.
  const caveat = h(
    'p',
    { class: 'legend-hint legend-hint--caveat' },
    'Seuls les secteurs où poussent ses arbres hôtes sont colorés. Chances estimées, pas mesurées : ni promesse d’en trouver, ni droit de cueillir, ni avis sur ce qui se mange.',
  );
  const content = h(
    'div',
    {},
    radios,
    scale,
    caveat,
    status,
    h(
      'details',
      { class: 'legend-help' },
      h('summary', {}, 'Comment c’est calculé'),
      h(
        'p',
        {},
        `Pluie et températures par cases d’environ ${CELL_KM} km sur toute la France, mises à jour une fois par jour. L’estimation se précise en zoomant : cases de ${CELL_KM} km en vue d’ensemble, carrés de 4,5 km avec leur pourcentage à partir du zoom ${WEATHER_SUB_MIN_ZOOM}, puis carrés de 500 m là où poussent les arbres hôtes à partir du zoom ${FINE_MIN_ZOOM}, avec le sol de chacun. Les températures sont ramenées à l’altitude de chaque carré ; la pluie reste celle de la case.`,
      ),
      h(
        'p',
        {},
        `Un carré de 4,5 km n’est coloré que si les arbres hôtes du champignon y couvrent au moins ${Math.round(HOST_MIN_COVER * 100)} % de la surface (BD Forêt de l’IGN) et si moins de ${Math.round(BUILT_MAX_COVER * 100)} % est bâti (Plan IGN) ; il l’est d’autant plus qu’il est boisé. Son pourcentage vaut pour ces forêts, sans tenir compte du sol. En ville, les carrés de 500 m ne montrent que les vrais massifs, pas les parcs. Le bilan d’un coin, lui, regarde la forêt et le sol du point touché : son chiffre peut différer, plus haut ou plus bas.`,
      ),
      h(
        'p',
        {},
        `En dessous de ${CHANCE_THRESHOLD} %, peu d’espoir sans connaître un coin précis : la carte n’étiquette que les carrés au-dessus. En vue d’ensemble, une pastille marque les secteurs à ${HOTSPOT_MIN_CHANCE} % et plus : son chiffre est celui du meilleur carré de 4,5 km de la case. Pour un point précis, touchez la carte. Météo : Open-Meteo (modèles, pas de pluviomètres).`,
      ),
      h(
        'p',
        {},
        'Un champignon à plus d’un mois de sa saison est grisé et en pointillés dans « Je cherche… » : aucune chance estimée n’est calculée pour lui, ni sur la carte ni dans le bilan.',
      ),
    ),
  );
  // Dépliée dès que la grille est allumée, y compris au chargement : une grille sans son échelle ne se lit pas.
  const section = collapsible(sectionTitle('Météo', 'rain'), content, store.state.weatherMode !== 'off', toggle);
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
    // Champignon montré hors saison : rien n'est coloré, l'échelle et sa mise en garde n'ont pas lieu d'être.
    const offSeason = state.weatherMode === 'indice' && Boolean(m) && noEstimate(m as Mushroom, currentMonth());
    indexLabel.textContent = `Chance estimée : ${m?.label.toLowerCase() ?? ''}${m && noEstimate(m, currentMonth()) ? ' (hors saison)' : ''}`;
    const items =
      state.weatherMode === 'indice'
        ? LEVELS.map((l) => [l.color, `${l.label} (${l.range})`] as const)
        : RAIN_STEPS.map((s) => [s.color, s.label] as const);
    scale.replaceChildren(
      ...items.map(([color, label]) => h('li', {}, h('span', { class: 'swatch', style: `--swatch: ${color}` }), label)),
    );
    scale.hidden = state.weatherMode === 'off' || offSeason;
    caveat.hidden = state.weatherMode !== 'indice' || offSeason;
    status.textContent = describeStatus(lastStatus, state);
  };
  return { el: section.el, sync };
}
