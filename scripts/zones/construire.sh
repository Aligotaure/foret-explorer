#!/usr/bin/env bash
# Construit les tuiles vectorielles « zones » dans public/data/zones/ :
#   couche « protection »     : espaces protégés PatriNat (OFB, MNHN) qui peuvent interdire ou limiter
#                               la cueillette (champs type, nom, url, detail) ;
#   couche « protection_nom » : un point par zone protégée pour son nom (champs nom, type, rang) ;
#   couche « foret_publique » : forêts publiques de la BD TOPO de l'IGN, d'après l'ONF (champs nature, nom).
# Données téléchargées depuis le WFS de la Géoplateforme par telecharger.mjs (sans clé).
#
# Prérequis : GDAL ≥ 3.8 (ogr2ogr avec le pilote MVT), Node ≥ 20.
# Utilisé par .github/workflows/deploy.yml ; en local : `bash scripts/zones/construire.sh`.
# Variables : EMPRISE (sud,ouest,nord,est ; défaut Savoie, Haute-Savoie et alentours), TRAVAIL, FORCE=1.
set -euo pipefail

ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
TRAVAIL="${TRAVAIL:-$RACINE/.cache/zones}"
SORTIE="$RACINE/public/data/zones"
EMPRISE="${EMPRISE:-45.0,5.6,46.45,7.25}"

node "$ICI/telecharger.mjs" "$TRAVAIL" "$EMPRISE"

mkdir -p "$(dirname "$SORTIE")"
rm -rf "$SORTIE" "$TRAVAIL/zones.gpkg" # le pilote MVT crée lui-même le dossier final
# Lambert-93 → WGS84, simplification de 5 m (les limites sont dessinées au 1/25 000 au mieux).
ogr2ogr -f GPKG "$TRAVAIL/zones.gpkg" "$TRAVAIL/protection.geojsonl" -s_srs EPSG:2154 -t_srs EPSG:4326 \
  -simplify 5 -nlt PROMOTE_TO_MULTI -nln protection
ogr2ogr -update -f GPKG "$TRAVAIL/zones.gpkg" "$TRAVAIL/etiquettes.geojsonl" -s_srs EPSG:2154 -t_srs EPSG:4326 \
  -nln protection_nom
ogr2ogr -update -f GPKG "$TRAVAIL/zones.gpkg" "$TRAVAIL/forets.geojsonl" -s_srs EPSG:2154 -t_srs EPSG:4326 \
  -simplify 5 -nlt PROMOTE_TO_MULTI -nln foret_publique

echo "Découpage en tuiles vectorielles…"
ogr2ogr -f MVT "$SORTIE" "$TRAVAIL/zones.gpkg" \
  -dsco FORMAT=DIRECTORY -dsco TILE_EXTENSION=pbf -dsco COMPRESS=NO \
  -dsco MINZOOM=9 -dsco MAXZOOM=13 -dsco SIMPLIFICATION=1 -dsco MAX_SIZE=600000

# info.json : lu par la carte (sans lui, le bilan d'un coin ne dit rien du statut du terrain).
cp "$TRAVAIL/resume.json" "$SORTIE/info.json"
echo "Tuiles écrites dans $SORTIE ($(find "$SORTIE" -name '*.pbf' | wc -l) fichiers, $(du -sh "$SORTIE" | cut -f1))."
