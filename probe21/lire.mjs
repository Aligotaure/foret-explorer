// Sonde n°21 : lit une archive PMTiles écrite par GDAL avec la bibliothèque `pmtiles` (celle de la carte).
import { openSync, readSync, statSync } from 'node:fs';
import { PMTiles } from 'pmtiles';

const [file, ...points] = process.argv.slice(2);
class FileSource {
  constructor(path) {
    this.path = path;
    this.fd = openSync(path, 'r');
  }
  getKey() {
    return this.path;
  }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    const n = readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + n) };
  }
}
const archive = new PMTiles(new FileSource(file));
const h = await archive.getHeader();
console.log(`${file} : ${statSync(file).size} octets`);
console.log('en-tête', JSON.stringify(h));
const meta = await archive.getMetadata();
console.log('métadonnées', JSON.stringify(meta).slice(0, 700));

let VectorTile = null;
let Pbf = null;
try {
  ({ VectorTile } = await import('@mapbox/vector-tile'));
  Pbf = (await import('pbf')).default;
} catch (e) {
  console.log('décodeur MVT indisponible :', e.message);
}
for (const p of points) {
  const [z, lat, lon] = p.split(',').map(Number);
  const x = Math.floor(((lon + 180) / 360) * 2 ** z);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
  const t = await archive.getZxy(z, x, y);
  if (!t) {
    console.log(`${z}/${x}/${y} : absente`);
    continue;
  }
  let detail = '';
  if (VectorTile && Pbf) {
    const vt = new VectorTile(new Pbf(new Uint8Array(t.data)));
    detail = Object.entries(vt.layers)
      .map(([name, layer]) => `${name} : ${layer.length} entités, ex. ${JSON.stringify(layer.feature(0).properties).slice(0, 160)}`)
      .join(' | ');
  }
  console.log(`${z}/${x}/${y} : ${t.data.byteLength} octets décompressés ; ${detail}`);
}
