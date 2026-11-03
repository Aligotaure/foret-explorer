#!/usr/bin/env bash
# Sonde n°16 : fichiers manquants du miroir BRGM (Nord, Pas-de-Calais, Île-de-France) et nouveau classement.
set +e
M=http://data.cquest.org/brgm/bd_charm_50
for dir in "" 2019/; do
  echo "== $M/$dir"
  curl -sS -m 30 "$M/$dir" | grep -o 'href="[^"]*"' | sed 's/href="//;s/"$//' | grep -v -E '^GEO050K_HARM_0[0-9][0-9]\.zip$' | head -60
done
echo "== tailles des fichiers 059 062 075 077 078 091 à 095, autres noms"
for n in 059 062 075 077 078 091 092 093 094 095 IDF idf 075_077_078_091_092_093_094_095 059_062 NPC; do
  printf '%s ' "$n"; curl -sSI -m 20 "$M/2019/GEO050K_HARM_${n}.zip" | tr -d '\r' | awk 'tolower($1)=="content-length:"{printf "%s ", $2} /^HTTP/{printf "%s ", $2}'; echo
done
for d in 063 033; do
  curl -fsSL -o /tmp/g$d.zip "$M/2019/GEO050K_HARM_${d}.zip" || { echo "$d téléchargement raté"; continue; }
  rm -rf /tmp/g$d && mkdir -p /tmp/g$d && unzip -q -o /tmp/g$d.zip -d /tmp/g$d
  shp=$(find /tmp/g$d -iname "*_S_FGEOL_*.shp" | head -1)
  ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 -simplify 4 -lco COORDINATE_PRECISION=6 -select NOTATION,DESCR /tmp/brut-$d.geojsonl "$shp"
  node scripts/geologie/classer.mjs /tmp/brut-$d.geojsonl /tmp/sol-$d.geojsonl verif/rapport16-$d.json > /dev/null
  node -e "
    const r = require(process.cwd() + '/verif/rapport16-$d.json');
    console.log('$d', JSON.stringify(r.sols));
    for (const x of (r.nonClassees ?? []).slice(0, 10)) console.log('   ', x.slice(0, 150));
  " | tee -a verif/geologie16.txt
  # Formations volcaniques : où vont-elles maintenant ?
  node --input-type=module -e "
    import { readFileSync } from 'node:fs';
    import { classer } from './scripts/geologie/regles.mjs';
    const seen = new Map();
    for (const line of readFileSync('/tmp/brut-$d.geojsonl', 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const p = JSON.parse(line.replace(/^\x1e/, '')).properties;
      const k = p.DESCR ?? '';
      if (!/volcan|basalt|coul|trachy|andesit|phonol|pyrocl|dune/i.test(k.normalize('NFD').replace(/[̀-ͯ]/g, ''))) continue;
      if (!seen.has(k)) seen.set(k, classer(k, p.NOTATION ?? ''));
    }
    for (const [k, v] of [...seen].slice(0, 40)) console.log('  ', v, '←', k.slice(0, 120));
  " | tee -a verif/geologie16.txt
  rm -rf /tmp/g$d /tmp/g$d.zip
done
