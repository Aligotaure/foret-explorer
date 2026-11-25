// Lecteur minimal d'image TIFF (classique ou BigTIFF), sans dépendance : étiquettes, puis tuiles ou
// bandes décompressées (aucune compression, LZW, Deflate, Zstandard ; prédicteur horizontal).
// Un seul canal entier de 8 ou 16 bits : de quoi lire une carte d'années.
import { openSync, readSync } from 'node:fs';
import zlib from 'node:zlib';

const TAILLES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

export function ouvrir(chemin) {
  const fd = openSync(chemin, 'r');
  const lire = (pos, n) => {
    const b = Buffer.allocUnsafe(n);
    let lu = 0;
    while (lu < n) {
      const r = readSync(fd, b, lu, n - lu, pos + lu);
      if (!r) throw new Error('fin de fichier inattendue');
      lu += r;
    }
    return b;
  };
  const tete = lire(0, 16);
  const ordre = tete.toString('latin1', 0, 2);
  if (ordre !== 'II' && ordre !== 'MM') throw new Error('pas un fichier TIFF');
  const le = ordre === 'II';
  const u16 = (b, o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (b, o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const u64 = (b, o) => Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o));
  const version = u16(tete, 2);
  if (version !== 42 && version !== 43) throw new Error(`version TIFF ${version} inconnue`);
  const grand = version === 43;
  const posIfd = grand ? u64(tete, 8) : u32(tete, 4);
  const nb = grand ? u64(lire(posIfd, 8), 0) : u16(lire(posIfd, 2), 0);
  const tEntree = grand ? 20 : 12;
  const entrees = lire(posIfd + (grand ? 8 : 2), nb * tEntree);
  const tags = new Map();
  for (let k = 0; k < nb; k++) {
    const e = entrees.subarray(k * tEntree, (k + 1) * tEntree);
    const tag = u16(e, 0);
    const type = u16(e, 2);
    const compte = grand ? u64(e, 4) : u32(e, 4);
    const champ = grand ? 12 : 8;
    const tChamp = grand ? 8 : 4;
    const t = TAILLES[type];
    if (!t) continue;
    const total = t * compte;
    const d = total <= tChamp ? e.subarray(champ, champ + total) : lire(grand ? u64(e, champ) : u32(e, champ), total);
    let v;
    if (type === 2) v = d.toString('latin1').replace(/\0+$/, '');
    else {
      v = new Array(compte);
      for (let i = 0; i < compte; i++) {
        const o = i * t;
        if (type === 1 || type === 7) v[i] = d[o];
        else if (type === 6) v[i] = d.readInt8(o);
        else if (type === 3) v[i] = u16(d, o);
        else if (type === 8) v[i] = le ? d.readInt16LE(o) : d.readInt16BE(o);
        else if (type === 4) v[i] = u32(d, o);
        else if (type === 9) v[i] = le ? d.readInt32LE(o) : d.readInt32BE(o);
        else if (type === 12) v[i] = le ? d.readDoubleLE(o) : d.readDoubleBE(o);
        else if (type === 11) v[i] = le ? d.readFloatLE(o) : d.readFloatBE(o);
        else if (type === 16 || type === 18) v[i] = u64(d, o);
        else if (type === 5) v[i] = u32(d, o) / u32(d, o + 4);
        else v[i] = null;
      }
    }
    tags.set(tag, v);
  }
  const un = (tag, defaut) => (tags.has(tag) ? tags.get(tag)[0] : defaut);
  const largeur = un(256);
  const hauteur = un(257);
  const bits = un(258, 1);
  const compression = un(259, 1);
  const canaux = un(277, 1);
  const predicteur = un(317, 1);
  const format = un(339, 1); // 1 non signé, 2 signé, 3 flottant
  const enTuiles = tags.has(322);
  const lTuile = enTuiles ? un(322) : largeur;
  const hTuile = enTuiles ? un(323) : un(278, hauteur);
  const positions = tags.get(enTuiles ? 324 : 273);
  const longueurs = tags.get(enTuiles ? 325 : 279);
  const enLargeur = Math.ceil(largeur / lTuile);
  const enHauteur = Math.ceil(hauteur / hTuile);
  if (canaux !== 1) throw new Error(`${canaux} canaux : non géré`);
  if (bits !== 8 && bits !== 16) throw new Error(`${bits} bits : non géré`);
  if (!le && bits === 16) throw new Error('16 bits gros-boutiste : non géré');
  const octets = bits / 8;

  /** Tuile (ou bande) numéro `n` : valeurs décompressées, ou null si elle est vide (fichier creux). */
  const tuile = (n) => {
    const longueur = longueurs[n];
    if (!longueur) return null;
    const brut = lire(positions[n], longueur);
    const ligne = Math.floor(n / enLargeur);
    // Une bande finale est plus courte ; une tuile est toujours entière.
    const h = enTuiles ? hTuile : Math.min(hTuile, hauteur - ligne * hTuile);
    const attendu = lTuile * h * octets;
    let d;
    if (compression === 1) d = brut;
    else if (compression === 8 || compression === 32946) d = zlib.inflateSync(brut);
    else if (compression === 5) d = lzw(brut, attendu);
    else if (compression === 50000) d = zlib.zstdDecompressSync(brut);
    else throw new Error(`compression ${compression} non gérée`);
    if (d.length < attendu) throw new Error(`tuile ${n} : ${d.length} octets au lieu de ${attendu}`);
    // Copie alignée : un Buffer du lot commun de Node peut commencer à une position impaire.
    const copie = new Uint8Array(attendu);
    copie.set(d.subarray(0, attendu));
    if (bits === 8) {
      if (predicteur === 2) for (let y = 0; y < h; y++) for (let x = 1, o = y * lTuile; x < lTuile; x++) copie[o + x] = (copie[o + x] + copie[o + x - 1]) & 255;
      return format === 2 ? new Int8Array(copie.buffer) : copie;
    }
    const v = format === 2 ? new Int16Array(copie.buffer) : new Uint16Array(copie.buffer);
    if (predicteur === 2) for (let y = 0; y < h; y++) for (let x = 1, o = y * lTuile; x < lTuile; x++) v[o + x] = v[o + x] + v[o + x - 1];
    else if (predicteur !== 1) throw new Error(`prédicteur ${predicteur} non géré`);
    return v;
  };

  return { tags, largeur, hauteur, bits, compression, predicteur, format, enTuiles, lTuile, hTuile, enLargeur, enHauteur, tuile, nbTuiles: positions.length };
}

/** LZW du TIFF (codes de 9 à 12 bits, poids fort d'abord, changement de largeur anticipé). */
export function lzw(src, attendu) {
  const out = Buffer.allocUnsafe(attendu);
  const prefixe = new Uint16Array(4096);
  const suffixe = new Uint8Array(4096);
  const longueur = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) {
    suffixe[i] = i;
    longueur[i] = 1;
  }
  let o = 0;
  let suivant = 258;
  let bits = 9;
  let ancien = -1;
  let tampon = 0;
  let nbBits = 0;
  let p = 0;
  const ecrire = (code, ou) => {
    let q = ou + longueur[code] - 1;
    let c = code;
    while (q >= ou) {
      if (q < attendu) out[q] = suffixe[c];
      c = prefixe[c];
      q--;
    }
  };
  for (;;) {
    while (nbBits < bits) {
      if (p >= src.length) return out.subarray(0, Math.min(o, attendu));
      tampon = ((tampon << 8) | src[p++]) >>> 0;
      nbBits += 8;
    }
    const code = (tampon >>> (nbBits - bits)) & ((1 << bits) - 1);
    nbBits -= bits;
    tampon &= (1 << nbBits) - 1;
    if (code === 257) break;
    if (code === 256) {
      suivant = 258;
      bits = 9;
      ancien = -1;
      continue;
    }
    if (o >= attendu) break;
    if (ancien === -1) {
      out[o++] = code;
      ancien = code;
      continue;
    }
    let l;
    let premier;
    if (code < suivant) {
      l = longueur[code];
      ecrire(code, o);
      premier = out[o];
    } else {
      l = longueur[ancien] + 1;
      ecrire(ancien, o);
      premier = out[o];
      if (o + l - 1 < attendu) out[o + l - 1] = premier;
    }
    if (suivant < 4096) {
      prefixe[suivant] = ancien;
      suffixe[suivant] = premier;
      longueur[suivant] = longueur[ancien] + 1;
      suivant++;
      if (suivant >= (1 << bits) - 1 && bits < 12) bits++;
    }
    o += l;
    ancien = code;
  }
  return out.subarray(0, Math.min(o, attendu));
}
