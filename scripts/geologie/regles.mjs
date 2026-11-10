// Classement des formations de la carte géologique BRGM au 1/50 000 (champ DESCR)
// en grandes natures de sol. Mêmes identifiants que `src/soils.ts`. Réglées sur la table de toutes
// les descriptions de France (17 000 descriptions, tests/donnees/) : `node tests/geologie.mjs` les
// vérifie, `node tests/geologie.mjs non` liste ce qui reste sans sol.
//
// Principe : on normalise la description (minuscules, sans accents) puis on cherche, parmi tous
// les mots-clés, celui qui apparaît LE PLUS TÔT : la roche dominante est citée en premier
// (« Calcaires gréseux… » → calcaire ; « Molasse … calcaires lacustres » → grès et molasse).
// À position égale, l'expression la plus longue l'emporte (« Coulées basaltiques » est une roche
// volcanique, pas une coulée de versant). Quelques règles prioritaires gèrent les cas où le premier
// mot trompe.

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
];

/** Qualificatifs des roches volcaniques. */
const VOLCANIC = 'volcan|basalt|basanit|laves?\\b|trachy|andesit|phonolit|pyroclast|ignimbrit|rhyolit|scori|ponce';

/** Mots-clés par nature de sol : le plus précoce dans la description l'emporte. */
const KEYWORDS = {
  moraine: [/morain/, /glaciaire/],
  eboulis: [/eboulis/, /eboulement/, /ecroulement/, /colluvi/, /\bcones?\b/, /glissement/, /glisse/, /versants?\b/, /\bcoulees?\b/, /soliflu/, /\bglacis\b/, /\bheads?\b/, /\bgrezes?\b/, /periglaciaire/],
  humide: [/tourb/, /marais/, /marecag/, /palustre/, /alluvi/, /fluviatile/, /lacustre/, /zones? humides?/, /\bvases?\b/, /\bslikke/, /\bschorre/, /\bpolders?\b/, /\bpaluds?\b/, /estuarien/, /fluvio-?marin/, /\btangues?\b/],
  gres: [/\bgres\b/, /greseu/, /greso/, /\bsables?\b/, /sableu/, /molass/, /houiller/, /arkose/, /quar?tzit/, /\bquartz\b/, /poudingue/, /conglomerat/, /terr?asse/, /\bdunes?\b/, /interdunaire/, /eolien/, /cailloutis/, /\bgraviers?\b/, /\bgalets?\b/, /meuliere/, /\bwackes?\b/, /grauwack/, /psammit/,
    // Dépôts détritiques et d'épandage (sables, cailloutis), dunes, roches siliceuses.
    /detriti/, /epandage/, /dunaire/, /\bgaizes?\b/, /glaucon/, /buntsandstein/, /sablo/, /sablon/, /gravel/, /cordons? littora/, /silcrete/, /phtanit/],
  cristallin: [/granit/, /gneiss/, /micasc?histe/, /^schistes?\b(?!.{0,25}(calcaire|calcschist|marn|dolomi|lustre|carton|bitumineu))/, /migmatit/, /amphib/, /chloritoschiste/, /sericitoschiste/, /leptynit/, /mylonit/, /prasinit/, /ophiolit/, /serpentin/, /diorit/, /gabbro/, /rhyolit/, /pegmatit/, /spilit/, /cinerit/, /metabasit/, /radiolarit/, /metamorphi/, /roches vertes/, /schistes verts/, /cristallin/,
    // Roches volcaniques (Massif central, Esterel, Corse…) : sols acides à neutres, filtrants.
    // Mot trompeur suivi d'un qualificatif volcanique : « Coulées basaltiques », « Brèches volcaniques »,
    // « Tufs rhyolitiques », « Coulées de laves »…
    new RegExp(`\\b(coulees?|breches?|tufs?|cendres|projections|scories?|cones?) (de |d |a |et )?(${VOLCANIC})`),
    /volcan/, /basalt/, /basanit/, /ankaramit/, /trachy/, /andesit/, /phonolit/, /pyroclast/, /pouzzolan/, /ignimbrit/, /\blaves?\b/, /dacit/, /tephr/, /\bmaars?\b/,
    // Autres roches magmatiques et métamorphiques, sols acides.
    /tonalit/, /trondhjem/, /monzonit/, /syenit/, /porphyr/, /\baplit/, /lamprophyr/, /kersantit/, /dolerit/, /diabase/, /eclogit/, /granulit/, /anatexit/, /diatexit/, /metatexit/, /agmatit/, /\bophites?\b/, /adamellit/, /corneenne/, /\blatites?\b/, /\barenes?\b/, /phyllad/, /ardois/, /quartzophyllad/, /orthogneiss/, /paragneiss/],
  marne: [/marne/, /marno/, /argil/, /\bdieves?\b/, /siltstone/, /pelit/, /silto/, /keuper/, /schistes? (cartons?|bitumineux)/, /terres noires/, /calcschiste/, /schistes lustres/, /flysc?h/, /schistes? (calcaires?|marneu)/, /\bshales?\b/, /siltit/, /\bsilts?\b/],
  // Limons des plateaux, lœss, argiles à silex et autres formations résiduelles : sols profonds,
  // souvent décalcifiés (Bassin parisien, Nord, Normandie, Aquitaine…).
  limon: [/limons?\b/, /limoneu/, /\blehms?\b/, /\bloess/, /\blss\b/, /argiles? a (silex|chailles|meuliere)/, /argiles? d ?alteration/, /residuel/, /chailles/, /siderolit/, /formations? (complexes? )?des plateaux/],
  calcaire: [/calcaire/, /\bcalc\./, /urgonien/, /dolomi/, /marbre/, /cipolin/, /cargneule/, /gypse/, /\bcraies?\b/, /crayeu/, /oolit/, /calcarenit/, /carbonat/, /\btuffs?\b/, /muschelkalk/, /micraster/, /actinocamax/, /belemnitell/, /nummulit/, /lumachelle/, /travertin/, /\btufs?\b/, /\bbreches?\b/, /microbreche/, /\bfaluns?\b/, /tuffeau/],
};

/**
 * Socle ancien (Massif armoricain, Ardenne, Vosges, Massif central, Pyrénées…) : ses pélites,
 * siltites et argilites sont des schistes à sol acide, pas des marnes.
 */
const ANCIENT = /briover|proterozo|precambri|cambrien|ordovic|siluri|devoni|dinanti|carbonifer|\bvisee?n|namuri|westphali|stephani|\bculm\b|paleozo/;
const CALCAREOUS = /marn|calcschist|calcaire|carbonat/;

/**
 * Derniers recours, quand aucune roche n'est nommée : des altérites sans précision sont des argiles
 * d'altération (« Altérites de granite » reste un sol de granite) ; un schiste donne plutôt un sol acide.
 */
const FALLBACK = [
  [/alterit/, 'limon'],
  [/schist/, 'cristallin'],
];

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
  let bestLength = 0;
  for (const [soil, patterns] of Object.entries(KEYWORDS)) {
    for (const re of patterns) {
      const m = re.exec(d);
      if (!m) continue;
      if (m.index < bestIndex || (m.index === bestIndex && m[0].length > bestLength)) {
        bestIndex = m.index;
        bestLength = m[0].length;
        best = soil;
      }
    }
  }
  if (best === 'marne') {
    if (/^alterit/.test(d)) return 'limon'; // argiles d'altération
    if (ANCIENT.test(d) && !CALCAREOUS.test(d)) return 'cristallin';
  }
  if (best) return best;
  for (const [re, soil] of FALLBACK) if (re.test(d)) return soil;
  return null;
}
