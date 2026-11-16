#!/usr/bin/env bash
# Construit les tuiles vectorielles « zones » : une archive public/data/zones/zones.pmtiles (lue par
# morceaux, voir scripts/geologie/construire.sh) et son info.json. Trois couches :
#   couche « protection »     : espaces protégés PatriNat (OFB, MNHN) et terrains du Conservatoire du
#                               littoral, qui peuvent interdire ou limiter la cueillette (champs type,
#                               nom, url, detail) ;
#   couche « protection_nom » : un point par zone protégée pour son nom (champs nom, type, rang) ;
#   couche « foret_publique » : forêts publiques de la BD TOPO de l'IGN, d'après l'ONF (champs nature, nom).
# Données téléchargées depuis le WFS de la Géoplateforme par telecharger.mjs (sans clé).
#
# Prérequis : GDAL ≥ 3.8 (ogr2ogr avec le pilote PMTiles, et SpatiaLite pour fusionner les parcelles
# du Conservatoire : c'est le cas du paquet gdal-bin d'Ubuntu), Node ≥ 20.
# Utilisé par .github/workflows/deploy.yml ; en local : `bash scripts/zones/construire.sh`.
# Variables : EMPRISE (sud,ouest,nord,est ; défaut France métropolitaine et Corse), TRAVAIL, FORCE=1.
set -euo pipefail

ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
TRAVAIL="${TRAVAIL:-$RACINE/.cache/zones}"
SORTIE="$RACINE/public/data/zones"
EMPRISE="${EMPRISE:-41.2,-5.3,51.2,9.7}"

# Toute la France : ≈ 17 000 forêts publiques, 4 300 zones protégées et 64 000 parcelles du
# Conservatoire, gardées en mémoire le temps du tri.
NODE_OPTIONS="--max-old-space-size=6144" node "$ICI/telecharger.mjs" "$TRAVAIL" "$EMPRISE"

# Archive écrite à part, puis mise en place seulement si tout a réussi : en cas d'échec (WFS en
# panne…), la précédente reste servie.
NEUVES="$TRAVAIL/tuiles"
mkdir -p "$(dirname "$SORTIE")"
rm -rf "$NEUVES" "$TRAVAIL/zones.gpkg" && mkdir -p "$NEUVES"
# Lambert-93 → WGS84, simplification de 5 m (les limites sont dessinées au 1/25 000 au mieux).
ogr2ogr -f GPKG "$TRAVAIL/zones.gpkg" "$TRAVAIL/protection.geojsonl" -s_srs EPSG:2154 -t_srs EPSG:4326 \
  -simplify 5 -nlt PROMOTE_TO_MULTI -nln protection
# Conservatoire du littoral : parcelles cadastrales fusionnées par site et par type (possédé, géré),
# sinon chaque parcelle serait tracée en rouge. Des parcelles voisines laissent parfois des interstices
# de moins d'un mètre (≈ 120 km de bords en tout, mesuré le 16/11/2026), qui deviendraient de fins trous
# cernés de rouge : chaque parcelle est dilatée d'un mètre avant la fusion, le terrain resserré d'autant
# après (2 segments par quart de cercle : les arrondis disparaissent à la simplification de 5 m).
ogr2ogr -update -append -f GPKG "$TRAVAIL/zones.gpkg" "$TRAVAIL/conservatoire.geojsonl" \
  -s_srs EPSG:2154 -t_srs EPSG:4326 -simplify 5 -nlt PROMOTE_TO_MULTI -nln protection -dialect SQLite \
  -sql "SELECT type, nom, ST_Buffer(ST_Union(ST_Buffer(geometry, 1, 2)), -1, 2) AS geometry FROM conservatoire GROUP BY site, type"
# Contrôle : un objet par terrain compté par telecharger.mjs, chacun avec sa géométrie.
fusionnes=$(ogr2ogr -f CSV /vsistdout/ "$TRAVAIL/zones.gpkg" \
  -sql "SELECT COUNT(*) AS n FROM protection WHERE type IN ('cdl', 'cdl_gestion') AND geom IS NOT NULL" | tail -n 1)
attendus=$(node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).compteurs; console.log((c.cdl ?? 0) + (c.cdl_gestion ?? 0))' "$TRAVAIL/resume.json")
if [ "$fusionnes" != "$attendus" ]; then
  echo "Conservatoire du littoral : $fusionnes terrains fusionnés pour $attendus attendus." >&2
  exit 1
fi
echo "Conservatoire du littoral : $fusionnes terrains (site et type), parcelles fusionnées."
ogr2ogr -update -f GPKG "$TRAVAIL/zones.gpkg" "$TRAVAIL/etiquettes.geojsonl" -s_srs EPSG:2154 -t_srs EPSG:4326 \
  -nln protection_nom
ogr2ogr -update -f GPKG "$TRAVAIL/zones.gpkg" "$TRAVAIL/forets.geojsonl" -s_srs EPSG:2154 -t_srs EPSG:4326 \
  -simplify 5 -nlt PROMOTE_TO_MULTI -nln foret_publique

# Zooms 9 à 11 (la carte sur-zoome au-delà) : 3,3 m par unité de tuile au zoom 11, pour des limites
# simplifiées à 5 m. Les tuiles sont compressées dans l'archive.
echo "Découpage en tuiles vectorielles…"
ogr2ogr -f PMTiles "$NEUVES/zones.pmtiles" "$TRAVAIL/zones.gpkg" \
  -dsco MINZOOM=9 -dsco MAXZOOM=11 -dsco SIMPLIFICATION=1 -dsco MAX_SIZE=600000

# info.json : lu par la carte (sans lui, le bilan d'un coin ne dit rien du statut du terrain).
cp "$TRAVAIL/resume.json" "$NEUVES/info.json"
rm -rf "$SORTIE" && mv "$NEUVES" "$SORTIE"
echo "Archive écrite dans $SORTIE ($(du -h "$SORTIE/zones.pmtiles" | cut -f1))."
