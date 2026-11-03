// Classement des formations de la carte géologique BRGM au 1/50 000 (champ DESCR)
// en grandes natures de sol. Mêmes identifiants que `src/soils.ts`.
//
// Principe : on normalise la description (minuscules, sans accents) puis on cherche, parmi tous
// les mots-clés, celui qui apparaît LE PLUS TÔT : la roche dominante est citée en premier
// (« Calcaires gréseux… » → calcaire ; « Molasse … calcaires lacustres » → grès et molasse).
// Quelques règles prioritaires gèrent les cas où le premier mot trompe.

const normalize = (s) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ');

/** Formations sans sol (eau, glace) : non dessinées. */
const EXCLUDED = [/\bneiges?\b/, /\bneves?\b/, /\bglaces?\b/, /^glaciers?\b(?! rocheux)/, /reseau hydrologique/, /\bplans? d eau\b/, /^lacs?\b/, /\bremblais?\b/, /anthropique/];

/** Règles prioritaires (testées en premier, avant même les exclusions). */
const PRIORITY = [
  [/fluvio-?glaciaire/, 'moraine'], // graviers de fonte glaciaire, drainants
  [/glacio-?lacustre/, 'marne'], // argiles et silts de lacs glaciaires
  [/glacier rocheux/, 'eboulis'],
  // Roches volcaniques citées après un mot trompeur : « Coulées basaltiques », « Brèches volcaniques ».
  [/\b(coulees?|breches?|tufs?|cendres|projections|depots?|scories?) (de |d |a )?(volcan|basalt|basanit|lave|trachy|andesit|phonolit|pyroclast|ignimbrit)/, 'cristallin'],
];

/** Mots-clés par nature de sol : le plus précoce dans la description l'emporte. */
const KEYWORDS = {
  moraine: [/morain/, /glaciaire/],
  eboulis: [/eboulis/, /eboulement/, /ecroulement/, /colluvion/, /\bcones?\b/, /glissement/, /glisse/, /versants?\b/, /\bcoulees?\b/, /solifluxion/, /\bheads?\b/, /\bgrezes?\b/, /periglaciaire/],
  humide: [/tourb/, /marais/, /marecag/, /palustre/, /alluvion/, /fluviatile/, /lacustre/, /zones? humides?/, /\bvases?\b/, /\bslikke/, /\bschorre/, /\bpolders?\b/, /\bpaluds?\b/, /estuarien/],
  gres: [/\bgres\b/, /\bsables?\b/, /sableu/, /molass/, /houiller/, /arkose/, /quar?tzit/, /\bquartz\b/, /poudingue/, /conglomerat/, /terr?asse/, /\bdunes?\b/, /interdunaire/, /eolien/, /cailloutis/, /\bgraviers?\b/, /\bgalets?\b/, /meuliere/, /\bwackes?\b/, /grauwack/, /psammit/],
  cristallin: [/granit/, /gneiss/, /micaschiste/, /migmatit/, /amphib/, /chloritoschiste/, /sericitoschiste/, /leptynit/, /mylonit/, /prasinit/, /ophiolit/, /serpentin/, /diorit/, /gabbro/, /rhyolit/, /pegmatit/, /spilit/, /cinerit/, /metabasit/, /radiolarit/, /metamorphi/, /roches vertes/, /schistes verts/, /cristallin/,
    // Roches volcaniques (Massif central, Esterel, Corse…) : sols acides à neutres, filtrants.
    /volcan/, /basalt/, /basanit/, /ankaramit/, /trachy/, /andesit/, /phonolit/, /pyroclast/, /pouzzolan/, /ignimbrit/, /\blaves?\b/, /dacit/, /tephr/, /\bmaars?\b/,
    // Autres roches magmatiques et métamorphiques, sols acides.
    /tonalit/, /trondhjem/, /monzonit/, /syenit/, /porphyr/, /\baplit/, /lamprophyr/, /kersantit/, /dolerit/, /diabase/, /eclogit/, /granulit/, /anatexit/, /\barenes?\b/, /phyllad/, /ardois/, /quartzophyllad/, /orthogneiss/, /paragneiss/],
  marne: [/marne/, /marno/, /argil/, /limons?\b/, /pelites?\b/, /terres noires/, /calcschiste/, /schistes lustres/, /flysch/, /schistes? (calcaires?|marneu)/, /\bshales?\b/, /siltit/, /\bsilts?\b/, /\bloess\b/],
  calcaire: [/calcaire/, /\bcalc\./, /urgonien/, /dolomi/, /marbre/, /cipolin/, /cargneule/, /gypse/, /\bcraie\b/, /nummulit/, /lumachelle/, /travertin/, /\btufs?\b/, /\bbreches?\b/, /microbreche/, /\bfaluns?\b/, /tuffeau/],
};

/** Dernier recours : un schiste sans autre indice donne plutôt un sol acide. */
const FALLBACK = [[/schiste/, 'cristallin']];

/**
 * Nature du sol d'une formation, ou null si elle n'en a pas (eau, glace) ou reste indéterminée.
 * @param {string} descr Champ DESCR de S_FGEOL.
 * @param {string} [notation] Champ NOTATION (ex. « Gl-Ne », « hydro »).
 * @returns {string|null}
 */
export function classer(descr, notation = '') {
  const n = normalize(notation);
  if (n === 'hydro' || n.startsWith('gl-ne')) return null;
  const d = normalize(descr);
  if (!d) return null;
  for (const [re, soil] of PRIORITY) if (re.test(d)) return soil;
  if (EXCLUDED.some((re) => re.test(d))) return null;

  let best = null;
  let bestIndex = Infinity;
  for (const [soil, patterns] of Object.entries(KEYWORDS)) {
    for (const re of patterns) {
      const m = re.exec(d);
      if (m && m.index < bestIndex) {
        bestIndex = m.index;
        best = soil;
      }
    }
  }
  if (best) return best;
  for (const [re, soil] of FALLBACK) if (re.test(d)) return soil;
  return null;
}
