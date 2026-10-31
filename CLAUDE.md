# Forêt Explorer — notes pour Claude Code

Carte web des types de forêt de la **BD Forêt® V2** (IGN) avec une légende à cases à cocher pour
choisir les types affichés, enrichie pour la cueillette : nature du sol (géologie BRGM), météo des
20 derniers jours (Open-Meteo), altitude (IGN) et indice de pousse par champignon. Interface inspirée
du panneau « Légendes » de cartes.gouv.fr (thème sombre bleu nuit, icônes lavande, légende sur carte
blanche).

Usage visé : repérer les coins favorables aux champignons (cèpes, girolles, trompettes, chanterelles
en tube) autour d'Annecy. La carte sert aussi sur téléphone, en forêt : le mobile compte autant que
le bureau.

En ligne : https://aligotaure.github.io/foret-explorer/ (GitHub Pages, republié à chaque push sur
`main` par `.github/workflows/deploy.yml` : tuiles de géologie, `npm run check`, publication de `dist/`).

## Commandes

- `npm install` puis `npm run dev` : serveur Vite sur http://localhost:5173
- `npm run typecheck` : TypeScript strict, sans émission
- `npm run build` : build statique dans `dist/` ; `npm run check` = typecheck + build
- `npm run test:e2e` : test de bout en bout (Playwright + vrai MapLibre, services simulés,
  48 vérifications). Première fois : `npx playwright install chromium`. Captures dans `tests/e2e/shots/`.
- `bash scripts/geologie/construire.sh` : tuiles « nature du sol » dans `public/data/geologie/`
  (GDAL ≥ 3.8, ~120 Mo téléchargés). Inutile en dev : la carte lit alors celles du site en ligne.

Après chaque modification : `npm run check` puis `npm run test:e2e`.

## Pile

Vite + TypeScript strict + MapLibre GL JS 5, sans framework. Pas de nouvelle dépendance sans raison.

## Architecture (`src/`)

| Fichier | Rôle |
|---|---|
| `main.ts` | Point d'entrée : carte, modules, état → carte, clic → bilan du coin, comptages |
| `config.ts` | URLs des services, zooms, emprise de la géologie, vue initiale, clé localStorage |
| `forestClasses.ts` | Nomenclature : 32 codes `code_tfv`, libellés, couleurs officielles, groupes, préréglages |
| `mapStyle.ts` | Style MapLibre (sources + couches), expressions couleur/filtre/motif, fonctions `apply*()` |
| `state.ts` | Store observable (sélection, opacité, fond, champignon, météo, sol) + persistance localStorage |
| `legend.ts` | Panneau « Légendes » : forêts (cases, groupes, préréglages, comptages), opacité, fond |
| `legendExtras.ts` | Sections « Je cherche… », « Nature du sol », « Météo des 20 derniers jours » |
| `ui.ts` | Section repliable, interrupteur, titre avec icône (partagés par les panneaux) |
| `mushrooms.ts` | Profils des 4 champignons (hôtes, sols, saison, températures, délai après pluie) et indice |
| `soils.ts` | 7 natures de sol, champignons associés, motifs dessinés au canevas |
| `geology.ts` | Motifs fournis à MapLibre (`styleimagemissing`), forêt et sol sous un point |
| `weather.ts` | Client Open-Meteo (multi-points), résumé 20 jours (épisodes de pluie, gel), altitude IGN, grille, cache du jour |
| `meteoLayer.ts` | Grille météo sur la vue (pluie cumulée ou indice du champignon choisi) |
| `spot.ts` | Bilan d'un coin au clic : forêt, sol, altitude, histogramme de pluie, verdicts expliqués |
| `search.ts` | Recherche de lieu (autocomplétion de la Géoplateforme) |
| `toolbar.ts` | Boutons : légende, fond de carte, géolocalisation, plein écran, zoom |
| `counts.ts` | Nombre de polygones par type dans les tuiles affichées |
| `dom.ts`, `icons.ts` | Utilitaires DOM (`h()`, `toast()`…), icônes SVG |

`scripts/geologie/` : `construire.sh` (téléchargement BRGM → GeoJSONSeq WGS84 → classement → MVT),
`regles.mjs` (règles de classement des descriptions géologiques en natures de sol), `classer.mjs`,
`info.mjs` (écrit `info.json` : provenance, emprise, surfaces par sol).

Flux : l'interface ne touche jamais la carte. Elle appelle `store.update()` ; `main.ts` est abonné au
store et appelle `applySelection` / `applyOpacity` / `applyBasemap` / `applyGeology` /
`meteo.applyMode()`. Pour ajouter une option : champ dans `AppState` (+ persistance dans `state.ts`),
contrôle dans `legend.ts` ou `legendExtras.ts`, effet dans `mapStyle.ts`, abonnement dans `main.ts`,
vérification dans `tests/e2e/run.mjs`.

Couches (ordre) : `base-plan`, `base-ortho`, `bdforet-overview` (raster, zoom < 10), `bdforet-fill`
(filtrée), `bdforet-hit` (invisible, non filtrée : forêt sous un clic), `geologie-motifs`,
`geologie-hit` (invisible : sol sous un clic), `bdforet-outline`, `meteo-cellules`, `meteo-contours`,
`meteo-etiquettes`, `bdforet-highlight-casing`, `bdforet-highlight`.

## Données et API

Vérifié le 31/10/2026 (en-têtes CORS compris, depuis GitHub Actions) :

- **Tuiles vectorielles BD Forêt V2** (IGN, sans clé, Licence Ouverte Etalab 2.0) :
  `https://data.geopf.fr/tms/1.0.0/LANDCOVER-TMS.FORESTINVENTORY.V2/{z}/{x}/{y}.pbf`
  - couche `formation_vegetale`, zooms 10 à 16 (sur-zoom au-delà), polygones ;
  - champs : `code_tfv` (32 codes), `tfv` (libellé), `tfv_g11` (11 catégories), `essence`,
    `id` (texte), `fid` (entier) ;
  - ⚠ numérotation **XYZ**. Le style officiel IGN déclare `"scheme": "tms"`, ce qui est faux pour
    MapLibre (vérifié : la tuile 10/529/364 au-dessus d'Annecy répond, 10/529/659 est refusée).
    Ne pas ajouter `scheme: 'tms'` ;
  - un polygone coupé par les bords de tuile garde le même `id` : dédoublonner par `id`.
- **Style officiel IGN** (source des couleurs) :
  `https://data.geopf.fr/annexes/ressources/vectorTiles/styles/BDFORET/LANDCOVER-FORESTINVENTORY-V2.json`.
  Ses *identifiants* de couche pour FF2-90-90 et FF2-91-91 sont inversés ; les filtres par code et
  les couleurs sont justes.
- **Polices des étiquettes** : `https://data.geopf.fr/annexes/ressources/vectorTiles/fonts/{fontstack}/{range}.pbf`,
  police `Source Sans Pro Regular` (CORS ouvert).
- **WMTS** `https://data.geopf.fr/wmts` : `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` (TileMatrixSet `PM`, png),
  `ORTHOIMAGERY.ORTHOPHOTOS` (`PM`, jpeg), `LANDCOVER.FORESTINVENTORY.V2` (`PM_6_16`, png : rendu
  officiel non filtrable, affiché sous le zoom 10). Tuiles raster de 256 px : MapLibre charge le niveau z+1.
- **Autocomplétion** :
  `https://data.geopf.fr/geocodage/completion?text=…&type=StreetAddress,PositionOfInterest&maximumResponses=6`
  → `{ results: [{ x: lon, y: lat, fulltext, country, kind, poiType[] }] }`.
- **Altitude** (RGE ALTI) : `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=…&lat=…&resource=ign_rge_alti_wld&zonly=true`
  → `{ elevations: [930] }` ; −99999 hors couverture.
- **Météo** : Open-Meteo, `https://api.open-meteo.com/v1/forecast?latitude=a,b&longitude=c,d&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&past_days=20&forecast_days=1&timezone=Europe/Paris`
  (+ `elevation=…` pour ramener les températures à l'altitude exacte). Plusieurs points → tableau dans
  le même ordre, un seul point → objet. Sans clé, CORS ouvert, CC BY 4.0, usage non commercial
  (≈ 10 000 appels/jour ; chaque point compte comme un appel) : garder le cache du jour de `weather.ts`.
- **Géologie** : cartes harmonisées au 1/50 000 du BRGM (BD Charm-50, version 2019), couche
  `S_FGEOL` (champs utiles `NOTATION`, `DESCR`), Lambert-93. Téléchargées en CI depuis le miroir
  référencé par data.gouv.fr : `http://data.cquest.org/brgm/bd_charm_50/2019/GEO050K_HARM_0XX.zip`
  (074 : 48 Mo, 073 : 73 Mo). `infoterre.brgm.fr/telechargements/…` renvoie 404 et le WMS
  `geoservices.brgm.fr` n'a pas de CORS (et filtre les robots) : ne pas l'appeler depuis le navigateur.
  Tuiles produites : couche `geologie`, champs `sol`, `notation`, `descr`, zooms 9 à 13, ~26 Mo
  pour 73 + 74, servies sous `data/geologie/{z}/{x}/{y}.pbf` avec `info.json`.
- **WFS BD Forêt** (pas utilisé, utile pour un export) : `https://data.geopf.fr/wfs`,
  `TYPENAMES=LANDCOVER.FORESTINVENTORY.V2:formation_vegetale`, `OUTPUTFORMAT=application/json`,
  `CQL_FILTER` et `PROPERTYNAME` acceptés. Avec GeoServer, `BBOX=` et `CQL_FILTER=` ne se combinent
  pas : mettre la boîte dans le CQL.

## Nomenclature et règles

- Les 32 codes forêt sont dans `forestClasses.ts`. Toujours filtrer sur `code_tfv`, jamais sur `tfv`
  (libellés à variantes : « dun autre pin pur », apostrophes droites ou typographiques).
- Chênes : `FF1G01-01` (décidus), `FF1G06-06` (sempervirents, méditerranéens). Forêt fermée : couvert
  ≥ 40 % ; ouverte : 10 à 40 %. « Pur » : une essence ≥ 75 % du couvert.
- Natures de sol (`soils.ts`, mêmes identifiants que `scripts/geologie/regles.mjs`) : `calcaire`,
  `marne`, `gres`, `cristallin`, `moraine`, `eboulis`, `humide`. Classement : le mot-clé qui apparaît le
  plus tôt dans `DESCR` l'emporte (la roche dominante est citée en premier), avec quelques règles
  prioritaires. 16 608 formations sur 16 941 classées en Haute-Savoie.
- Indice (`mushrooms.ts`) : saison × pluie (délai depuis l'épisode ≥ 15 mm sur 3 jours, en trapèze
  propre à chaque champignon, + humidité sur 20 jours) × température (moyenne 7 jours à l'altitude,
  gel ≤ −1 °C) × arbre hôte × sol (le sol module : 0,4 + 0,6 × préférence). Niveaux : ≥ 0,5 favorable,
  ≥ 0,28 possible, ≥ 0,12 peu probable. Règles de cueilleur, pas un modèle validé : à recaler avec les
  retours de terrain.

## Conventions

- Textes de l'interface et commentaires en français ; identifiants du code en anglais.
- Garder les couleurs officielles IGN pour les forêts ; la géologie est en motifs (pas de couleur)
  pour rester lisible par-dessus.
- DOM construit avec `h()` ; jamais d'`innerHTML` avec des données (seules les icônes SVG statiques).
- `localStorage` toujours dans un try/catch (navigation privée).
- Accessibilité : vrais `<input type="checkbox">`, interrupteurs `role="switch"`, `aria-*` à jour.
- Mobile : légende et bilan en tiroirs bas sous 640 px (un seul ouvert à la fois), boutons de 46 px.
- En développement, `window.map`, `window.store` et `window.spot` sont exposés (console, tests e2e).

## Limites connues

- BD Forêt photo-interprétée de 2007 à 2018 selon les départements : coupes et scolytes récents absents.
- Pas de filtrage des forêts sous le zoom 10 ; sol connu à partir du zoom 10 dans le bilan.
- Géologie : Haute-Savoie et Savoie seulement ; elle donne la tendance du sol, pas le sol exact
  (moraines décalcifiées, placages…).
- Météo : modèles (pas de pluviomètres), cases de 4,5 km ; dans le bilan, températures ramenées à
  l'altitude exacte du point.
- Comptages des forêts sur les tuiles chargées (débordent un peu de l'écran).
- Recherche non biaisée vers la zone affichée.

## Pistes pour la suite

1. Committer le `package-lock.json` créé au premier `npm install` local, puis passer le workflow à `npm ci`.
2. Étendre la géologie à d'autres départements (`DEPARTEMENTS="074 073 001 038"` dans le workflow).
3. Recaler l'indice avec des sorties réelles (journal de cueillette : date, lieu, trouvé ou non).
4. Prévisions : ajouter `forecast_days` pour annoncer les jours favorables à venir.
5. Export GeoJSON/GPX des polygones sélectionnés (WFS + `CQL_FILTER`) pour une appli hors ligne.
6. Sélection dans l'URL (`#carte=…&types=…`) pour partager une vue.
7. Mode hors ligne (PWA + cache de tuiles) pour les zones sans réseau.
8. Exposition des versants (nord/sud) à partir du relief IGN.
