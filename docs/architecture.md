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
| `forestShare.ts` | Arbres hôtes et part bâtie de chaque carré de 4,5 km, lus dans `public/foret/parts.json` : part de surface et qualité de la meilleure forêt hôte par champignon, et la règle d'allumage d'un carré (`isLit`) |
| `cuts.ts` | Coupes et dégâts datés par satellite, par carré de 500 m : fichiers de `public/data/coupes/` (index, blocs de la vue), points touchés d'un carré (`cutPointsOf`, `cutPointsAt`), part en mots (`shareWords`) ; absents : la carte fait sans |
| `soils.ts` | 8 natures de sol, champignons associés, motifs dessinés au canevas |
| `geology.ts` | Motifs fournis à MapLibre (`styleimagemissing`), forêt et sol sous un point |
| `meteoGrid.ts` | Grille météo commune (cases de 0,16° × 0,224°, blocs de 8 × 8, 16 carrés de 4,5 km par case : `subBox`, `subIndexAt`), format des fichiers, dates ; lu aussi par Node (scripts) : aucun import |
| `weather.ts` | Fichiers météo communs (index, blocs), résumé de 30 jours daté (épisodes de pluie, gel, `rain20` pour l'humidité, jour estimé), `atAltitude`, `summaryAtAltitude`, Open-Meteo en secours (cache du jour), altitude IGN |
| `meteoLayer.ts` | Grille météo sur la vue, à tous les zooms (toute la France d'un coup en vue d'ensemble) : pluie cumulée ou indice du champignon choisi : cases de 18 km et pastilles sous le zoom 10, carrés de 4,5 km à partir du zoom 10, allumés à la mesure de leurs arbres hôtes, hors des villes ; carrés fins en mode indice ; rien pour un champignon hors saison. Règles de fluidité en tête de classe |
| `fineGrid.ts` | Carrés de 500 m : découpage, relevé forêt/sol (index spatial sur `queryRenderedFeatures`), gardé d'une visite à l'autre (`foret-explorer:releves`), altitudes en cache permanent, choix des carrés à dessiner (`fineCellsToDraw` : plus sévère en ville), indice par carré |
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
`scripts/foret/` : `parts.mjs` (parts de forêt par carré de 4,5 km → `public/foret/parts.json`,
versionné), `mvt.mjs` (lecteur de tuiles vectorielles sans dépendance), `geometrie.mjs` (aires,
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
(filtrée), `bdforet-hit` (invisible, non filtrée : forêt sous un clic), `geologie-motifs`,
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

Arbres hôtes (`forestShare.ts`, `public/foret/parts.json`, mode indice) : avant le 14/11/2026, cases
et carrés ne regardaient que la météo (Paris affichait « 78 % · favorable », le bilan au même point
« ≈ 0 % »). Désormais un carré n'est coloré (`isLit`) que si les arbres hôtes du champignon y couvrent
au moins `HOST_MIN_COVER` (10 %) de la surface et si moins de `BUILT_MAX_COVER` (15 %) est bâti, et
d'autant plus qu'ils en couvrent (teinte pleine à `HOST_FULL_COVER`, 50 %) ; son indice est multiplié
par la qualité de sa meilleure forêt hôte (voir « Meilleure forêt du carré » ci-dessous ; pas par le
sol, inconnu à cette échelle : le bilan, qui regarde la forêt et le sol du point, peut différer dans
les deux sens). Seuils du 14/11/2026 : à 5 % d'hôtes
et sans regarder le bâti, 85 % des carrés de France s'allumaient pour les cèpes (25 154 sur 29 483),
dont 1 624 bâtis à 15 % ou plus : toutes les villes étaient colorées (Nancy : 80 à 84 % sur le
centre). Avec 10 % et 15 % : 20 025 carrés (68 %). Les parts s'additionnent en pour cent entiers
(`forestShare.ts`) : 0,07 + 0,01 + 0,01 + 0,01 fait 0,0999… et laisserait éteints 450 carrés à 10 % pile. Un carré éteint n'est pas envoyé à la carte, un carré défavorable (moins de 35 %) non plus (voir « Sans carré ») : ni
teinte, ni quadrillage, ni étiquette, ni pastille. Propriétés d'un carré : celles du champignon
montré seulement, sous des noms fixes (`l` niveau, `p` chance estimée, `c` part d'hôtes de 0 à 1 ;
`c` = −1 si le fichier manque : la grille se dessine alors comme avant et la légende le dit). Les
cases du mode pluie n'en portent aucune. Case entière (zoom < 10) :
moyenne de ses carrés (pastille : voir ci-dessus). Aux zooms des carrés de 500 m, la grille des
cases reste en fond sans étiquette dès que le relevé fin est fait (`fineDone`), même s'il n'a trouvé
aucun arbre hôte. Fichier : par case commune, 16 carrés `[rang du code, part en %, …]` (null : pas de
terre française) dans `cases`, et leur part bâtie en % dans `bati` (champ ajouté le 14/11/2026, même
format `v: 1` : un fichier sans lui se lit encore, rien n'est alors tenu pour bâti) ; 993 ko, 236 ko
compressé ; aux limites de départements des polygones de la BD Forêt se recouvrent (99 carrés ramenés
à 100 %). Part bâtie : zones bâties et zones d'activité du Plan IGN (voir « Données et API ») ;
3 544 carrés bâtis à 10 % ou plus, 2 067 à 15 %, 1 025 à 25 %, 303 à 50 %, 8 397 à 0 %. Les identifiants de texte des cases (« I:J/k ») ne
survivent pas aux tuiles de MapLibre : dans les tests, un carré se reconnaît à son centre (`x`, `y`).
Simulé dans les tests e2e (`forestShare()` de `mocks.mjs`). Le fichier est chargé dans tous les modes ; un échec
de réseau se retente au plus toutes les 30 secondes, un fichier d'un autre format jamais. Une case
entière est allumée dès qu'un de ses carrés l'est (sa teinte suit la moyenne). La police des
étiquettes est vide dans les tests : aucune étiquette n'y est dessinée, on y évalue donc les
expressions de MapLibre carré par carré (`map.style.getLayer(…).paint.get(…).evaluate(…)`). Le mois
est figé en octobre dans les tests de bureau (saison des champignons).

**Meilleure forêt du carré** (15/11/2026, retour de Clément : « on voit bien des 70 et plus [en
zoomant] et pourtant aucune pastille » ; `HOST_BEST_MIN_PERCENT`, `coversOf` de `forestShare.ts`). La
pastille d'une case reprend son meilleur carré de 4,5 km, et celui-ci faisait la moyenne de toutes
ses forêts hôtes, alors qu'un carré de 500 m ne compte que la sienne. Mesuré au nord-est d'Annecy
(case 287:28, trompettes) : meilleur carré de 4,5 km à 62 %, donc pas de pastille, et 29 carrés de
500 m à 70-77 % dans la vue. Le carré qui en contient 14 a 28 % de sapin-épicéa (poids 0,3 pour les
trompettes), 18 % de forêt mixte à conifères (0,6), 11 % de forêt mixte à feuillus (0,9) et 4 % de
hêtraie (1) : moyenne 0,55, soit 57 %. Désormais la qualité d'un carré est le poids de son meilleur
hôte **présent sur au moins 2 % du carré** (≈ 40 ha, deux carrés de 500 m), et jamais moins que
l'ancienne moyenne (aucun carré ne baisse). Les trois carrés de cet exemple passent de 57, 62 et
51 % à 78, 74 et 74 % ; leurs meilleurs carrés de 500 m sont à 77, 74 et 71 % : sous le zoom 12, un
carré de 500 m ne dépasse plus son carré de 4,5 km (même altitude, et le sol ne fait que baisser).
- **Tout suit la même valeur** (`HostCover.quality`) : étiquette du carré au zoom 10, teinte et
  pastille de la case, bilan d'un coin dont la forêt est inconnue (« chance de la meilleure forêt
  hôte du secteur »), proposition du bandeau « risque de chou blanc », moyenne de France des puces.
  Changer les pastilles seules aurait posé une pastille à 78 % sur un carré affiché à 57 %.
- **Effet mesuré le 15/11/2026, France entière** (`ecart-pastilles.mjs`, `ecart-moyennes.mjs`,
  `apres-regle.mjs`) : cases à pastille, cèpes 75 → 110, girolles 0 → 41, trompettes 181 → 259,
  chanterelles en tube 125 → 180 ; carrés de 4,5 km à 70 % ou plus, 447 → 891, 0 → 212, 1 493 →
  2 145, 1 016 → 1 584. Le seuil pèse peu (trompettes : 266 cases à 1 %, 252 à 3 %, 242 à 5 %). Tout
  carré allumé de France a au moins un hôte à 2 % ou plus.
- Aucun fichier ni appel en plus (`parts.json` donne déjà la part de chaque type de forêt par
  carré), aucune expression de la carte changée. Le fichier des parts simulé des tests e2e n'a
  qu'un type de forêt par carré : la règle se vérifie dans `tests/france.mjs` (5 % d'un bon hôte
  parmi 60 % d'un médiocre valent le bon ; 1 % ne compte pas ; échoue avec l'ancienne moyenne).
