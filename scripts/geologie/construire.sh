#!/usr/bin/env bash
# Construit les tuiles vectorielles « nature du sol » dans public/data/geologie/.
#
# Source : BRGM, cartes géologiques harmonisées au 1/50 000 (BD Charm-50, version 2019),
# Licence Ouverte 2.0, téléchargées depuis le miroir référencé par data.gouv.fr
# (jeu « Cartes géologiques départementales à 1/50 000 »).
#
# Prérequis : GDAL ≥ 3.8 (ogr2ogr avec le pilote MVT), Node ≥ 20, curl, unzip.
# Utilisé par .github/workflows/deploy.yml ; en local : `bash scripts/geologie/construire.sh`.
#
# Variables : DEPARTEMENTS (défaut « 074 073 »), MIROIR, TRAVAIL (dossier de travail).
set -euo pipefail

DEPARTEMENTS="${DEPARTEMENTS:-074 073}"
MIROIR="${MIROIR:-http://data.cquest.org/brgm/bd_charm_50/2019}"
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
TRAVAIL="${TRAVAIL:-$RACINE/.cache/geologie}"
SORTIE="$RACINE/public/data/geologie"

mkdir -p "$TRAVAIL" "$(dirname "$SORTIE")"
rm -rf "$SORTIE" # le pilote MVT crée lui-même le dossier final
: > "$TRAVAIL/tout.geojsonl"

for d in $DEPARTEMENTS; do
  archive="$TRAVAIL/GEO050K_HARM_${d}.zip"
  if [ ! -s "$archive" ]; then
    echo "Téléchargement de la géologie du département ${d}…"
    curl -fsSL --retry 3 -o "$archive" "$MIROIR/GEO050K_HARM_${d}.zip"
  fi
  rm -rf "${TRAVAIL:?}/$d" && mkdir -p "$TRAVAIL/$d"
  unzip -q -o "$archive" -d "$TRAVAIL/$d"
  shp=$(find "$TRAVAIL/$d" -iname "*_S_FGEOL_*.shp" | head -1)
  if [ -z "$shp" ]; then
    echo "Couche S_FGEOL introuvable dans $archive" >&2
    exit 1
  fi
  # Lambert-93 → WGS84, simplification de 4 m (bien en dessous de la précision du 1/50 000).
  ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 -simplify 4 -lco COORDINATE_PRECISION=6 \
    -select NOTATION,DESCR "$TRAVAIL/brut-$d.geojsonl" "$shp"
  node "$ICI/classer.mjs" "$TRAVAIL/brut-$d.geojsonl" "$TRAVAIL/sol-$d.geojsonl" "$TRAVAIL/rapport-$d.json"
  cat "$TRAVAIL/sol-$d.geojsonl" >> "$TRAVAIL/tout.geojsonl"
done

echo "Découpage en tuiles vectorielles…"
ogr2ogr -f MVT "$SORTIE" "$TRAVAIL/tout.geojsonl" -nln geologie \
  -dsco FORMAT=DIRECTORY -dsco TILE_EXTENSION=pbf -dsco COMPRESS=NO \
  -dsco MINZOOM=9 -dsco MAXZOOM=13 -dsco SIMPLIFICATION=1 -dsco MAX_SIZE=600000

node "$ICI/info.mjs" "$SORTIE" "$TRAVAIL" $DEPARTEMENTS
echo "Tuiles écrites dans $SORTIE ($(find "$SORTIE" -name '*.pbf' | wc -l) fichiers, $(du -sh "$SORTIE" | cut -f1))."
