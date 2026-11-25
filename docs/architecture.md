# Architecture, couches et grille

Notes détaillées, sorties telles quelles de `CLAUDE.md` le 16/11/2026 : Claude Code ne les lit qu'à la
demande (index dans `CLAUDE.md`, « Avant de toucher à…, lire »). Un renvoi « voir « Titre » » désigne
une section de ce dossier.

## Architecture (`src/`)

| Fichier | Rôle |
|---|---|
| `main.ts` | Point d'entrée (petit) : feuilles de style, îlot, avertissement, et chaque vue chargée par `import()` à sa première ouverture |
| `view.ts` | Les deux vues : lecture et écriture de `#vue=analytics` dans l'adresse (vue Analytics pour un lien « vitrine » seulement), historique, îlot, annonce aux lecteurs d'écran |
| `mapView.ts` | La vue Carte (chargée à la demande) : protocole `pmtiles://`, carte (France entière puis dernière vue gardée), modules, état → carte, clic → bilan du coin, comptages |
| `analyticsView.ts`, `analytics.css` | La vue Analytics (chargée à la demande, sans rien de la carte) : en-tête, entonnoir (emplacement vide), pari en cours, analyses, paris tranchés, états vides |
| `analyticsData.ts` | **Le** fichier de contenu de la vue Analytics, modifié à la main (guide en tête du fichier) |
| `analyticsTypes.ts`, `analyticsCheck.ts` | Format de ce contenu (types stricts : dates, adresse https) et relecture de ce que les types ne voient pas (date impossible, texte vide, valeur négative) |
| `disclaimer.ts` | Avertissement bloquant (`<dialog>` modal, ni Échap ni clic à côté), moins de 100 mots : bouton actif 3 s après le premier affichage (horloge, pas minuteries ; il attend aussi la fin du texte si la fenêtre défile), mémorisé par version des conditions, 30 jours au plus ; dit si c'est un premier accord |
| `gate.ts` | Fenêtre bloquante à compte à rebours, commune à l'avertissement et au rappel « période de chasse » : `<dialog>` modal que ni Échap ni un clic à côté ne ferment, bouton actif 3 s après l'affichage réel (horloge), retrait sans validation |
| `hunting.ts` | Rappel « période de chasse » (`huntingSeason` : du premier dimanche de septembre au dernier jour de février), bloquant 3 s, montré après l'avertissement et avant la présentation, au plus toutes les 12 heures (`foret-explorer:chasse`) ; rien de mars à août |
| `tour.ts` | « La carte en 3 gestes » : fenêtre libre montrée après un premier accord et depuis la légende, schéma de l'écran dessiné en HTML/CSS (grand écran et téléphone) ; chargé avec l'entrée, n'importe rien de la carte |
| `legal.ts` | Version des conditions (`TERMS_VERSION`), jour de la refonte (`TOUR_SINCE`), lien « vitrine » (`SHOWCASE` : `?analytics` dans l'adresse), adresse de « À propos » (qui garde ce mot), données gardées dans le navigateur, effacement |
| `apropos.ts`, `apropos.css` | Page `a-propos.html` (conseils, règles, conditions, mentions légales, confidentialité) : état de la mesure, « Effacer mes données » |
| `zones.ts` | Zones protégées et forêt publique sous un point, hachures, `info.json` (sans lui : statut inconnu) |
| `config.ts` | URLs des services, archives de tuiles (`archiveTiles`, zooms de `GEOLOGY` et `ZONES`), emprise de la France (`FRANCE_BOUNDS` : données et première vue), réglages de la météo, clé localStorage |
| `forestClasses.ts` | Nomenclature : 32 codes `code_tfv`, libellés, couleurs officielles, groupes, préréglages |
| `mapStyle.ts` | Style MapLibre (sources + couches), expressions couleur/filtre/motif, fonctions `apply*()` |
| `state.ts` | Store observable (sélection, opacité, fond, champignon, météo, sol) + persistance localStorage |
| `legend.ts` | Panneau « Légendes » : forêts (cases, groupes, préréglages, comptages), opacité, fond |
| `legendExtras.ts` | Sections « Je cherche… » (fiche, lien MycoDB), « Météo », « Nature du sol », « Droit de cueillir » |
| `ui.ts` | Section repliable (chevron = bouton, titre cliquable aussi), interrupteur, titre avec icône (partagés par les panneaux) |
| `mushrooms.ts` | Profils des 5 champignons (hôtes, sols, saison, températures, délai après pluie, précautions, fiche MycoDB) et indice (raisons, ce qui l'annule) |
| `fineRule.ts` | La règle des carrés de 500 m, sans rien de la carte ni du navigateur : points relevés, carrés à dessiner (`fineCellsToDraw`, règle de ville), ce que valent les arbres et le sol d'un carré (`fineFactors`) ; la même règle appliquée à un carré de 4,5 km (`surveySquare`) ; empreinte des règles (`rulesSignature`) |
| `partsBuild.ts` | Ce que `scripts/foret/parts.mjs` lit du code de la carte (Vite en fait une version pour Node) ; le site ne le charge pas |
| `forestShare.ts` | Ce que chaque carré de 4,5 km contient pour chaque champignon, lu dans `public/foret/parts.json` : part de ses carrés de 500 m à dessiner, ce que vaut le meilleur (arbres hôtes × sol), part bâtie ; règle d'allumage d'un carré (`isLit`) |
| `soils.ts` | 8 natures de sol, champignons associés, motifs dessinés au canevas |
| `geology.ts` | Motifs fournis à MapLibre (`styleimagemissing`), forêt et sol sous un point |
| `meteoGrid.ts` | Grille météo commune (cases de 0,16° × 0,224°, blocs de 8 × 8, 16 carrés de 4,5 km par case : `subBox`, `subIndexAt`), format des fichiers, dates ; lu aussi par Node (scripts) : aucun import |
| `weather.ts` | Fichiers météo communs (index, blocs), résumé de 30 jours daté (épisodes de pluie, gel, `rain20` pour l'humidité, jour estimé), `atAltitude`, `summaryAtAltitude`, Open-Meteo en secours (cache du jour), altitude IGN |
| `meteoLayer.ts` | Grille météo sur la vue, à tous les zooms (toute la France d'un coup en vue d'ensemble) : pluie cumulée ou indice du champignon choisi : cases de 18 km et pastilles sous le zoom 10, carrés de 4,5 km à partir du zoom 10, allumés à la mesure de leurs arbres hôtes, hors des villes ; carrés fins en mode indice ; rien pour un champignon hors saison. Règles de fluidité en tête de classe |
| `fineGrid.ts` | Carrés de 500 m : découpage, relevé forêt/sol (index spatial sur `queryRenderedFeatures` ; forêts du zoom 11 à tous les zooms, `surveyForest`), gardé d'une visite à l'autre (`foret-explorer:releves`), altitudes en cache permanent, choix des carrés à dessiner (`fineCellsToDraw` : plus sévère en ville), indice par carré |
| `metrics.ts` | Compteurs de consommation des API (en mémoire) et envoi groupé au serveur de mesure |
| `metricsSchema.ts` | Liste des compteurs, partagée avec `worker/` (un compteur absent est refusé par le serveur) |
| `spot.ts` | Bilan d'un coin au clic, la réponse d'abord : zone protégée, terrain (forêt, sol, altitude, statut), une ligne par champignon, bouton « ? », pluie, règles repliées |
| `search.ts` | Recherche de lieu (autocomplétion de la Géoplateforme) |
| `toolbar.ts` | Boutons : légende, fond de carte, géolocalisation, plein écran, zoom |
| `chooseHint.ts` | Bandeau « Choisissez un champignon » (`#choose-hint`), avec les puces, tant qu'aucun n'est choisi ; il a remplacé « Zoomez pour filtrer les types de forêt » |
| `franceStats.ts` | Moyenne de France par champignon (chiffre des puces) : le calcul, lancé à la publication par `scripts/meteo/france.mjs`, et la lecture de `data/meteo/france.json` par la carte |
| `gridLoader.ts` | Calcul des carrés en cours : champignon qui tourne au milieu de la carte (`#grid-loader`) et zoom en pause, pilotés par `MeteoLayer.onBusy` ; puis, si la vue n'a rien à 50 % ou plus, le bandeau « risque de chou blanc » (`#grid-verdict`, `MeteoLayer.onVerdict`) |
| `counts.ts` | Nombre de polygones par type dans les tuiles affichées |
| `dom.ts`, `icons.ts` | Utilitaires DOM (`h()`, `toast()`…), icônes SVG |

`scripts/geologie/` : `construire.sh` (téléchargement BRGM → GeoJSONSeq WGS84 → classement → archive
PMTiles), `regles.mjs` (règles de classement des descriptions géologiques en natures de sol),
`classer.mjs` (avec `TABLE_DESCR=fichier.tsv` : table de toutes les descriptions), `info.mjs` (écrit
`info.json` : provenance, départements, emprise et zooms lus dans l'en-tête de l'archive, surfaces par sol).
`scripts/meteo/` : `mettre-a-jour.mjs` (fichiers météo communs, voir « Météo commune »), `cases.mjs`
(liste des cases qui touchent la France, d'après ADMIN EXPRESS, et altitude IGN de leurs carrés de
4,5 km), `cases-france.json` (versionné), `france.mjs` (moyennes de France par champignon →
`data/meteo/france.json`, à chaque publication : il fabrique avec Vite une version de
`src/franceStats.ts` lisible par Node, dans `.cache/france/`, et l'appelle).
`scripts/foret/` : `parts.mjs` (pour chaque carré de 4,5 km et chaque champignon, ce que la carte y
dessinerait en carrés de 500 m, et la part bâtie → `public/foret/parts.json`, versionné ; il applique
la règle de `src/fineRule.ts`, que Vite lui fabrique pour Node dans `.cache/parts/`), `releve.mjs`
(forêts et sols relevés sur le treillis des points des carrés de 500 m, dans l'ordre où la carte lit
les polygones), `mvt.mjs` (lecteur de tuiles vectorielles sans dépendance), `geometrie.mjs` (aires,
découpage d'un anneau par un rectangle, tuiles XYZ).
`scripts/zones/` : `telecharger.mjs` (WFS → GeoJSONSeq Lambert-93, noms nettoyés, `resume.json` ; les
parcelles du Conservatoire du littoral à part, `conservatoire.geojsonl`), `construire.sh` (GPKG simplifié
à 5 m, parcelles du Conservatoire fusionnées par site et par type → archive PMTiles, couches
`protection`, `protection_nom` (un point par zone, pour n'afficher son nom qu'une fois : les sites des
conservatoires sont faits de dizaines de parcelles) et `foret_publique`, `info.json`).

Flux : l'interface ne touche jamais la carte. Elle appelle `store.update()` ; `mapView.ts` est abonné au
store et appelle `applySelection` / `applyOpacity` / `applyBasemap` / `applyGeology` /
`meteo.applyMode()`. Pour ajouter une option : champ dans `AppState` (+ persistance dans `state.ts`),
contrôle dans `legend.ts` ou `legendExtras.ts`, effet dans `mapStyle.ts`, abonnement dans `mapView.ts`,
vérification dans `tests/e2e/run.mjs`.

Couches (ordre) : `base-plan`, `base-ortho`, `bdforet-overview` (raster, zoom < 10), `bdforet-fill`
(filtrée), `bdforet-hit` (invisible, non filtrée : forêt sous un clic), `bdforet-releve` (invisible,
mode indice, zoom ≥ 12 : les forêts du zoom 11, pour le relevé des carrés de 500 m), `geologie-motifs`,
`geologie-hit` (invisible : sol sous un clic), `bdforet-outline`, `zones-protegees` (hachures),
`forets-publiques` (tirets, sur demande), `zones-protegees-hit`, `forets-publiques-hit` (invisibles :
statut sous un clic, zoom ≥ 10), `meteo-cellules`, `meteo-contours`, `meteo-fin-cellules`,
`meteo-fin-contours` (carrés de 500 m, zoom ≥ 11, mode indice), `meteo-etiquettes`,
`meteo-fin-etiquettes`, `zones-protegees-contours`, `zones-protegees-etiquettes` (au-dessus de
l'indice), `bdforet-highlight-casing`, `bdforet-highlight`.

Carrés de 4,5 km (`meteoLayer.ts`, zoom ≥ `WEATHER_SUB_MIN_ZOOM` = 10, mode indice) : chaque case
commune est dessinée en 16 carrés (id « I:J/k », propriété `sub` = 1), même pluie, températures
ramenées à l'altitude de chaque carré (`a` dans les fichiers, `summaryAtAltitude`) ; un carré sans
terre française n'est pas dessiné. En deçà du zoom 10, et en mode pluie, cases entières (`sub` = 0 ;
indice : voir « Pastilles »), sans quadrillage en mode indice (`setLayerZoomRange`). Seuls
les carrés (`sub` = 1) portent une étiquette, dès leur arrivée au zoom 10 (une expression de zoom
dans une propriété `layout` n'est évaluée qu'aux zooms entiers : garder un seuil entier) ; une case
entière encore dans la source au passage du zoom 10 n'affiche donc rien. Avant le 14/11/2026 les
carrés arrivaient au zoom 8 (demande de Clément : à l'échelle 20 km leur couleur ne se lit pas ; ils
font 17 à 26 pixels de large quand la règle affiche 20 km). La règle d'échelle (120 px au plus)
affiche 30 km du zoom 7,0 à 7,8, 20 km jusqu'à 8,35, 10 km jusqu'à 9,35, 5 km jusqu'à 10,35 (à 46°
de latitude) : entre 9,35 et 10 elle dit déjà 5 km et les cases restent de 18 km, écart assumé pour
n'avoir qu'un seuil (carrés, étiquettes et forêts détaillées arrivent ensemble).

Pastilles (`meteo-points`, zoom < 10, mode indice ; `showHotspots`, `pickHotspots`, `bestSquare`) :
**une par case où la chance estimée atteint `HOTSPOT_MIN_CHANCE`** (70 %, le niveau « favorable » ;
50 % avant le 14/11/2026), sans plafond. Avant le 15/11/2026 il y en avait 12 au plus, espacées d'un
septième de la vue : en vue France, 6 des 75 secteurs à 70 % ou plus étaient marqués pour les cèpes
(181 pour les trompettes, 125 pour les chanterelles en tube ; retour de Clément : « les grosses
moyennes cachent des 70 % »). Deux tailles : les plus fortes de la vue, espacées, 12 au plus
(`pickHotspots`, propriété `big`), grandes et chiffrées à tous les zooms ; les autres petites en vue
large (rayon de 4,5 px au zoom 5, où une case de 18 km fait 10 px à l'écran ; 9 px avec leur chiffre
sans « % » au zoom 6), toutes grandes à partir du zoom 7 (`mapStyle.ts`). Les pastilles sont toutes
dessinées, les plus fortes par-dessus ; deux chiffres qui se touchent : celui de la plus forte se
lit. Une pastille par case, posée sur son meilleur carré, pas une par carré de 4,5 km (ce serait
redessiner les carrés que le zoom 10 montre). Leur chiffre est celui du **meilleur carré
de 4,5 km allumé de la case** (à son altitude, pour ses arbres hôtes), où elles sont posées : celui
que son étiquette affichera au zoom 10 (un test compare les deux). **La teinte de la case (`l`, `p`)
est celle de ce même carré** : calculée pour la case entière, à son altitude médiane (Annecy : 447 à
2 351 m dans une case), elle pâlissait là où une vallée est favorable, ou fonçait là où aucun carré
boisé ne l'est. Les seize carrés sont calculés par `squareScore` (part commune à la case
`weatherCeiling` = saison × pluie, × température à l'altitude du carré `temperaturesAt`, × qualité
des hôtes) : mêmes facteurs et même ordre que `scoreMushroom`, donc le même indice au dernier chiffre
(un test le vérifie sur 360 cas), sans phrases ni copie des trente jours. En mode pluie, en secours
(pas d'altitudes de carrés) ou sans le fichier des parts, la case reste calculée d'un bloc, à son
altitude médiane. « Meilleure chance estimée dans la vue » (légende) lit les mêmes candidats, au
seuil de 50 % (`CHANCE_THRESHOLD`), et précise « (pastilles à partir de 70 %) » quand aucune n'est
posée ; à partir du zoom 10 elle ne regarde que les carrés dont une partie est à l'écran, et la
source des pastilles est vidée une fois pour toutes.

**Une seule règle pour toutes les échelles** (`fineRule.ts`, `forestShare.ts`,
`public/foret/parts.json`, mode indice ; 25/11/2026). Retours de Clément : « sur certaines forêts où
il y a pourtant 70 % de chance […] si je dézoome d'un cran j'ai plus rien », puis : « corriger ça
partout, pas juste un pansement ». Les carrés de 500 m suivent une règle de points (`fineCellsToDraw` :
trois des neuf points relevés sous un arbre hôte ; en ville, cinq, et deux voisins boisés). Les carrés
de 4,5 km en suivaient une autre, de surface : allumés à 10 % d'arbres hôtes et moins de 15 % de bâti,
au pourcentage de leur meilleure forêt (2 % du carré au moins), sans le sol. Mesuré au sud-ouest
d'Amiens, chanterelles en tube : sept carrés de 500 m dessinés de 48 à 78 %, dans des carrés de
4,5 km où les hôtes couvrent 0 à 5 % de la surface, donc tous éteints, sous un bandeau « risque de
chou blanc ». Aucun seuil de surface ne règle cela : un bois de 8 ha suffit à un carré de 500 m, soit
0,4 % d'un carré de 4,5 km (et l'ancien fichier arrondissait au pour cent).
- **La règle des carrés de 500 m est appliquée une fois à toute la France** par
  `scripts/foret/parts.mjs` (`surveySquare` de `fineRule.ts` : les fonctions mêmes de la carte). Pour
  chaque carré de 4,5 km et chaque champignon, le fichier donne le nombre de ses carrés de 500 m à
  dessiner (0 à 81) et ce que vaut le meilleur, arbres hôtes × sol (millièmes, arrondi au-dessus).
  Un carré de 4,5 km est **allumé dès qu'il en a un** (`isLit`), d'autant plus soutenu qu'il en a
  (`c` : leur part ; `HOST_MIN_TINT` pour un seul, pleine teinte à `HOST_FULL_COVER`, 70 %, soit les
  50 % de surface d'avant), et **son pourcentage est celui de son meilleur carré de 500 m**, sol
  compris (`HostCover.quality` × la météo à l'altitude du carré de 4,5 km, `squareScore`). Les villes
  n'ont plus de règle à part à cette échelle : celle des carrés de 500 m est dans le compte (Paris
  intra-muros : 0 carré ; forêt de Fontainebleau : 77 sur 81).
- **Tout ce qui est plus large suit**, sans autre règle : étiquette et teinte du carré de 4,5 km, case
  de 18 km et pastille (son meilleur carré), « meilleure chance de la vue », bandeau « risque de chou
  blanc » et sa proposition, moyenne de France des puces, bilan d'un coin dont la forêt est inconnue
  (« chance du meilleur coin du secteur (arbres hôtes et sol) » ; le sol du point touché n'y est pas
  compté une seconde fois ; carré éteint : « peu d'arbres hôtes dans ce secteur », ou « secteur
  urbanisé » s'il est bâti à 15 % ou plus).
- **Mêmes forêts dans la carte et dans le calcul.** L'IGN simplifie ses tuiles à chaque zoom, et le
  relevé de la carte lisait celles du zoom affiché : un carré de 500 m changeait un peu selon le zoom
  où on l'avait vu en premier (entre les zooms 10 et 11, près d'Amiens : 3 carrés de 4,5 km sur 15
  différaient, de 2 points ou d'un carré de 500 m). Il lit maintenant toujours les forêts du zoom 11
  (`SURVEY_TILE_ZOOM`, `surveyForest` : `bdforet-hit` jusqu'au zoom 12, puis `bdforet-releve`, copie
  invisible dont la source s'arrête au zoom 11), et le script lit ces tuiles-là. Les sols sont déjà
  ceux du zoom 11, le dernier de l'archive. `SURVEY_VERSION` est passée à 2.
- **Lus de la même façon, au point près** (`scripts/foret/releve.mjs`, `CellIndex` de `fineGrid.ts`).
  Quatre détails séparaient encore les deux relevés ; chacun a été trouvé en comparant point par
  point : (1) là où deux polygones voisins se recouvrent d'un liseré, la carte garde le premier que
  rend MapLibre, soit le dernier objet de la tuile la plus au nord, puis la plus à l'ouest
  (`ordreDeTrace`) ; (2) MapLibre ne rend pas un objet qui tient tout entier dans la marge d'une
  tuile ; (3) au bord des tuiles, l'IGN note parfois un petit morceau de forêt dans le sens d'un trou,
  hors de son contour : la carte ne rangeait un polygone que d'après son contour et le manquait ; (4)
  la carte plaçait ses points d'après les bords du carré arrondis au millionième de degré (5 cm), de
  quoi faire basculer un point posé sur une lisière. Écarts avant ces corrections : 6 points sur
  18 468 dans les Landes ; après : 0 point sur 52 542 (Jura, Landes, Vosges).
- **Tuiles vides à tort** : pendant le téléchargement en rafale des 3 556 tuiles, le service de l'IGN
  en a rendu 12 « vides » alors qu'elles sont pleines (24 carrés boisés à 40 % en ressortaient sans
  un carré de 500 m). Une tuile vide n'est crue que si sa tuile mère du zoom 10 n'a pas de forêt à
  cet endroit, sinon elle est redemandée (`tuileForet`) ; et le script signale tout carré qui avait
  quelque chose à dessiner dans le fichier précédent et n'a plus rien.
- **Vérifié sur la vraie carte** le 25/11/2026 (données réelles, 1280 × 800 : carrés de 4,5 km
  dessinés au zoom 10,5 comparés au relevé de la carte au zoom 11,3) : voir « Mesures » plus bas.
- **Fichier** (`v: 2`) : `champignons` (ordre des paires), `fin` (par case commune, 16 carrés :
  `[nombre, meilleur en millièmes, …]` par champignon, `0` : rien à dessiner pour aucun, `null` : pas
  de terre française), `bati` (part bâtie en %, zones bâties et d'activité du Plan IGN : 2 067
  carrés à 15 % ou plus), `regles` (empreinte de ce dont le résultat dépend : arbres hôtes et sols de
  chaque champignon, seuils des carrés de 500 m ; `rulesSignature`). 1 097 ko, 320 ko compressé
  (993 et 249 avant). Chargé dans tous les modes ; un échec de réseau se retente au plus toutes les
  30 secondes, un fichier d'un autre format jamais (la grille se dessine alors sans regarder la
  forêt, `c` = −1, et la légende le dit).
- **À refaire** (`node scripts/foret/parts.mjs`, une minute tuiles en cache) quand changent les
  arbres hôtes ou les sols d'un champignon (`mushrooms.ts`), les seuils des carrés de 500 m
  (`config.ts`), les règles des sols (`scripts/geologie/`), la grille ou la BD Forêt.
  `npm run test:france` échoue tant que l'empreinte du fichier n'est pas celle du code, et vérifie la
  règle elle-même : sur un carré d'essai, pour chaque champignon de saison, quatre météos et trois
  altitudes, le carré de 4,5 km annonce la chance estimée de son meilleur carré de 500 m (jamais
  moins, un point de plus au plus).
- **Ce que porte un carré envoyé à la carte** : les valeurs du champignon montré seulement, sous des
  noms fixes (`l` niveau, `p` chance estimée, `c` part de carrés de 500 m à dessiner, jamais zéro
  pour un carré allumé ; −1 si le fichier manque). Un carré éteint n'est pas envoyé, un carré
  défavorable (moins de 35 %) non plus (voir « Sans carré ») : ni teinte, ni quadrillage, ni
  étiquette, ni pastille. Les cases du mode pluie n'en portent aucune. Case entière (zoom < 10) :
  allumée dès qu'un de ses carrés l'est, teinte selon la moyenne de leurs `c`. Aux zooms des carrés de
  500 m, la grille reste en fond sans étiquette dès que le relevé fin est fait (`fineDone`), même
  s'il n'a trouvé aucun arbre hôte.
- **Tests** : les identifiants de texte des cases (« I:J/k ») ne survivent pas aux tuiles de
  MapLibre, un carré s'y reconnaît à son centre (`x`, `y`). Le fichier est simulé dans les tests e2e
  (`forestShare()` de `mocks.mjs` : une hêtraie partout, un carré sans arbre, un carré avec un seul
  bois, un carré de peupliers, une ville sans massif). La police des étiquettes y est vide : on
  évalue les expressions de MapLibre carré par carré
  (`map.style.getLayer(…).paint.get(…).evaluate(…)`). Le mois est figé en octobre dans les tests de
  bureau. Les forêts simulées changent d'un zoom à l'autre : à partir du zoom 12, le relevé (zoom 11)
  n'y voit pas les forêts affichées.

**Mesures du 25/11/2026** (météo du 24/11, France entière, `mesure.mjs` : ancien code et son fichier,
puis nouveau) :

| Champignon | Carrés de 4,5 km allumés | à 50 % ou plus | à 70 % ou plus | Cases à pastille | Moyenne de France |
|---|---|---|---|---|---|
| Cèpes | 20 025 → 27 514 | 12 512 → 15 678 | 6 327 → 6 718 | 792 → 765 | 49 → 47 % |
| Girolles | 19 566 → 27 380 | 5 103 → 5 877 | 232 → 78 | 67 → 35 | 33 → 31 % |
| Trompettes | 19 034 → 27 068 | 14 469 → 18 874 | 9 224 → 8 083 | 953 → 858 | 62 → 57 % |
| Chanterelles en tube | 6 622 → 15 813 | 5 915 → 13 693 | 5 174 → 9 579 | 793 → 1 302 | 76 → 68 % |

Aucun carré allumé avant ne s'éteint. Parmi les carrés nouvellement allumés, ceux à 70 % ou plus,
donc invisibles avant sans zoomer : 1 682 pour les cèpes, 6 pour les girolles, 1 499 pour les
trompettes, 4 660 pour les chanterelles en tube. Un carré de 4,5 km sur vingt-cinq n'a qu'un seul
carré de 500 m à dessiner (1 038 pour les cèpes, 2 763 pour les chanterelles en tube). Le sol, compté
désormais, baisse environ un carré sur deux de ceux qui étaient allumés (en moyenne de 2 à 4 points,
24 à 28 au plus).

Sur la vraie carte, en dix lieux (sud-ouest d'Amiens, Annecy, Landes, Fontainebleau, Paris, Vosges,
Bourges, Bretagne, Corrèze, Jura) et pour trois champignons : 453 carrés de 4,5 km entiers dans la
vue, dont le fichier annonce chaque fois le nombre exact de carrés de 500 m que la carte s'apprête à
dessiner, et le pourcentage de son meilleur carré de 500 m dessiné (453 sur 453 ; avant la
correction, près d'Amiens : 0 sur 11 parmi les carrés qui ont un bois, tous éteints).

Avant (pour mémoire) : le 14/11/2026, cases et carrés ne regardaient que la météo (Paris affichait
« 78 % · favorable ») ; seuil d'allumage à 5 % d'arbres hôtes, relevé à 10 % avec la règle des 15 %
de bâti (à 5 % et sans le bâti, 85 % des carrés de France s'allumaient pour les cèpes, toutes les
villes comprises). Le 15/11/2026, « meilleure forêt du carré » : le pourcentage du carré était celui
de son meilleur hôte présent sur 2 % du carré au moins, au lieu de la moyenne de ses hôtes (retour de
Clément : « on voit bien des 70 et plus [en zoomant] et pourtant aucune pastille »).
