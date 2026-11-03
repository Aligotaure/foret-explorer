// Faux services pour tester l'appli sans réseau : tuiles BD Forêt et géologie (MVT encodées ici),
// tuiles WMTS (PNG fixes), géocodage et altitude (Géoplateforme), météo (Open-Meteo).
import { readFileSync } from 'node:fs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const PNG = { plan: fixture('plan.png'), ortho: fixture('ortho.png'), overview: fixture('overview.png') };
const CORS = { 'access-control-allow-origin': '*' };

// ── Encodeur Mapbox Vector Tile minimal (protobuf à la main) ────────────────
function varint(n, out) {
  while (n > 127) {
    out.push((n % 128) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
}
const zigzag = (n) => (n << 1) ^ (n >> 31);
const tag = (field, wire, out) => varint(field * 8 + wire, out);
function bytesField(field, bytes, out) {
  tag(field, 2, out);
  varint(bytes.length, out);
  for (const b of bytes) out.push(b);
}
const stringField = (field, s, out) => bytesField(field, [...Buffer.from(s, 'utf8')], out);
function varintField(field, v, out) {
  tag(field, 0, out);
  varint(v, out);
}
function packed(field, values, out) {
  const b = [];
  for (const v of values) varint(v, b);
  bytesField(field, b, out);
}
function polygonGeometry(rings) {
  const cmds = [];
  let cx = 0;
  let cy = 0;
  for (const ring of rings) {
    const [x0, y0] = ring[0];
    cmds.push(1 | (1 << 3), zigzag(x0 - cx), zigzag(y0 - cy)); // MoveTo
    [cx, cy] = [x0, y0];
    const rest = ring.slice(1);
    cmds.push(2 | (rest.length << 3)); // LineTo
    for (const [x, y] of rest) {
      cmds.push(zigzag(x - cx), zigzag(y - cy));
      [cx, cy] = [x, y];
    }
    cmds.push(7 | (1 << 3)); // ClosePath
  }
  return cmds;
}
function encodeTile(layerName, features) {
  const keys = [];
  const values = [];
  const keyIdx = new Map();
  const valIdx = new Map();
  const featureBufs = features.map((f) => {
    const tags = [];
    for (const [k, v] of Object.entries(f.props)) {
      if (!keyIdx.has(k)) keyIdx.set(k, keys.push(k) - 1);
      const vk = `${typeof v}:${v}`;
      if (!valIdx.has(vk)) valIdx.set(vk, values.push(v) - 1);
      tags.push(keyIdx.get(k), valIdx.get(vk));
    }
    const fb = [];
    varintField(1, f.id, fb);
    packed(2, tags, fb);
    varintField(3, 3, fb); // POLYGON
    packed(4, polygonGeometry(f.rings), fb);
    return fb;
  });
  const lb = [];
  varintField(15, 2, lb);
  stringField(1, layerName, lb);
  for (const fb of featureBufs) bytesField(2, fb, lb);
  for (const k of keys) stringField(3, k, lb);
  for (const v of values) {
    const vb = [];
    if (typeof v === 'string') stringField(1, v, vb);
    else varintField(5, v, vb);
    bytesField(4, vb, lb);
  }
  varintField(5, 4096, lb);
  const tb = [];
  bytesField(3, lb, tb);
  return Buffer.from(tb);
}

// Quatre carrés par tuile (types qui tournent d'une tuile à l'autre) + une bande « Lande »
// présente dans toutes les tuiles avec le même id (pour tester le dédoublonnage).
const CLASSES = [
  { code: 'FF1G01-01', tfv: 'Forêt fermée de chênes décidus purs', g11: 'Forêt fermée feuillus', essence: 'Chênes décidus' },
  { code: 'FF1-09-09', tfv: 'Forêt fermée de hêtre pur', g11: 'Forêt fermée feuillus', essence: 'Hêtre' },
  { code: 'FF2G61-61', tfv: 'Forêt fermée de sapin ou épicéa', g11: 'Forêt fermée conifères', essence: 'Sapin, épicéa' },
  { code: 'FF31', tfv: 'Forêt fermée à mélange de feuillus prépondérants et conifères', g11: 'Forêt fermée mixte', essence: 'Mixte' },
];
let fid = 1;
export function forestTile(z, x, y) {
  const size = 1840;
  const corners = [
    [128, 160],
    [2176, 160],
    [128, 2208],
    [2176, 2208],
  ];
  const features = corners.map(([qx, qy], q) => {
    const c = CLASSES[(q + x + y) % CLASSES.length];
    const id = fid++;
    return {
      id,
      props: { id: `T${z}-${x}-${y}-${q}`, fid: id, code_tfv: c.code, tfv: c.tfv, tfv_g11: c.g11, essence: c.essence },
      rings: [
        [
          [qx, qy],
          [qx + size, qy],
          [qx + size, qy + size],
          [qx, qy + size],
        ],
      ],
    };
  });
  features.push({
    id: fid++,
    props: { id: 'SHARED-LANDE', fid: 999999, code_tfv: 'LA4', tfv: 'Lande', tfv_g11: 'Lande', essence: 'NC' },
    rings: [
      [
        [0, 30],
        [4096, 30],
        [4096, 110],
        [0, 110],
      ],
    ],
  });
  return encodeTile('formation_vegetale', features);
}

// Géologie : moitié gauche de chaque tuile en calcaire, moitié droite en moraine.
export function geologyTile() {
  const half = (x0, sol, notation, descr) => ({
    id: fid++,
    props: { sol, notation, descr },
    rings: [
      [
        [x0, 0],
        [x0 + 2048, 0],
        [x0 + 2048, 4096],
        [x0, 4096],
      ],
    ],
  });
  return encodeTile('geologie', [
    half(0, 'calcaire', 'n3-5U', 'Calcaires massifs urgoniens (à rudistes, polypieds)'),
    half(2048, 'moraine', 'Gy', 'Dépôts glaciaires (moraines) anciens (argiles, sables, galets, cailloux, blocs)'),
  ]);
}

// Zones : réserve naturelle sur le quart haut-gauche de chaque tuile, forêt publique sur le quart
// bas-droit ; ailleurs, terrain sans statut public (forêt « sans doute privée »).
export function zonesTile() {
  const quarter = (x0, y0) => [
    [
      [x0, y0],
      [x0 + 2048, y0],
      [x0 + 2048, y0 + 2048],
      [x0, y0 + 2048],
    ],
  ];
  const protection = encodeTile('protection', [
    { id: fid++, props: { type: 'rnn', nom: 'Réserve d’essai', url: 'https://inpn.mnhn.fr/espace/protege/FR3600000' }, rings: quarter(0, 0) },
  ]);
  const forests = encodeTile('foret_publique', [
    { id: fid++, props: { nature: 'autre', nom: 'Forêt communale d’essai' }, rings: quarter(2048, 2048) },
  ]);
  return Buffer.concat([protection, forests]); // une tuile = suite de couches : on les met bout à bout
}

// Météo : 20 jours passés + aujourd'hui, avec deux grosses pluies il y a 10 et 13 jours
// (relevés réels du 11 au 31 octobre 2026 vers 930 m, au-dessus de Nâves-Parmelan).
const DAILY = {
  rain: [0, 0, 0, 0, 0, 0, 2.2, 30.6, 1.0, 0.9, 31.8, 0, 11.8, 4.1, 8.9, 0, 0, 0.1, 0, 0, 0],
  tmax: [11.1, 13.5, 14.8, 17.1, 18.1, 18.0, 12.6, 7.6, 12.0, 11.5, 8.2, 9.5, 10.8, 6.4, 11.0, 11.2, 15.8, 11.6, 9.2, 8.9, 8.1],
  tmin: [7.1, 6.4, 8.5, 10.7, 12.3, 12.6, 7.6, 5.2, 6.1, 7.9, 4.4, 3.2, 5.2, 2.5, 5.0, 4.1, 9.9, 6.4, 5.1, 4.2, 3.1],
};
function openMeteo(url) {
  const lats = (url.searchParams.get('latitude') ?? '').split(',').map(Number);
  const lons = (url.searchParams.get('longitude') ?? '').split(',').map(Number);
  const elevations = (url.searchParams.get('elevation') ?? '').split(',').filter(Boolean).map(Number);
  const today = new Date();
  const time = DAILY.rain.map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (DAILY.rain.length - 1 - i));
    return d.toISOString().slice(0, 10);
  });
  const items = lats.map((lat, k) => {
    const elevation = elevations[k] ?? 930;
    const shift = (930 - elevation) * 0.0065; // gradient thermique
    const wetter = 1 + ((k % 3) - 1) * 0.3; // un peu de variété d'une case à l'autre
    return {
      latitude: lat,
      longitude: lons[k],
      elevation,
      daily: {
        time,
        precipitation_sum: DAILY.rain.map((r) => Math.round(r * wetter * 10) / 10),
        temperature_2m_max: DAILY.tmax.map((t) => Math.round((t + shift) * 10) / 10),
        temperature_2m_min: DAILY.tmin.map((t) => Math.round((t + shift) * 10) / 10),
      },
    };
  });
  return items.length === 1 ? items[0] : items;
}

// Altitude : 930 m pour un point seul (bilan d'un coin), relief varié pour une liste de points.
function altitudes(url) {
  const lats = (url.searchParams.get('lat') ?? '').split('|').map(Number);
  const lons = (url.searchParams.get('lon') ?? '').split('|').map(Number);
  if (lats.length === 1) return { elevations: [930] };
  return { elevations: lats.map((lat, k) => Math.round(450 + Math.abs(Math.sin(lat * 900) * Math.cos(lons[k] * 700)) * 1300)) };
}

const COMPLETION = {
  status: 'OK',
  results: [
    { x: 6.133357, y: 45.908864, country: 'PositionOfInterest', city: 'Annecy', zipcode: '74000', poiType: ['quartier', "zone d'habitation"], kind: 'quartier', fulltext: 'Parmelan, 74000 Annecy' },
    { x: 6.193485, y: 45.934622, country: 'PositionOfInterest', zipcode: '74370', poiType: ['administratif', 'commune'], kind: 'administratif', fulltext: 'Nâves-Parmelan, 74370' },
    { x: 6.133395, y: 45.906006, country: 'StreetAddress', city: 'Annecy', kind: 'street', zipcode: '74000', fulltext: 'Avenue du Parmelan, 74000 Annecy' },
  ],
};

/** Intercepte les requêtes vers les services externes et les consigne dans `log`. */
export async function installMocks(page, log) {
  log.meteo ??= [];
  log.geologie ??= [];
  log.altitude ??= [];
  log.mesures ??= [];
  log.zones ??= [];
  await page.route('https://aligotaure.github.io/foret-explorer/data/zones/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    log.zones.push(path);
    if (path.endsWith('/info.json')) {
      const info = { genere: '2026-11-03T06:00:00.000Z', compteurs: { rnn: 1, autres_forets_publiques: 1 } };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(info) });
    }
    return route.fulfill({ status: 200, contentType: 'application/x-protobuf', headers: CORS, body: zonesTile() });
  });
  // Serveur de mesure (adresse fictive définie au build des tests) : on garde les envois.
  await page.route('https://mesures.test/**', (route) => {
    const request = route.request();
    log.mesures.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postData() ?? '' });
    return route.fulfill({ status: 204, headers: CORS, body: '' });
  });
  await page.route('https://api.open-meteo.com/**', (route) => {
    const url = new URL(route.request().url());
    log.meteo.push(url.search);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(openMeteo(url)) });
  });
  await page.route('https://aligotaure.github.io/foret-explorer/data/geologie/**', (route) => {
    log.geologie.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/x-protobuf', headers: CORS, body: geologyTile() });
  });
  await page.route('https://data.geopf.fr/**', (route) => {
    const url = new URL(route.request().url());
    const tms = url.pathname.match(/\/tms\/1\.0\.0\/LANDCOVER-TMS\.FORESTINVENTORY\.V2\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (tms) {
      log.tms.push(tms.slice(1).join('/'));
      const [z, x, y] = tms.slice(1).map(Number);
      return route.fulfill({ status: 200, contentType: 'application/x-protobuf', headers: CORS, body: forestTile(z, x, y) });
    }
    if (url.pathname === '/wmts') {
      const layer = url.searchParams.get('LAYER');
      log.wmts.push(`${layer}|${url.searchParams.get('TILEMATRIXSET')}|${url.searchParams.get('TILEMATRIX')}`);
      const body =
        layer === 'ORTHOIMAGERY.ORTHOPHOTOS' ? PNG.ortho : layer === 'LANDCOVER.FORESTINVENTORY.V2' ? PNG.overview : PNG.plan;
      return route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body });
    }
    if (url.pathname.startsWith('/altimetrie/')) {
      log.altitude.push(url.search);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(altitudes(url)) });
    }
    if (url.pathname.startsWith('/annexes/ressources/vectorTiles/fonts/')) {
      return route.fulfill({ status: 200, contentType: 'application/x-protobuf', headers: CORS, body: Buffer.alloc(0) }); // police vide
    }
    if (url.pathname === '/geocodage/completion') {
      log.geocode.push(url.search);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(COMPLETION) });
    }
    log.other.push(url.href);
    return route.fulfill({ status: 404, body: '' });
  });
}
