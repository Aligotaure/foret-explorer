// Faux services Géoplateforme pour tester l'appli sans réseau :
// tuiles vectorielles BD Forêt (MVT encodées ici), tuiles WMTS (PNG fixes), géocodage.
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

const COMPLETION = {
  status: 'OK',
  results: [
    { x: 6.133357, y: 45.908864, country: 'PositionOfInterest', city: 'Annecy', zipcode: '74000', poiType: ['quartier', "zone d'habitation"], kind: 'quartier', fulltext: 'Parmelan, 74000 Annecy' },
    { x: 6.193485, y: 45.934622, country: 'PositionOfInterest', zipcode: '74370', poiType: ['administratif', 'commune'], kind: 'administratif', fulltext: 'Nâves-Parmelan, 74370' },
    { x: 6.133395, y: 45.906006, country: 'StreetAddress', city: 'Annecy', kind: 'street', zipcode: '74000', fulltext: 'Avenue du Parmelan, 74000 Annecy' },
  ],
};

/** Intercepte toutes les requêtes vers data.geopf.fr et les consigne dans `log`. */
export async function installMocks(page, log) {
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
    if (url.pathname === '/geocodage/completion') {
      log.geocode.push(url.search);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(COMPLETION) });
    }
    log.other.push(url.href);
    return route.fulfill({ status: 404, body: '' });
  });
}
