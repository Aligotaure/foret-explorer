#!/usr/bin/env bash
# Sonde n°15 : tailles des cartes géologiques de tous les départements et classement de 4 départements tests.
set +e
M=http://data.cquest.org/brgm/bd_charm_50/2019
total=0; manquants=""
for d in $(seq -w 1 95 | sed 's/^/0/') 02A 02B; do
  [ "$d" = "020" ] && continue
  taille=$(curl -sSI -m 20 "$M/GEO050K_HARM_${d}.zip" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}')
  if [ -z "$taille" ]; then manquants="$manquants $d"; else total=$((total + taille)); echo "$d $taille"; fi
done > verif/geologie-tailles.txt
echo "total : $((total / 1048576)) Mo ; manquants :$manquants" | tee -a verif/geologie-tailles.txt
for d in 033 063 077 029; do
  curl -fsSL -o /tmp/g$d.zip "$M/GEO050K_HARM_${d}.zip" || { echo "$d téléchargement raté"; continue; }
  rm -rf /tmp/g$d && mkdir -p /tmp/g$d && unzip -q -o /tmp/g$d.zip -d /tmp/g$d
  shp=$(find /tmp/g$d -iname "*_S_FGEOL_*.shp" | head -1)
  ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 -simplify 4 -lco COORDINATE_PRECISION=6 -select NOTATION,DESCR /tmp/brut-$d.geojsonl "$shp"
  node scripts/geologie/classer.mjs /tmp/brut-$d.geojsonl /tmp/sol-$d.geojsonl verif/rapport-$d.json > /dev/null
  node -e "
    const r = require('/home/runner/work/foret-explorer/foret-explorer/verif/rapport-$d.json');
    const sols = Object.entries(r.sols ?? {}).map(([k, v]) => k + ' ' + Math.round(v.km2)).join(', ');
    const nc = Object.entries(r.nonClasses ?? r.unclassified ?? {}).sort((a, b) => b[1] - a[1]);
    const ncKm2 = nc.reduce((s, [, v]) => s + v, 0);
    console.log('$d', 'classées :', sols, '| non classées :', Math.round(ncKm2), 'km²');
    for (const [k, v] of nc.slice(0, 12)) console.log('   ', Math.round(v), 'km²', k.slice(0, 150));
  " | tee -a verif/geologie-classement.txt
  rm -rf /tmp/g$d /tmp/g$d.zip
done
