// Lecteur minimal de tuiles vectorielles (Mapbox Vector Tile, version 2) sans aucune dépendance :
// juste ce qu'il faut pour lire les polygones d'une couche et une propriété texte.
// Format : https://github.com/mapbox/vector-tile-spec (protobuf : varints et champs délimités).

/** Lit un varint à partir de `pos` ; rend [valeur, nouvelle position]. Valeurs < 2^53. */
function varint(buf, pos) {
  let value = 0;
  let mul = 1;
  for (;;) {
    const b = buf[pos++];
    value += (b & 0x7f) * mul;
    if (b < 0x80) return [value, pos];
    mul *= 128;
  }
}

/** Parcourt les champs d'un message protobuf : appelle champ(numéro, type, valeur ou sous-tampon). */
function champs(buf, visite) {
  let pos = 0;
  while (pos < buf.length) {
    let cle;
    [cle, pos] = varint(buf, pos);
    const numero = Math.floor(cle / 8);
    const type = cle % 8;
    if (type === 0) {
      let v;
      [v, pos] = varint(buf, pos);
      visite(numero, type, v);
    } else if (type === 2) {
      let n;
      [n, pos] = varint(buf, pos);
      visite(numero, type, buf.subarray(pos, pos + n));
      pos += n;
    } else if (type === 5) {
      visite(numero, type, buf.subarray(pos, pos + 4));
      pos += 4;
    } else if (type === 1) {
      visite(numero, type, buf.subarray(pos, pos + 8));
      pos += 8;
    } else throw new Error(`type de champ protobuf ${type} non géré`);
  }
}

const zigzag = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);

/** Anneaux [[x, y], …] d'une géométrie de polygone (commandes MoveTo 1, LineTo 2, ClosePath 7). */
function anneaux(geometrie) {
  const rings = [];
  let ring = null;
  let x = 0;
  let y = 0;
  let pos = 0;
  while (pos < geometrie.length) {
    let entete;
    [entete, pos] = varint(geometrie, pos);
    const commande = entete & 7;
    const nombre = entete >>> 3;
    if (commande === 7) {
      if (ring) ring.push([ring[0][0], ring[0][1]]); // même convention que @mapbox/vector-tile : anneau refermé
      continue;
    }
    for (let k = 0; k < nombre; k++) {
      let dx;
      let dy;
      [dx, pos] = varint(geometrie, pos);
      [dy, pos] = varint(geometrie, pos);
      x += zigzag(dx);
      y += zigzag(dy);
      if (commande === 1) {
        ring = [];
        rings.push(ring);
      }
      ring.push([x, y]);
    }
  }
  return rings;
}

/**
 * Polygones d'une couche : { extent, objets: [{ valeur, rings }] }, `valeur` étant la propriété texte
 * `propriete` de l'objet (null si absente). Rend null si la couche n'est pas dans la tuile.
 */
export function lireCouche(tuile, nomCouche, propriete) {
  let resultat = null;
  champs(tuile, (numero, type, couche) => {
    if (numero !== 3 || type !== 2) return;
    let nom = '';
    let extent = 4096;
    const cles = [];
    const valeurs = [];
    const bruts = [];
    champs(couche, (n, t, v) => {
      if (n === 1) nom = Buffer.from(v).toString('utf8');
      else if (n === 2) bruts.push(v);
      else if (n === 3) cles.push(Buffer.from(v).toString('utf8'));
      else if (n === 4) {
        let texte = null;
        champs(v, (vn, vt, vv) => {
          if (vn === 1 && vt === 2) texte = Buffer.from(vv).toString('utf8');
        });
        valeurs.push(texte); // seules les valeurs texte nous intéressent
      } else if (n === 5) extent = v;
    });
    if (nom !== nomCouche) return;
    const indice = cles.indexOf(propriete);
    const objets = [];
    for (const brut of bruts) {
      let genre = 0;
      let tags = null;
      let geometrie = null;
      champs(brut, (n, t, v) => {
        if (n === 2) tags = v;
        else if (n === 3) genre = v;
        else if (n === 4) geometrie = v;
      });
      if (genre !== 3 || !geometrie) continue; // polygones seulement
      let valeur = null;
      if (tags && indice >= 0) {
        let pos = 0;
        while (pos < tags.length) {
          let k;
          let v;
          [k, pos] = varint(tags, pos);
          [v, pos] = varint(tags, pos);
          if (k === indice) valeur = valeurs[v] ?? null;
        }
      }
      objets.push({ valeur, rings: anneaux(geometrie) });
    }
    resultat = { extent, objets };
  });
  return resultat;
}
