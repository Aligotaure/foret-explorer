# Forêt Explorer — notes pour Claude Code

Carte web des types de forêt de la **BD Forêt® V2** (IGN) avec une légende à cases à cocher pour
choisir les types affichés. Interface inspirée du panneau « Légendes » de cartes.gouv.fr (thème sombre
bleu nuit, icônes lavande, légende sur carte blanche).

Usage visé : repérer les forêts favorables aux champignons (cèpes, girolles, trompettes…) autour
d'Annecy, donc surtout chênaies, hêtraies, châtaigneraies et sapinières. La carte sert aussi sur
téléphone, en forêt : le mobile compte autant que le bureau.

En ligne : https://aligotaure.github.io/foret-explorer/ (GitHub Pages, republié à chaque push sur
`main` par `.github/workflows/deploy.yml`, qui lance `npm run check` puis publie `dist/`).

## Commandes

- `npm install` puis `npm run dev` : serveur Vite sur http://localhost:5173
- `npm run typecheck` : TypeScript strict, sans émission
- `npm run build` : build statique dans `dist/` ; `npm run check` = typecheck + build
- `npm run test:e2e` : test de bout en bout (Playwright + vrai MapLibre, services IGN simulés,
  35 vérifications). Première fois : `npx playwright install chromium`. Captures dans `tests/e2e/shots/`.

Après chaque modification : `npm run check` puis `npm run test:e2e`.

## Pile

Vite + TypeScript strict + MapLibre GL JS 5, sans framework. Pas de nouvelle dépendance sans raison.

## Architecture (`src/`)

| Fichier | Rôle |
|---|---|
| `main.ts` | Point d'entrée : crée la carte, branche les modules, état → carte, clic → bulle, comptages |
| `config.ts` | URLs des services IGN, zooms, vue initiale, clé localStorage |
| `forestClasses.ts` | Nomenclature : 32 codes `code_tfv`, libellés, couleurs officielles, groupes, préréglages |
| `mapStyle.ts` | Style MapLibre (sources + couches), expressions de couleur et de filtre, fonctions `apply*()` |
| `state.ts` | Store observable (sélection, opacité, fond, options) + persistance localStorage |
| `legend.ts` | Panneau « Légendes » : cases, groupes, préréglages, comptages, opacité, fond de carte |
| `search.ts` | Recherche de lieu (autocomplétion de la Géoplateforme) |
| `toolbar.ts` | Boutons : légende, fond de carte, géolocalisation, plein écran, zoom |
| `popup.ts` | Contenu de la bulle au clic sur un polygone |
| `counts.ts` | Nombre de polygones par type dans les tuiles affichées |
| `dom.ts`, `icons.ts` | Utilitaires DOM (`h()`, `toast()`…), icônes SVG |

Flux : l'interface ne touche jamais la carte. Elle appelle `store.update()` ; `main.ts` est abonné au
store et appelle `applySelection` / `applyOpacity` / `applyBasemap`. Pour ajouter une option : champ
dans `AppState` (+ persistance dans `state.ts`), contrôle dans `legend.ts`, effet dans `mapStyle.ts`,
abonnement dans `main.ts`, vérification dans `tests/e2e/run.mjs`.

Couches de la carte (ordre) : `base-plan`, `base-ortho`, `bdforet-overview` (raster, zoom < 10),
`bdforet-fill` (polygones filtrés), `bdforet-outline` (zoom ≥ 12), `bdforet-highlight-casing`,
`bdforet-highlight`.

## Données et API (Géoplateforme IGN : sans clé, Licence Ouverte Etalab 2.0)

Vérifié le 31/10/2026 :

- **Tuiles vectorielles BD Forêt V2** :
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
- **WMTS** `https://data.geopf.fr/wmts` : `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` (TileMatrixSet `PM`, png),
  `ORTHOIMAGERY.ORTHOPHOTOS` (`PM`, jpeg), `LANDCOVER.FORESTINVENTORY.V2` (`PM_6_16`, png : rendu
  officiel non filtrable, affiché sous le zoom 10). Tuiles raster de 256 px : MapLibre charge le niveau z+1.
- **Autocomplétion** :
  `https://data.geopf.fr/geocodage/completion?text=…&type=StreetAddress,PositionOfInterest&maximumResponses=6`
  → `{ results: [{ x: lon, y: lat, fulltext, country, kind, poiType[] }] }`.
  Variante GeoJSON : `/geocodage/search?q=…&index=address,poi`.
- **WFS** (pas encore utilisé, utile pour un export) : `https://data.geopf.fr/wfs`,
  `TYPENAMES=LANDCOVER.FORESTINVENTORY.V2:formation_vegetale`, `OUTPUTFORMAT=application/json`.
  `CQL_FILTER` (ex. `code_tfv='FF1G01-01'`) et `PROPERTYNAME` fonctionnent. Avec GeoServer, `BBOX=` et
  `CQL_FILTER=` ne se combinent pas : mettre la boîte dans le CQL. En `urn:ogc:def:crs:EPSG::4326`,
  l'ordre des axes est lat,lon.

## Nomenclature

Les 32 codes sont dans `forestClasses.ts`. Toujours filtrer sur `code_tfv`, jamais sur `tfv` : les
libellés des données ont des variantes (« dun autre pin pur », apostrophes droites ou typographiques).

- Chênes : `FF1G01-01` (chênes décidus purs), `FF1G06-06` (chênes sempervirents purs, méditerranéens).
- Forêt fermée : couvert des arbres ≥ 40 % ; ouverte : 10 à 40 %. « Pur » : une essence ≥ 75 % du couvert.
- « Purs en îlots » (`FF1-00`, `FF2-00`) : peuplements purs trop petits pour que l'essence soit précisée.
- Les mélanges (`FF1-00-00`, `FF31`, `FF32`…) contiennent souvent des chênes sans le dire.

## Conventions

- Textes de l'interface et commentaires en français ; identifiants du code en anglais.
- Garder les couleurs officielles IGN (cohérence avec cartes.gouv.fr et le raster d'aperçu).
- DOM construit avec `h()` ; jamais d'`innerHTML` avec des données (seules les icônes SVG statiques).
- `localStorage` toujours dans un try/catch (navigation privée).
- Accessibilité : vrais `<input type="checkbox">`, attributs `aria-*` à jour, recherche au clavier.
- Mobile : légende en tiroir bas sous 640 px, boutons de 46 px, attribution repliée.
- En développement, `window.map` et `window.store` sont exposés (console du navigateur, tests e2e).

## Limites connues

- Photo-interprétation de 2007 à 2018 selon les départements : coupes, tempêtes et scolytes récents absents.
- Pas de filtrage sous le zoom 10 (pas de tuiles vectorielles) : le raster officiel prend le relais.
- Les comptages portent sur les tuiles chargées, qui débordent un peu de l'écran (approximation).
- La recherche n'est pas biaisée vers la zone affichée (« Parmel » propose aussi la Marne).

## Pistes pour la suite

1. Committer le `package-lock.json` créé au premier `npm install` local (le dépôt n'en a pas encore ;
   le workflow fait un `npm install` simple), puis passer le workflow à `npm ci`.
2. Export GeoJSON/GPX des polygones sélectionnés dans la vue (WFS + `CQL_FILTER`) pour une appli
   de randonnée hors ligne.
3. Sélection dans l'URL (`#carte=…&types=…`) pour partager une vue.
4. Couches utiles à la cueillette : relief et courbes de niveau, géologie BRGM (WMS), exposition.
5. Préréglages « champignons » (ex. cèpes : chênes, hêtre, châtaignier, sapin-épicéa, mélanges),
   à valider avec l'utilisateur.
6. Mode hors ligne (PWA + cache de tuiles) pour les zones sans réseau.
7. Surface (ha) par type dans la vue plutôt qu'un nombre de polygones.
8. Recherche biaisée vers le centre de la carte.
