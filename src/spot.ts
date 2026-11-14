import maplibregl, { type LngLat, type Map as MapLibreMap, type PointLike } from 'maplibre-gl';
import { BDFORET, BUILT_MAX_COVER, DIRECT_PAST_DAYS, FINE_MIN_ZOOM, GEOLOGY, HOST_MIN_COVER, SPOT_ALTITUDE_TIMEOUT_MS, SPOT_ALTITUDE_WAIT_MS } from './config';
import { h, toast } from './dom';
import { hostCover, isLit, loadForestShare } from './forestShare';
import { forestAt, soilAt, type ForestAtPoint, type SoilAtPoint } from './geology';
import { icon } from './icons';
import { ABOUT_URL } from './legal';
import { track } from './metrics';
import {
  AWAITED,
  CHANCE_THRESHOLD,
  LEVELS,
  MUSHROOMS,
  MUSHROOM_BY_ID,
  currentMonth,
  isDormant,
  noEstimate,
  offSeasonText,
  scoreMushroom,
  type Mushroom,
  type MushroomId,
  type MushroomScore,
  type SpotContext,
} from './mushrooms';
import { SOURCES, setHighlight } from './mapStyle';
import { CELL_KM, KEPT_DAYS, cellAt, cellId, subIndexAt } from './meteoGrid';
import { patternImageId, drawPattern } from './soils';
import type { Store } from './state';
import { fetchAltitude, summarize, weatherAt, type WeatherSummary } from './weather';
import { zonesAt, type ZonesAtPoint } from './zones';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Histogramme de la pluie jour par jour ; les jours des grosses pluies sont plus foncés. */
function rainChart(w: WeatherSummary): SVGSVGElement {
  const width = 240;
  const height = 64;
  const n = w.days.length;
  const max = Math.max(20, ...w.days.map((d) => d.rain ?? 0));
  const barW = width / n;
  const peaks = new Set(w.events.map((e) => e.date));
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height + 14}`, class: 'rain-chart', role: 'img' });
  chart.setAttribute('aria-label', `Pluie jour par jour sur ${n} jours, ${Math.round(w.rain30)} mm au total`);
  chart.append(svg('line', { x1: 0, y1: height, x2: width, y2: height, class: 'rain-chart__axis' }));
  w.days.forEach((d, i) => {
    if (d.rain === null) {
      // Jour pas encore connu : un tiret sous l'axe.
      chart.append(svg('line', { x1: i * barW + 2, y1: height + 2, x2: (i + 1) * barW - 2, y2: height + 2, class: 'rain-chart__unknown' }));
      return;
    }
    const bh = d.rain > 0 ? Math.max(1.5, (d.rain / max) * (height - 12)) : 0;
    if (!bh) return;
    const bar = svg('rect', {
      x: i * barW + 1,
      y: height - bh,
      width: barW - 2,
      height: bh,
      rx: 1.5,
      class: `rain-chart__bar${peaks.has(d.date) ? ' rain-chart__bar--peak' : ''}${d.estimated ? ' rain-chart__bar--estimated' : ''}`,
    });
    const title = svg('title', {});
    title.textContent = `${new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} : ${d.rain.toFixed(1)} mm${d.estimated ? ' (estimation)' : ''}`;
    bar.append(title);
    chart.append(bar);
    if (peaks.has(d.date)) {
      const label = svg('text', { x: i * barW + barW / 2, y: height - bh - 3, class: 'rain-chart__value', 'text-anchor': 'middle' });
      label.textContent = `${Math.round(d.rain)}`;
      chart.append(label);
    }
  });
  const left = svg('text', { x: 0, y: height + 12, class: 'rain-chart__tick' });
  left.textContent = `il y a ${n} j`;
  const right = svg('text', { x: width, y: height + 12, class: 'rain-chart__tick', 'text-anchor': 'end' });
  right.textContent = 'hier';
  chart.append(left, right);
  return chart;
}

function patternSwatch(soil: SoilAtPoint['soil']): HTMLSpanElement {
  const swatch = h('span', { class: 'swatch swatch--pattern', 'aria-hidden': 'true' });
  swatch.style.backgroundImage = `url(${drawPattern(soil.pattern, 16, 2).toDataURL()})`;
  swatch.dataset['pattern'] = patternImageId(soil.id);
  return swatch;
}

function row(label: string, ...value: (Node | string)[]): HTMLElement {
  return h('div', { class: 'spot__row' }, h('dt', {}, label), h('dd', {}, ...value));
}

/** De septembre à février, les battues sont fréquentes. */
const huntingSeason = (month = currentMonth()): boolean => month >= 9 || month <= 2;

/**
 * Statut du terrain en une ligne, toujours visible : un fait et ce qu'il implique, jamais « autorisé ».
 * Les données sont indicatives : on ne parle du statut que si elles sont bien chargées.
 */
function statusValue(zones: ZonesAtPoint, forest: ForestAtPoint | null): HTMLElement {
  const value = (...parts: (Node | string)[]): HTMLElement => h('span', { class: 'spot__value spot__status-value' }, ...parts);
  // Inconnu : la règle par défaut reste vraie, autant la dire (le pourcentage s'affiche juste dessous).
  if (!zones.known) return value(h('strong', {}, 'Inconnu'), ` : il faut l’accord du propriétaire (${zones.reason ?? 'données absentes'})`);
  if (zones.publicForest) {
    return value(
      h('strong', {}, zones.publicForest.name),
      ` : forêt publique${zones.publicForest.domaniale ? ' (domaniale)' : ''}, cueillette familiale en général tolérée sauf interdiction`,
    );
  }
  if (zones.protections.some((z) => z.type === 'cdl')) return value(h('strong', {}, 'Propriété publique'), ' (Conservatoire du littoral)');
  // Dans une zone protégée, le propriétaire peut être public ou privé : on ne devine pas.
  if (zones.protections.length) return value(h('strong', {}, 'Propriétaire non identifié'), ' : accord à demander');
  if (forest) return value(h('strong', {}, 'Forêt sans doute privée'), ' : il faut l’accord du propriétaire');
  return value(h('strong', {}, 'Hors forêt cartographiée'), ' : il faut l’accord du propriétaire');
}

/** Zones protégées sous le point : un encadré chacune, toujours visible, que la météo réponde ou non. */
function zoneAlerts(zones: ZonesAtPoint): HTMLElement | null {
  if (!zones.known || !zones.protections.length) return null;
  return h(
    'div',
    { class: 'spot__alerts' },
    ...zones.protections.map((zone) =>
      h(
        'div',
        { class: 'spot__alert', role: 'note' },
        h('span', { class: 'spot__alert-icon' }, icon('alert')),
        h(
          'div',
          {},
          h('strong', {}, zone.label),
          zone.name ? ` « ${zone.name} »` : '',
          h('p', {}, 'Son règlement peut interdire ou limiter la cueillette : consultez-le avant de cueillir.'),
          zone.url ? h('a', { href: zone.url, target: '_blank', rel: 'noopener' }, 'Fiche officielle de la zone (INPN) ↗') : null,
        ),
      ),
    ),
  );
}

/** Ce que le statut du terrain implique, en clair : détail replié sous « Droit de cueillir : les règles ». */
function rulesText(zones: ZonesAtPoint, forest: ForestAtPoint | null): HTMLElement {
  if (!zones.known) {
    return h('p', { class: 'spot__rule' }, `Statut du terrain inconnu : ${zones.reason ?? 'données absentes'}. Dans le doute, il faut l’accord du propriétaire.`);
  }
  if (zones.publicForest) {
    return h(
      'p',
      { class: 'spot__rule' },
      h('strong', {}, zones.publicForest.name),
      ` : forêt publique${zones.publicForest.domaniale ? ' (domaniale)' : ''}, gérée par l’ONF. Une cueillette familiale y est en général tolérée, sauf interdiction (arrêté, panneau).`,
    );
  }
  if (zones.protections.some((z) => z.type === 'cdl')) {
    return h('p', { class: 'spot__rule' }, h('strong', {}, 'Propriété publique'), ' (Conservatoire du littoral) : suivez le règlement affiché sur place.');
  }
  if (zones.protections.length) {
    return h('p', { class: 'spot__rule' }, h('strong', {}, 'Propriétaire non identifié'), ' : demandez l’accord du propriétaire ou du gestionnaire de la zone.');
  }
  if (forest) {
    return h(
      'p',
      { class: 'spot__rule' },
      h('strong', {}, 'Forêt sans doute privée'),
      ' : elle ne figure pas parmi les forêts publiques de l’IGN. Il faut l’accord du propriétaire pour cueillir.',
    );
  }
  return h('p', { class: 'spot__rule' }, h('strong', {}, 'Hors forêt cartographiée'), ' : la cueillette demande l’accord du propriétaire du terrain.');
}

/**
 * Ce qui écarte un champignon d'un coin sans rien calculer. `dormant` : hors saison de plus d'un mois
 * (ligne grisée). `zero` : l'indice vaut zéro par construction (pas la saison, pas de forêt, pas
 * d'arbre hôte), la ligne garde « ≈ 0 % » ; sinon (ville : on n'a rien estimé) elle n'affiche pas de
 * pourcentage, un « 0 % » y contredirait « zoomez pour juger ce bois ».
 */
interface Exclusion {
  why: string;
  dormant: boolean;
  zero: boolean;
}

/** Une ligne du bilan : un indice calculé, ou un champignon écarté sans calcul (`bare` : sans pourcentage). */
type Verdict = MushroomScore & { dormant?: boolean; bare?: boolean };

const URBAN = 'secteur urbanisé';

/** Le relevé des carrés de 500 m de la carte, vu du bilan (voir `MeteoLayer.townSquareKept`). */
export interface FineSurvey {
  townSquareKept(lat: number, lon: number, m: Mushroom): boolean | null;
}

/** Ce qu'il faut pour dessiner le bilan ; gardé pour le redessiner sans rien redemander. */
interface View {
  lat: number;
  lng: number;
  /** Zoom de la carte au moment du clic : les règles du bilan suivent ce que la carte montrait. */
  zoom: number;
  forest: ForestAtPoint | null;
  /** Forêt inconnue, pas absente : zoom trop petit pour ses tuiles, ou tuiles pas encore arrivées. */
  forestUnknown: 'zoom' | 'loading' | false;
  /** Carré de 4,5 km qui contient le point : ses arbres hôtes servent quand la forêt est inconnue. */
  sector: { cell: string; k: number };
  soil: SoilAtPoint | null;
  zones: ZonesAtPoint;
  altitude: number | null;
  weather: WeatherSummary | null;
  status: 'loading' | 'ok' | 'error';
  /** Météo lue dans les fichiers communs (sinon Open-Meteo en direct). */
  shared: boolean;
  /** L'altitude exacte n'est pas encore arrivée : le bilan sera refait. */
  altitudePending: boolean;
  /**
   * Champignons écartés de ce coin, décidés une fois par clic (null : pas encore décidé). S'ils le
   * sont tous, rien n'est demandé : ni altitude IGN, ni météo de secours.
   */
  excluded: ReadonlyMap<MushroomId, Exclusion> | null;
}

/**
 * Une raison du bilan. « pousse attendue d'ici N jours » y est en gras : c'est la seule qui dit
 * quand revenir, et elle se perdait dans la liste.
 */
export function reasonItem(text: string): HTMLLIElement {
  const hit = AWAITED.exec(text);
  if (!hit) return h('li', {}, text);
  return h('li', {}, text.slice(0, hit.index), h('strong', {}, hit[0]), text.slice(hit.index + hit[0].length));
}

/**
 * Bilan d'un coin, la réponse d'abord : zone protégée s'il y en a une, terrain (forêt, sol, altitude,
 * statut), puis une ligne par champignon du plus probable au moins probable, la pluie des 30 derniers
 * jours, et les règles de cueillette repliées. Panneau à droite sur grand écran, tiroir bas sur mobile.
 */
export class SpotPanel {
  private controller: AbortController | null = null;
  private marker: maplibregl.Marker | null = null;
  private readonly body = h('div', { class: 'spot__body' });
  private readonly coords = h('p', { class: 'spot__coords' });
  private view: View | null = null;
  // Ce que le visiteur a déplié : gardé d'un dessin à l'autre (le bilan est redessiné jusqu'à trois
  // fois par clic, à mesure que l'altitude et la météo arrivent), remis à zéro à chaque nouveau coin.
  private readonly cards = new Map<MushroomId, boolean>();
  private rulesOpen = false;
  private helpOpen = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly map: MapLibreMap,
    private readonly store: Store,
    private readonly survey: FineSurvey | null = null,
  ) {
    const close = h('button', { class: 'panel__close', type: 'button', 'aria-label': 'Fermer le bilan' }, icon('close'));
    close.addEventListener('click', () => this.close());
    root.replaceChildren(
      h(
        'div',
        { class: 'panel__header' },
        h('span', { class: 'panel__icon' }, icon('target')),
        h('div', { class: 'spot__heading' }, h('h2', { class: 'panel__title' }, 'Ce coin'), this.coords),
        close,
      ),
      this.body,
    );
    root.hidden = true;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.controller?.abort();
    this.root.hidden = true;
    this.marker?.remove();
    setHighlight(this.map, null);
  }

  /** Redessine le bilan ouvert (le champignon recherché a changé dans la légende). */
  refresh(): void {
    if (this.isOpen && this.view) this.draw();
  }

  /** Ouvre le bilan du point cliqué. */
  async open(lngLat: LngLat, point: PointLike): Promise<void> {
    track('app.spots');
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    const forest = forestAt(this.map, point);
    const soil = soilAt(this.map, point);
    const zones = zonesAt(this.map, point, lngLat);
    setHighlight(this.map, forest?.id ?? null);
    this.marker ??= new maplibregl.Marker({ color: '#6a6af4', scale: 0.7 });
    this.marker.setLngLat(lngLat).addTo(this.map);

    const lat = lngLat.lat.toFixed(5);
    const lng = lngLat.lng.toFixed(5);
    this.coords.textContent = `${lat}, ${lng}`;
    this.root.hidden = false;
    this.cards.clear();
    this.rulesOpen = false;
    this.helpOpen = false;
    const view: View = {
      lat: lngLat.lat,
      lng: lngLat.lng,
      zoom: this.map.getZoom(),
      forest,
      // Sous le zoom des tuiles de forêt, ou tant qu'elles ne sont pas arrivées (clic juste après un
      // zoom, réseau lent), rien n'est chargé sous le point : la forêt est inconnue, pas absente.
      forestUnknown: forest ? false : this.map.getZoom() < BDFORET.minZoom ? 'zoom' : this.forestLoading() ? 'loading' : false,
      sector: { cell: cellId(cellAt(lngLat.lat, lngLat.lng).i, cellAt(lngLat.lat, lngLat.lng).j), k: subIndexAt(lngLat.lat, lngLat.lng) },
      soil,
      zones,
      altitude: null,
      weather: null,
      status: 'loading',
      shared: true,
      altitudePending: false,
      excluded: null,
    };
    const show = (changes: Partial<View>): void => {
      this.view = { ...view, ...this.view, ...changes };
      this.draw();
    };
    this.view = null;
    show({});
    this.body.scrollTop = 0;
    // Arbres hôtes et part bâtie du secteur (même fichier que la grille de la carte) : sans eux, forêt
    // inconnue voulait dire « météo seule », et le bilan annonçait « favorable » en pleine ville.
    const shares = loadForestShare();
    // Un seul délai, compté depuis le clic : passé SPOT_ALTITUDE_WAIT_MS, on n'attend plus ni le
    // fichier des parts (on fait sans : météo seule), ni l'altitude exacte (la météo s'affiche déjà).
    const late = Symbol('late');
    const deadline = new Promise<typeof late>((resolve) => window.setTimeout(() => resolve(late), SPOT_ALTITUDE_WAIT_MS));

    try {
      // Y a-t-il quelque chose à estimer ici ? Décidé avant tout appel : pas de forêt hôte sous le
      // point, secteur sans arbres hôtes, ville, champignons hors saison… alors ni altitude IGN, ni
      // météo de secours (demande de Clément du 14/11/2026 : pas d'appel là où il n'y a pas de carré).
      const month = currentMonth();
      const decide = (): Map<MushroomId, Exclusion> => {
        const out = new Map<MushroomId, Exclusion>();
        for (const m of MUSHROOMS) {
          const why = this.exclusion(m, view, month, true);
          if (why) out.set(m.id, why);
        }
        return out;
      };
      const hopeless = !MUSHROOMS.some((m) => !this.exclusion(m, view, month, false));
      const ready = hopeless ? true : await Promise.race([shares.then(() => true), deadline]);
      if (controller.signal.aborted) return;
      let excluded = decide();
      if (ready === late) {
        // Le fichier des parts n'est pas arrivé à temps : on a décidé sans lui (météo seule). S'il
        // arrive ensuite, la décision est revue et le bilan redessiné : sinon il resterait
        // « favorable » en pleine ville. (L'altitude, elle, a peut-être été demandée pour rien.)
        void shares.then(() => {
          if (controller.signal.aborted) return;
          excluded = decide();
          show({ excluded });
        });
      }
      if (excluded.size === MUSHROOMS.length) {
        // Rien à estimer : les lignes des champignons s'affichent tout de suite, puis la pluie si les
        // fichiers du site la donnent (jamais Open-Meteo en direct pour un coin sans estimation).
        show({ excluded, status: 'ok' });
        const here = await weatherAt(lngLat.lat, lngLat.lng, null, controller.signal, true).catch(() => null);
        if (controller.signal.aborted) return;
        if (here) show({ weather: summarize(here.series), shared: true });
        return;
      }

      // Altitude exacte (IGN) : la demande s'arrête d'elle-même si le service ne répond pas.
      const asking = new AbortController();
      controller.signal.addEventListener('abort', () => asking.abort());
      const giveUp = window.setTimeout(() => asking.abort(), SPOT_ALTITUDE_TIMEOUT_MS);
      const exact = fetchAltitude(lngLat.lng, lngLat.lat, asking.signal)
        .catch(() => null)
        .finally(() => window.clearTimeout(giveUp));
      // Si elle tarde, la météo s'affiche déjà : la case commune qui contient le point, températures
      // à l'altitude de son carré de 4,5 km. Le bilan est refait quand l'altitude exacte arrive.
      const first = await Promise.race([exact, deadline]);
      if (controller.signal.aborted) return;
      if (first === late) {
        const early = await weatherAt(lngLat.lat, lngLat.lng, null, controller.signal, true);
        if (controller.signal.aborted) return;
        if (early) show({ excluded, weather: summarize(early.series), status: 'ok', shared: true, altitudePending: true });
      }
      const altitude = await exact;
      if (controller.signal.aborted) return;
      // Case météo commune (températures ramenées à l'altitude du point) ; Open-Meteo n'est appelé
      // que hors de France ou si les fichiers communs sont injoignables.
      const weather = await weatherAt(lngLat.lat, lngLat.lng, altitude, controller.signal);
      if (controller.signal.aborted) return;
      show({ excluded, altitude, weather: weather ? summarize(weather.series) : null, status: 'ok', shared: weather?.shared ?? false, altitudePending: false });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[bilan]', error);
      show({ status: 'error' });
    }
  }

  /**
   * Ce qui écarte un champignon de ce coin sans rien calculer, dans l'ordre : la saison, la forêt
   * sous le point, puis le secteur (peu d'arbres hôtes, ville). null : il y a quelque chose à estimer.
   * `sector` à faux : sans regarder le fichier des parts (ce qu'on peut dire avant qu'il soit chargé).
   *
   * Ville (carré de 4,5 km bâti à BUILT_MAX_COVER ou plus) : comme la carte. Sous le zoom des carrés
   * de 500 m, elle n'y allume rien, le bilan n'y estime rien non plus, même sur un bois ; au-delà,
   * il suit le relevé de la carte (`FineSurvey`) : un parc ou une lisière qu'elle ne dessine pas est
   * écarté, un massif qu'elle dessine est estimé. Relevé absent ou incomplet (grille éteinte, bord de
   * l'écran) : on estime, quitte à demander une altitude de trop.
   */
  private exclusion(m: Mushroom, v: View, month: number, sector: boolean): Exclusion | null {
    if (noEstimate(m, month)) return { why: offSeasonText(m), dormant: isDormant(m, month), zero: true };
    const out = (why: string, zero = true): Exclusion => ({ why, dormant: false, zero });
    if (!v.forestUnknown) {
      // Mêmes mots que la ligne « Forêt » du bilan : sous le point, pas alentour (un chemin, une clairière).
      if (!v.forest) return out('pas de forêt cartographiée sous ce point');
      if (!((m.hosts[v.forest.code] ?? 0) > 0)) return out('pas un arbre hôte ici');
      if (!sector) return null;
      const host = hostCover(v.sector.cell, v.sector.k, m);
      if (!host || host.built < BUILT_MAX_COVER) return null;
      if (v.zoom < FINE_MIN_ZOOM) return out(`${URBAN} : zoomez pour juger ce bois`, false);
      return this.survey?.townSquareKept(v.lat, v.lng, m) === false ? out(`${URBAN}, trop peu de bois autour du point`, false) : null;
    }
    if (!sector) return null;
    // Forêt inconnue sous le point : la règle du carré de la carte. Fichier des parts absent : météo
    // seule. La part bâtie ne compte que sous le zoom des carrés de 500 m : au-delà la carte les
    // dessine jusque dans les massifs en ville, et le bilan les contredirait.
    const host = hostCover(v.sector.cell, v.sector.k, m);
    if (!host) return null;
    if (host.cover < HOST_MIN_COVER) return out('peu d’arbres hôtes dans ce secteur');
    return v.zoom < FINE_MIN_ZOOM && !isLit(host) ? out(URBAN, false) : null;
  }

  /** Les tuiles de la BD Forêt de la vue ne sont pas toutes arrivées. */
  private forestLoading(): boolean {
    try {
      return !this.map.isSourceLoaded(SOURCES.bdForet);
    } catch {
      return false;
    }
  }

  /** Règles de cueillette, repliées : le statut du terrain, lui, est déjà dit dans le tableau du haut. */
  private rulesSection(zones: ZonesAtPoint, forest: ForestAtPoint | null): HTMLElement {
    const details = h(
      'details',
      { class: 'spot__section spot__rules', open: this.rulesOpen },
      h('summary', { class: 'spot__title spot__fold', 'data-focus': 'rules' }, 'Droit de cueillir : les règles'),
      rulesText(zones, forest),
      h(
        'p',
        { class: 'spot__rule spot__rule--muted' },
        'Sans autorisation, cueillir est une contravention, et un délit au-delà de 10 litres. Des arrêtés limitent souvent les quantités : renseignez-vous en mairie.',
        huntingSeason() ? ' Saison de chasse : portez une couleur vive.' : '',
      ),
      h('p', { class: 'spot__rule' }, h('a', { class: 'legend-link', href: `${ABOUT_URL}#regles` }, 'Règles de cueillette et quantités')),
    );
    details.addEventListener('toggle', () => {
      this.rulesOpen = details.open;
    });
    return details;
  }

  /**
   * Une ligne par champignon, du plus probable au moins probable. Les raisons sont repliées, sauf
   * pour le champignon recherché (ou, sans recherche, pour le premier s'il vaut le déplacement) ;
   * celui que la saison ou la forêt exclut tient sur une ligne, avec ce qui l'exclut.
   */
  private mushroomSection(scores: readonly Verdict[], urban: boolean): HTMLElement {
    const chosen = this.store.state.mushroom;
    // Tri sur l'indice, sans exception parmi les champignons de saison ; ceux qui sont hors saison de
    // plus d'un mois (grisés, sans pourcentage : rien n'est calculé) viennent ensuite, dans l'ordre de la liste.
    const ranked = [...scores.filter((s) => !s.dormant).sort((a, b) => b.score - a.score), ...scores.filter((s) => s.dormant)];
    const lead = ranked[0];
    const opened = ranked.some((s) => s.id === chosen && !s.blocker) ? chosen : lead && !lead.blocker && lead.chance >= CHANCE_THRESHOLD ? lead.id : null;

    const list = h('ul', { class: 'verdicts' });
    for (const s of ranked) {
      const m = MUSHROOM_BY_ID.get(s.id);
      const level = LEVELS[s.level];
      const name = h('strong', {}, m?.label ?? s.id);
      const pill = h('span', { class: 'level-pill', style: `--level: ${level?.color ?? '#999'}` }, `≈ ${s.chance} % · ${(level?.label ?? '').toLowerCase()}`);
      const tag = s.id === chosen ? h('span', { class: 'verdict__tag' }, 'recherché') : null;
      const classes = `verdict verdict--${s.level}${s.id === chosen ? ' verdict--chosen' : ''}`;
      if (s.blocker) {
        list.append(
          h(
            'li',
            { class: `${classes} verdict--off${s.dormant ? ' verdict--dormant' : ''}` },
            h('div', { class: 'verdict__head' }, h('span', { class: 'verdict__name' }, name, tag, h('span', { class: 'verdict__why' }, s.blocker)), s.bare ? null : pill),
          ),
        );
        continue;
      }
      const card = h(
        'details',
        { class: 'verdict__card', open: this.cards.get(s.id) ?? s.id === opened },
        h('summary', { class: 'verdict__head', 'data-focus': `verdict:${s.id}` }, h('span', { class: 'verdict__name' }, name, tag), pill),
        h('ul', { class: 'verdict__reasons' }, ...s.reasons.map(reasonItem)),
      );
      // On ne retient que ce qui s'écarte de l'état d'office : un <details> créé ouvert émet lui aussi
      // « toggle », et la ligne dépliée d'office resterait dépliée quand le champignon recherché change.
      const auto = s.id === opened;
      card.addEventListener('toggle', () => {
        if (card.open === auto) this.cards.delete(s.id);
        else this.cards.set(s.id, card.open);
      });
      list.append(h('li', { class: classes }, card));
    }

    // Le « ? » : une explication dépliée sur place, au clic comme au clavier (pas de survol sur téléphone).
    const helpId = 'spot-chance-help';
    const help = h(
      'button',
      { class: 'help-btn', type: 'button', 'data-focus': 'help', 'aria-expanded': String(this.helpOpen), 'aria-controls': helpId, 'aria-label': 'Comment la chance estimée est calculée' },
      '?',
    );
    const note = h(
      'div',
      { id: helpId, class: 'help-note', hidden: !this.helpOpen },
      h(
        'p',
        {},
        h('strong', {}, 'Comment c’est estimé. '),
        'Indice = saison × pluie × température × arbre hôte × sol, chacun noté de 0 à 1 selon des règles de cueilleur : un seul à zéro (hors saison, pas d’arbre hôte) et l’estimation tombe à 0 %.',
      ),
      h(
        'p',
        {},
        'Le pourcentage place cet indice sur une échelle fixée à la main, jamais au-dessus de 95 %. Ce n’est pas une probabilité mesurée : un coin « favorable » peut être vide. ',
        h('a', { class: 'legend-link', href: `${ABOUT_URL}#fiabilite` }, 'Méthode et limites'),
      ),
    );
    const toggleHelp = (open: boolean): void => {
      this.helpOpen = open;
      note.hidden = !open;
      help.setAttribute('aria-expanded', String(open));
    };
    help.addEventListener('click', () => toggleHelp(!this.helpOpen));
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.helpOpen) return;
      event.stopPropagation();
      toggleHelp(false);
      help.focus();
    };
    help.addEventListener('keydown', onEscape);
    note.addEventListener('keydown', onEscape);

    return h(
      'section',
      { class: 'spot__section' },
      h('div', { class: 'spot__title-row' }, h('h3', { class: 'spot__title' }, 'Champignons · chance estimée'), help),
      note,
      list,
      // En secteur urbanisé, le conseil de « À propos » (Anses) : il vaut que le bilan estime ou non.
      urban
        ? h(
            'p',
            { class: 'spot__rule spot__urban' },
            'Secteur urbanisé : cueillez loin des routes, des zones industrielles et des décharges, les champignons absorbent les polluants. ',
            h('a', { class: 'legend-link', 'data-focus': 'conseils', href: `${ABOUT_URL}#identifier` }, 'Conseils de cueillette'),
          )
        : null,
    );
  }

  private draw(): void {
    const v = this.view;
    if (!v) return;
    const { forest, soil, zones, altitude, weather, status, shared, excluded } = v;
    // Aucun champignon à estimer ici : rien n'a été demandé (ni altitude, ni météo de secours).
    const nothing = excluded?.size === MUSHROOMS.length;
    // Sans altitude exacte, celle que la grille météo donne au carré de 4,5 km (fichiers communs).
    const approximate = altitude === null && weather && shared ? `≈ ${Math.round(weather.elevation)} m (d’après la grille météo)` : null;
    const terrain = h('dl', { class: 'spot__facts' });
    terrain.append(
      row(
        'Forêt',
        ...(forest
          ? [h('span', { class: 'swatch', style: `--swatch: ${forest.cls?.color ?? '#999'}` }), h('span', { class: 'spot__value' }, forest.label)]
          : [v.forestUnknown === 'zoom' ? 'zoomez pour la connaître' : v.forestUnknown ? 'pas encore chargée : touchez à nouveau dans un instant' : 'pas de forêt cartographiée']),
      ),
      row(
        'Sol',
        ...(soil
          ? [patternSwatch(soil.soil), h('span', { class: 'spot__value' }, soil.soil.label), h('small', { class: 'spot__descr' }, soil.description)]
          : [`inconnu ici (couverture : ${GEOLOGY.coverage}, zoom 10 et plus)`]),
      ),
      row(
        'Altitude',
        status === 'loading'
          ? '…'
          : altitude !== null
            ? `${altitude} m`
            : approximate
              ? `${approximate}${v.altitudePending ? ' · altitude exacte en cours…' : ''}`
              : nothing
                ? 'non demandée (rien à estimer ici)'
                : 'inconnue',
      ),
      row('Statut', statusValue(zones, forest)),
    );

    const parts: (Node | null)[] = [zoneAlerts(zones), h('section', { class: 'spot__section' }, terrain)];

    const month = currentMonth();
    const context: SpotContext = {
      ...(forest ? { forestCode: forest.code } : v.forestUnknown ? { forestUnknown: v.forestUnknown } : { forestCode: null }),
      soil: soil?.soil.id ?? null,
    };
    /** Les cinq lignes : écarté sans calcul (saison, forêt, secteur), sinon l'indice du coin. */
    const verdicts = (w: WeatherSummary | null): Verdict[] =>
      MUSHROOMS.flatMap((m): Verdict[] => {
        const out = excluded?.get(m.id);
        if (out) return [{ id: m.id, score: 0, chance: 0, level: 0, reasons: [], blocker: out.why, dormant: out.dormant, bare: out.dormant || !out.zero }];
        if (!w) return [];
        // Forêt inconnue sous le point : la chance vaut pour les forêts hôtes du secteur (carré de
        // 4,5 km), à leur qualité moyenne. Fichier des parts absent : météo seule.
        const host = v.forestUnknown ? hostCover(v.sector.cell, v.sector.k, m) : null;
        return [scoreMushroom(m, w, month, host ? { ...context, hostQuality: host.quality } : context)];
      });
    // Secteur urbanisé (carré de 4,5 km bâti à BUILT_MAX_COVER ou plus ; la part bâtie ne dépend pas du
    // champignon) : le conseil s'affiche que le bilan estime ou non. Fichier des parts absent : inconnu.
    const first = MUSHROOMS[0];
    const urban = ((first ? hostCover(v.sector.cell, v.sector.k, first)?.built : undefined) ?? 0) >= BUILT_MAX_COVER;

    if (status === 'loading') {
      parts.push(h('p', { class: 'spot__status' }, 'Lecture de la météo des derniers jours…'));
    } else if (!weather && !nothing) {
      parts.push(h('p', { class: 'spot__status' }, 'Météo indisponible pour le moment (réseau ?).'));
    } else {
      parts.push(this.mushroomSection(verdicts(weather), urban));
    }
    if (status !== 'loading' && weather) {
      const last = weather.events[0];
      const yesterday = weather.days[weather.days.length - 1]?.date ?? '';
      const late = weather.lastDate && weather.lastDate < yesterday;
      parts.push(
        h(
          'section',
          { class: 'spot__section' },
          // En secours (Open-Meteo interrogé directement), seuls les 20 derniers jours sont connus.
          h('h3', { class: 'spot__title' }, `Météo des ${shared ? KEPT_DAYS : DIRECT_PAST_DAYS} derniers jours`),
          h(
            'p',
            { class: 'spot__summary' },
            `${Math.round(weather.rain30)} mm de pluie`,
            last ? ` · dernière grosse pluie : ${Math.round(last.amount)} mm il y a ${last.daysAgo} jours` : ' · pas de grosse pluie',
            late && weather.lastDate
              ? ` · connue jusqu’au ${new Date(`${weather.lastDate}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
              : '',
            weather.estimated ? ' · dernier jour estimé d’après la prévision' : '',
          ),
          rainChart(weather),
          h(
            'p',
            { class: 'spot__summary' },
            weather.tmean7 !== null ? `${Math.round(weather.tmean7)} °C en moyenne sur 7 jours` : 'Températures inconnues',
            weather.tmin5 !== null ? ` · minimum ${Math.round(weather.tmin5)} °C sur 5 jours` : '',
            weather.frost ? ' · gel' : '',
          ),
        ),
      );
    }

    parts.push(this.rulesSection(zones, forest));

    const lat = this.coords.textContent?.split(', ')[0] ?? '';
    const lng = this.coords.textContent?.split(', ')[1] ?? '';
    const copy = h('button', { type: 'button', class: 'popup-btn', 'data-focus': 'copy' }, 'Copier les coordonnées');
    copy.addEventListener('click', () => {
      navigator.clipboard
        .writeText(`${lat}, ${lng}`)
        .then(() => toast('Coordonnées copiées'))
        .catch(() => toast(`${lat}, ${lng}`));
    });
    parts.push(
      h(
        'div',
        { class: 'spot__actions' },
        copy,
        h(
          'a',
          { class: 'popup-btn', 'data-focus': 'route', href: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, target: '_blank', rel: 'noopener' },
          'Itinéraire ↗',
        ),
      ),
      h(
        'p',
        { class: 'spot__note' },
        `Estimation : elle dit où chercher, pas ce qui se mange ni si l’on peut cueillir. Météo : Open-Meteo, ${shared ? `case de ${CELL_KM} km mise à jour une fois par jour` : 'interrogé directement pour ce point'}.`,
      ),
    );
    // Le clavier ne doit pas perdre sa place quand le bilan est redessiné sous lui (l'altitude peut
    // arriver douze secondes après le clic) : on retrouve l'élément par sa clé `data-focus`.
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.body.contains(active) ? active.dataset['focus'] : undefined;
    this.body.replaceChildren(...parts.filter((p): p is Node => p !== null));
    if (focused) this.body.querySelector<HTMLElement>(`[data-focus="${focused}"]`)?.focus({ preventScroll: true });
  }
}
