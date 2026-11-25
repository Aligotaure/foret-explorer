// Lit une archive zip sans la télécharger en entier : sa table des matières est à la fin, et chaque
// fichier se retrouve par sa position. `lirePlage(debut, fin)` rend les octets de `debut` à `fin`
// compris (un fichier local dans les tests, une requête HTTP « Range » chez Zenodo).
// Archives de plus de 4 Go comprises (zip64 : celle de la France en fait 5,2).
import zlib from 'node:zlib';

const FIN = 0x06054b50;
const FIN64 = 0x06064b50;
const REPERE64 = 0x07064b50;
const ENTREE = 0x02014b50;
const LOCAL = 0x04034b50;
/** La table des matières d'une archive d'une dizaine de fichiers tient largement dans ces octets. */
const QUEUE = 65536;

/** Fichiers de l'archive : nom, méthode de compression, somme de contrôle, tailles et position. */
export async function lister(lirePlage, taille) {
  const debut = Math.max(0, taille - QUEUE);
  const fin = await lirePlage(debut, taille - 1);
  let p = fin.length - 22;
  while (p >= 0 && fin.readUInt32LE(p) !== FIN) p--;
  if (p < 0) throw new Error('archive zip : fin introuvable');
  let nombre = fin.readUInt16LE(p + 10);
  let tailleTable = fin.readUInt32LE(p + 12);
  let posTable = fin.readUInt32LE(p + 16);
  if (p >= 20 && fin.readUInt32LE(p - 20) === REPERE64) {
    const q = Number(fin.readBigUInt64LE(p - 20 + 8)) - debut;
    if (q < 0 || fin.readUInt32LE(q) !== FIN64) throw new Error('archive zip : enregistrement zip64 illisible');
    nombre = Number(fin.readBigUInt64LE(q + 32));
    tailleTable = Number(fin.readBigUInt64LE(q + 40));
    posTable = Number(fin.readBigUInt64LE(q + 48));
  }
  const table = posTable >= debut ? fin.subarray(posTable - debut, posTable - debut + tailleTable) : await lirePlage(posTable, posTable + tailleTable - 1);
  const entrees = [];
  let c = 0;
  for (let n = 0; n < nombre; n++) {
    if (table.readUInt32LE(c) !== ENTREE) throw new Error(`archive zip : entrée ${n} illisible`);
    const methode = table.readUInt16LE(c + 10);
    const crc = table.readUInt32LE(c + 16);
    let compresse = table.readUInt32LE(c + 20);
    let tailleFichier = table.readUInt32LE(c + 24);
    const lNom = table.readUInt16LE(c + 28);
    const lExtra = table.readUInt16LE(c + 30);
    const lCommentaire = table.readUInt16LE(c + 32);
    let position = table.readUInt32LE(c + 42);
    const nom = table.subarray(c + 46, c + 46 + lNom).toString('utf8');
    // Champ zip64 : les valeurs qui ne tiennent pas sur 32 bits, dans cet ordre.
    for (let e = c + 46 + lNom; e + 4 <= c + 46 + lNom + lExtra; e += 4 + table.readUInt16LE(e + 2)) {
      if (table.readUInt16LE(e) !== 1) continue;
      let o = e + 4;
      if (tailleFichier === 0xffffffff) { tailleFichier = Number(table.readBigUInt64LE(o)); o += 8; }
      if (compresse === 0xffffffff) { compresse = Number(table.readBigUInt64LE(o)); o += 8; }
      if (position === 0xffffffff) position = Number(table.readBigUInt64LE(o));
    }
    entrees.push({ nom, methode, crc, compresse, taille: tailleFichier, position });
    c += 46 + lNom + lExtra + lCommentaire;
  }
  return entrees;
}

/** Contenu d'un fichier de l'archive, décompressé et vérifié (taille et somme de contrôle). */
export async function extraire(lirePlage, entree) {
  const tete = await lirePlage(entree.position, entree.position + 29);
  if (tete.readUInt32LE(0) !== LOCAL) throw new Error(`archive zip : en-tête de ${entree.nom} illisible`);
  const debut = entree.position + 30 + tete.readUInt16LE(26) + tete.readUInt16LE(28);
  const brut = entree.compresse ? await lirePlage(debut, debut + entree.compresse - 1) : Buffer.alloc(0);
  let contenu;
  if (entree.methode === 0) contenu = brut;
  else if (entree.methode === 8) contenu = zlib.inflateRawSync(brut);
  else throw new Error(`archive zip : méthode ${entree.methode} non gérée pour ${entree.nom}`);
  if (contenu.length !== entree.taille) throw new Error(`${entree.nom} : ${contenu.length} octets au lieu de ${entree.taille}`);
  if (zlib.crc32(contenu) !== entree.crc) throw new Error(`${entree.nom} : somme de contrôle fausse`);
  return contenu;
}
