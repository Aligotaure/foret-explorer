// Télécharge, depuis le WFS de la Géoplateforme et en Lambert-93 (EPSG:2154), sur l'emprise donnée :
//   - les espaces protégés de PatriNat (OFB, MNHN) dont le règlement peut interdire ou limiter
//     la cueillette (réserves naturelles et biologiques, cœurs de parc national, arrêtés de
//     protection, terrains des conservatoires) → protection.geojsonl ;
//   - les forêts publiques de la BD TOPO de l'IGN (d'après l'ONF) → forets.geojsonl ;
//   - un point d'étiquette par zone protégée (nom affiché une seule fois) → etiquettes.geojsonl ;
// et écrit resume.json (date, nombres par type), copié ensuite en info.json à côté des tuiles.
//
// Usage : node telecharger.mjs <dossier> [sud,ouest,nord,est]
// Si les fichiers ont moins de 6 jours, rien n'est retéléchargé (FORCE=1 pour forcer). Si le service
// ne répond pas et qu'une version précédente existe, on la garde (avertissement dans le journal).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WFS = 'https://data.geopf.fr/wfs';
const PAGE = 5000;
// Emprise par défaut : France métropolitaine, Corse comprise.
const [dir, emprise = '41.2,-5.3,51.2,9.7'] = process.argv.slice(2);
if (!dir) {
  console.error('Usage : node telecharger.mjs <dossier> [sud,ouest,nord,est]');
  process.exit(2);
}
mkdirSync(dir, { recursive: true });

/** Couches PatriNat retenues. Mêmes types que src/zones.ts. */
const PROTECTION = [
  { typename: 'patrinat_rnn:rnn', type: 'rnn' },
  { typename: 'patrinat_rnr:rnr', type: 'rnr' },
  { typename: 'patrinat_pprnn:pprnn', type: 'perimetre' },
  { typename: 'patrinat_pprnr:pprnr', type: 'perimetre' },
  { typename: 'patrinat_rb:rb', type: 'rb' },
  // Parcs nationaux : seul le cœur a une réglementation propre (pas l'aire d'adhésion).
  { typename: 'patrinat_pn:parc_national', type: 'pn', garder: (p) => /c(œ|oe)ur/i.test(String(p.zone ?? '')) },
  { typename: 'patrinat_apb:apb', type: 'apb' },
  { typename: 'patrinat_aphn:aphn', type: 'aphn' },
  { typename: 'patrinat_cdl:conservatoire_littoral', type: 'cdl' },
  { typename: 'patrinat_cen:cen', type: 'cen' },
];
const FORETS = 'BDTOPO_V3:foret_publique';

const fichiers = {
  protection: join(dir, 'protection.geojsonl'),
  etiquettes: join(dir, 'etiquettes.geojsonl'),
  forets: join(dir, 'forets.geojsonl'),
  resume: join(dir, 'resume.json'),
};

/** Ordre de priorité des étiquettes (1 passe devant), et types qu'on n'étiquette pas. */
const RANG = { rnn: 1, rnr: 1, pn: 1, rb: 2, apb: 2, aphn: 2, cdl: 3, cen: 3 };

const aire = (anneau) => {
  let a = 0;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) a += (anneau[j][0] + anneau[i][0]) * (anneau[j][1] - anneau[i][1]);
  return Math.abs(a / 2);
};

/**
 * Point d'étiquette dans le plus grand morceau d'une zone : milieu du plus long segment intérieur
 * sur l'horizontale qui coupe ce morceau à mi-hauteur (toujours à l'intérieur, trous compris).
 */
function pointEtiquette(geometrie) {
  const morceaux = geometrie.type === 'Polygon' ? [geometrie.coordinates] : geometrie.type === 'MultiPolygon' ? geometrie.coordinates : [];
  let poly = null;
  let surface = 0;
  for (const m of morceaux) {
    const a = m[0] ? aire(m[0]) : 0;
    if (a > surface) [poly, surface] = [m, a];
  }
  if (!poly) return null;
  // Boucle et non Math.min(...ys) : un cœur de parc national compte des centaines de milliers de points.
  let bas = Infinity;
  let haut = -Infinity;
  for (const p of poly[0]) [bas, haut] = [Math.min(bas, p[1]), Math.max(haut, p[1])];
  const y = (bas + haut) / 2;
  const xs = [];
  for (const anneau of poly) {
    for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
      const [x1, y1] = anneau[i];
      const [x2, y2] = anneau[j];
      if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
  }
  xs.sort((a, b) => a - b);
  let meilleur = null;
  let largeur = -1;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (xs[k + 1] - xs[k] > largeur) [meilleur, largeur] = [(xs[k] + xs[k + 1]) / 2, xs[k + 1] - xs[k]];
  }
  return meilleur === null ? null : { point: [meilleur, y], surface };
}

/** « Roc de Chère » et « Roc de chere » : même nom (une seule étiquette). */
const cle = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function recent() {
  if (process.env.FORCE === '1' || !Object.values(fichiers).every((f) => existsSync(f))) return false;
  try {
    const { genere, emprise: deja } = JSON.parse(readFileSync(fichiers.resume, 'utf8'));
    return deja === emprise && Date.now() - Date.parse(genere) < 6 * 86400e3;
  } catch {
    return false;
  }
}

async function telecharger(typename) {
  const entites = [];
  for (let start = 0; ; start += PAGE) {
    const params = new URLSearchParams({
      SERVICE: 'WFS',
      VERSION: '2.0.0',
      REQUEST: 'GetFeature',
      TYPENAMES: typename,
      OUTPUTFORMAT: 'application/json',
      SRSNAME: 'EPSG:2154',
      BBOX: `${emprise},urn:ogc:def:crs:EPSG::4326`,
      COUNT: String(PAGE),
      STARTINDEX: String(start),
    });
    let page;
    for (let essai = 1; ; essai++) {
      try {
        const r = await fetch(`${WFS}?${params}`, {
          headers: { 'User-Agent': 'foret-explorer (construction des tuiles)' },
          signal: AbortSignal.timeout(180_000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        page = await r.json();
        break;
      } catch (error) {
        if (essai >= 3) throw new Error(`${typename} : ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 4000 * essai));
      }
    }
    const lot = page.features ?? [];
    for (const e of lot) entites.push(e);
    if (lot.length < PAGE) return entites;
  }
}

/** « Bout Du Lac D'Annecy » → « Bout du Lac d'Annecy » ; « le planay » → « Le planay ». */
const PETITS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'sur', 'aux', 'au', 'à', 'sous']);
function nom(valeur) {
  const s = String(valeur ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const mots = s.split(' ').map((mot, i) => {
    if (i === 0) return mot;
    if (PETITS.has(mot.toLowerCase())) return mot.toLowerCase();
    if (/^[DL]['’]/.test(mot)) return mot[0].toLowerCase() + mot.slice(1);
    return mot;
  });
  const texte = mots.join(' ');
  return texte[0].toUpperCase() + texte.slice(1);
}

/** « Périmètre De Protection De La Réserve Naturelle Nationale Du Bout Du Lac » → « Bout du Lac ». */
const sansPerimetre = (s) =>
  s.replace(/^p[ée]rim[èe]tre de protection de la r[ée]serve naturelle (nationale |r[ée]gionale )?(de l['’]|de la |du |des |de |d['’])?/i, '');

const ligne = (properties, geometry) => JSON.stringify({ type: 'Feature', properties, geometry });

async function construire() {
  const compteurs = {};
  const vus = new Set();
  const protection = [];
  const etiquettes = new Map(); // nom normalisé → meilleure étiquette
  for (const couche of PROTECTION) {
    const entites = await telecharger(couche.typename);
    for (const f of entites) {
      const p = f.properties ?? {};
      if (!f.geometry || (couche.garder && !couche.garder(p))) continue;
      const id = String(p.id_mnhn ?? p.cd_sig ?? `${couche.typename}:${p.nom_site}`);
      if (vus.has(id)) continue; // même zone dans deux couches (périmètres de protection)
      vus.add(id);
      let type = couche.type;
      let texte = nom(p.nom_site);
      if (/^p[ée]rim[èe]tre de protection/i.test(texte)) {
        type = 'perimetre';
        texte = nom(sansPerimetre(texte)) || texte;
      }
      const props = { type, nom: texte };
      if (typeof p.url_fiche === 'string' && p.url_fiche.startsWith('https://inpn.mnhn.fr/')) props.url = p.url_fiche;
      if (type === 'rb' && typeof p.zone === 'string' && p.zone) props.detail = p.zone; // Intégrale / Dirigée
      protection.push(ligne(props, f.geometry));
      compteurs[type] = (compteurs[type] ?? 0) + 1;
      const pe = RANG[type] && texte ? pointEtiquette(f.geometry) : null;
      const deja = pe && etiquettes.get(cle(texte));
      if (pe && (!deja || RANG[type] < deja.rang || (RANG[type] === deja.rang && pe.surface > deja.surface))) {
        etiquettes.set(cle(texte), { nom: texte, type, rang: RANG[type], surface: pe.surface, point: pe.point });
      }
    }
    console.log(`${couche.typename} : ${entites.length} objets`);
  }

  const forets = [];
  for (const f of await telecharger(FORETS)) {
    const p = f.properties ?? {};
    if (!f.geometry) continue;
    const domaniale = /domaniale/i.test(String(p.nature ?? ''));
    const texte = nom(p.toponyme).replace(/\b(Communale|Domaniale|Indivise|Sectionale|Départementale|Régionale)\b/g, (m) =>
      m.toLowerCase(),
    );
    forets.push(ligne({ nature: domaniale ? 'domaniale' : 'autre', nom: texte || 'Forêt publique' }, f.geometry));
    compteurs[domaniale ? 'forets_domaniales' : 'autres_forets_publiques'] =
      (compteurs[domaniale ? 'forets_domaniales' : 'autres_forets_publiques'] ?? 0) + 1;
  }
  console.log(`${FORETS} : ${forets.length} objets`);
  if (!protection.length || !forets.length) throw new Error('aucune zone téléchargée');

  // Écriture atomique : un téléchargement raté ne laisse pas de fichier à moitié écrit.
  writeFileSync(`${fichiers.protection}.tmp`, `${protection.join('\n')}\n`);
  writeFileSync(
    `${fichiers.etiquettes}.tmp`,
    `${[...etiquettes.values()].map((e) => ligne({ nom: e.nom, type: e.type, rang: e.rang }, { type: 'Point', coordinates: e.point })).join('\n')}\n`,
  );
  writeFileSync(`${fichiers.forets}.tmp`, `${forets.join('\n')}\n`);
  writeFileSync(
    `${fichiers.resume}.tmp`,
    JSON.stringify(
      {
        genere: new Date().toISOString(),
        emprise,
        compteurs,
        sources: [
          'PatriNat (OFB, MNHN), espaces protégés, via le WFS de la Géoplateforme',
          'IGN, BD TOPO® V3, forêts publiques (d’après l’ONF), Licence Ouverte Etalab 2.0',
        ],
      },
      null,
      1,
    ),
  );
  for (const f of Object.values(fichiers)) renameSync(`${f}.tmp`, f);
  console.log('Zones :', JSON.stringify(compteurs));
}

if (recent()) {
  console.log('Zones déjà téléchargées il y a moins de 6 jours : rien à faire.');
} else {
  try {
    await construire();
  } catch (error) {
    if (Object.values(fichiers).every((f) => existsSync(f))) {
      console.log(`::warning::Zones non mises à jour (${error.message}) : on garde la version précédente.`);
    } else {
      console.error(`Zones : ${error.message}`);
      process.exit(1);
    }
  }
}
