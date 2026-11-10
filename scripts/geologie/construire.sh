#!/usr/bin/env bash
# Construit les tuiles vectorielles « nature du sol » dans public/data/geologie/, pour toute la
# France métropolitaine (ou les départements de DEPARTEMENTS).
#
# Source : BRGM, cartes géologiques harmonisées au 1/50 000 (BD Charm-50, version 2019),
# Licence Ouverte 2.0, téléchargées depuis le miroir référencé par data.gouv.fr
# (jeu « Cartes géologiques départementales à 1/50 000 ») : ≈ 2,7 Go pour toute la France, une
# archive par département, sauf le Nord et le Pas-de-Calais (059_062) et l'Île-de-France
# (075_077_078_091_092_093_094_095), regroupés. Une archive absente du miroir est sautée
# (avertissement) et listée dans info.json (« manquants »).
#
# Prérequis : GDAL ≥ 3.8 (ogr2ogr avec le pilote MVT), Node ≥ 20, curl, unzip.
# Utilisé par .github/workflows/deploy.yml (tuiles gardées en cache tant que ces scripts ne changent
# pas) ; en local : `DEPARTEMENTS="074 073" bash scripts/geologie/construire.sh`.
#
# Variables : DEPARTEMENTS (défaut « tous » ; noms des archives du miroir, ex. « 074 073 059_062 »),
# MIROIR, TRAVAIL (dossier de travail), GARDER_ARCHIVES=1 pour garder les fichiers téléchargés
# (sinon effacés au fur et à mesure), TABLE_DESCR=fichier.tsv pour la table de toutes les descriptions.
set -euo pipefail

DEPARTEMENTS="${DEPARTEMENTS:-tous}"
if [ "$DEPARTEMENTS" = tous ]; then
  GROUPES="059_062 075_077_078_091_092_093_094_095"
  DEPARTEMENTS="$(seq -f '%03g' 1 95 | grep -v -E '^(020|059|062|075|077|078|09[1-5])$' | tr '\n' ' ')02A 02B $GROUPES"
fi
MIROIR="${MIROIR:-http://data.cquest.org/brgm/bd_charm_50/2019}"
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
TRAVAIL="${TRAVAIL:-$RACINE/.cache/geologie}"
SORTIE="$RACINE/public/data/geologie"
# Tuiles écrites à part, puis mises en place seulement si tout a réussi : en cas d'échec, les
# tuiles précédentes (cache) restent servies.
NEUVES="$TRAVAIL/tuiles"

mkdir -p "$TRAVAIL" "$(dirname "$SORTIE")"
rm -rf "$NEUVES" # le pilote MVT crée lui-même le dossier final
rm -f "$TRAVAIL"/rapport-*.json
: > "$TRAVAIL/tout.geojsonl"
traites=""
manquants=""

for d in $DEPARTEMENTS; do
  archive="$TRAVAIL/GEO050K_HARM_${d}.zip"
  if [ ! -s "$archive" ]; then
    if ! curl -fsSL --retry 3 --retry-delay 10 -o "$archive.part" "$MIROIR/GEO050K_HARM_${d}.zip"; then
      echo "::warning::Géologie du département ${d} introuvable sur le miroir : pas de nature du sol ici."
      rm -f "$archive.part"
      manquants="$manquants $d"
      continue
    fi
    mv "$archive.part" "$archive"
  fi
  rm -rf "${TRAVAIL:?}/$d" && mkdir -p "$TRAVAIL/$d"
  unzip -q -o "$archive" -d "$TRAVAIL/$d"
  # Une couche S_FGEOL par archive, parfois une par département dans les archives regroupées.
  n=0
  while IFS= read -r shp; do
    n=$((n + 1))
    # Lambert-93 → WGS84, simplification de 4 m (bien en dessous de la précision du 1/50 000).
    ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 -simplify 4 -lco COORDINATE_PRECISION=6 \
      -select NOTATION,DESCR "$TRAVAIL/brut.geojsonl" "$shp"
    node "$ICI/classer.mjs" "$TRAVAIL/brut.geojsonl" "$TRAVAIL/sol.geojsonl" "$TRAVAIL/rapport-$d-$n.json"
    cat "$TRAVAIL/sol.geojsonl" >> "$TRAVAIL/tout.geojsonl"
    rm -f "$TRAVAIL/brut.geojsonl" "$TRAVAIL/sol.geojsonl"
  done < <(find "$TRAVAIL/$d" -iname "*_S_FGEOL_*.shp" | sort)
  rm -rf "${TRAVAIL:?}/$d"
  [ "${GARDER_ARCHIVES:-0}" = 1 ] || rm -f "$archive"
  if [ "$n" = 0 ]; then
    echo "::warning::Couche S_FGEOL introuvable dans l'archive ${d} : pas de nature du sol ici."
    manquants="$manquants $d"
    continue
  fi
  traites="$traites $d"
  echo "Archive $d classée ($(du -sh "$TRAVAIL/tout.geojsonl" | cut -f1) en tout)."
done

if [ -z "$traites" ]; then
  echo "Aucune archive traitée : pas de tuiles de géologie." >&2
  exit 1
fi

# Zoom 12 au plus : une unité de tuile y vaut 2,4 m, bien assez pour le 1/50 000 (la carte sur-zoome
# au-delà), et la France entière tient dans la limite de taille de GitHub Pages (1 Go). Aux zooms 9
# à 11, simplification de 4 unités (un demi-pixel à l'écran) : tuiles bien plus légères sur téléphone.
echo "Découpage en tuiles vectorielles…"
ogr2ogr -f MVT "$NEUVES" "$TRAVAIL/tout.geojsonl" -nln geologie \
  -dsco FORMAT=DIRECTORY -dsco TILE_EXTENSION=pbf -dsco COMPRESS=NO \
  -dsco MINZOOM=9 -dsco MAXZOOM=12 -dsco SIMPLIFICATION=4 -dsco SIMPLIFICATION_MAX_ZOOM=1 -dsco MAX_SIZE=600000

# shellcheck disable=SC2086
MANQUANTS="${manquants# }" node "$ICI/info.mjs" "$NEUVES" "$TRAVAIL" $traites
rm -rf "$SORTIE" && mv "$NEUVES" "$SORTIE" && rm -f "$TRAVAIL/tout.geojsonl"
echo "Tuiles écrites dans $SORTIE ($(find "$SORTIE" -name '*.pbf' | wc -l) fichiers, $(du -sh "$SORTIE" | cut -f1)) ; manquants :${manquants:- aucun}."
