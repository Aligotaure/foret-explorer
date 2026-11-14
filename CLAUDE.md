# Forêt Explorer — notes pour Claude Code

Carte web des types de forêt de la **BD Forêt® V2** (IGN) avec une légende à cases à cocher pour
choisir les types affichés, enrichie pour la cueillette : nature du sol (géologie BRGM), météo des
30 derniers jours (Open-Meteo, recopiée chaque jour dans des fichiers communs par une tâche GitHub),
altitude (IGN) et indice de pousse par champignon, en cases de 18 km, puis en carrés de 4,5 km et de
500 m quand on zoome ; zones protégées et forêts publiques (droit de cueillir). **Toute la France métropolitaine** :
ne rien coder pour une région en particulier.
Accueil à l'ouverture : un avertissement bloquant (3 s, moins de 100 mots) puis, au premier accord,
« La carte en 3 gestes » ; page « À propos » (conseils, conditions, mentions légales,
confidentialité). Interface inspirée du panneau « Légendes » de cartes.gouv.fr
(thème sombre bleu nuit, icônes lavande, légende sur carte blanche). Une page privée (serveur
Cloudflare, `worker/`) suit la consommation des API.

Deux vues dans la même page, choisies par un îlot noir en haut au centre : « Carte » (tout ce qui
précède) et « Analytics » (comment le produit est piloté : pari en cours, analyses, paris tranchés),
à l'adresse `#vue=analytics`. Voir « Deux vues : Carte et Analytics ».

Usage visé : repérer les coins favorables aux champignons (cèpes, girolles, trompettes, chanterelles
en tube, morilles) partout en France. La carte sert aussi sur téléphone, en forêt : le mobile compte
autant que le bureau. Première visite : la France entière ; ensuite, la dernière vue (`foret-explorer:vue`).

En ligne : https://aligotaure.github.io/foret-explorer/ (GitHub Pages, republié à chaque push sur
`main` et à chaque tour complet de la météo par `.github/workflows/deploy.yml` : archive des tuiles
de géologie (cache), archive des zones (cache, refaite chaque semaine), fichiers météo (cache de
`meteo.yml`), tests et publication du serveur de mesure s'il est configuré, `npm run check`,
publication de `dist/`). Autres workflows : `meteo.yml` (toutes les heures : fichiers météo communs,
une demande par case et par jour, voir plus bas), `verification.yml` (chaque pull request, Dependabot
compris), `surveillance.yml` (chaque jour : les services et les archives répondent-ils, la météo
a-t-elle plus de 36 h de retard ?). Liste des risques du site (document à part) :
https://claude.ai/artifact/ScNwBDt9TN7k2DhJ347QdK

## Commandes

- `npm ci` puis `npm run dev` : serveur Vite sur http://localhost:5173 (versions figées par
  `package-lock.json` ; `npm install <paquet>` pour en ajouter un, puis committer le lockfile)
- `npm run typecheck` : TypeScript strict, sans émission
- `npm run build` : build statique dans `dist/` ; `npm run check` = typecheck + build + contrôle du
  build (`tests/build.mjs`, aussi `npm run test:build` : la page d'entrée et la vue Analytics
  n'embarquent pas MapLibre, le code de la carte est préchargé, ordre des feuilles de style, contenu
  de `src/analyticsData.ts` relu)
- `npm run test:e2e` : test de bout en bout (Playwright + vrai MapLibre, services simulés ; avertissement,
  À propos et zones compris ; îlot et vue Analytics dans `tests/e2e/views.mjs`). Première fois :
  `npx playwright install chromium`. Captures dans `tests/e2e/shots/`.
- `cd worker && npm ci && npm test` : serveur de mesure (26 vérifications, Durable Object simulé sur
  `node:sqlite`, Node ≥ 22.18 qui lit le TypeScript directement) ; aperçus HTML dans `worker/test/apercus/`.
  `npm run typecheck` (types Cloudflare), `npm run dev` (wrangler, secrets dans `worker/.dev.vars`).
- `bash scripts/geologie/construire.sh` : tuiles « nature du sol » de toute la France, dans l'archive
  `public/data/geologie/geologie.pmtiles` (GDAL ≥ 3.8 avec le pilote PMTiles ; 2,7 Go téléchargés,
  dix minutes ; pour un essai : `DEPARTEMENTS="074 073"`). Inutile en dev : la carte lit alors
  l'archive du site en ligne.
- `bash scripts/zones/construire.sh` : tuiles des zones protégées et forêts publiques, dans l'archive
  `public/data/zones/zones.pmtiles` (GDAL ≥ 3.8, Node ; toute la France depuis le WFS, retéléchargée
  au plus une fois par semaine). Même remarque en dev.
- `node scripts/meteo/mettre-a-jour.mjs --simuler --dossier /tmp/meteo --cases scripts/meteo/cases-france.json`
  : fichiers météo communs avec des séries fictives (sans `--simuler` : vrais appels à Open-Meteo,
  `--budget` en appels pondérés). En dev, la carte lit ceux du site en ligne.
- `node scripts/meteo/cases.mjs` : refait `scripts/meteo/cases-france.json` (liste versionnée des
  cases, de leur point de relevé et de l'altitude de leurs 16 carrés de 4,5 km), seulement si la
  taille des cases change ; les points de relevé existants sont gardés. Pas de CORS ni d'accès depuis
  le bac à sable : à lancer en local ou dans une tâche GitHub.
- `node scripts/foret/parts.mjs` : refait `public/foret/parts.json` (part de chaque type de forêt et
  part bâtie de chacun des 29 483 carrés de 4,5 km), seulement si la grille change ou si l'IGN publie
  une nouvelle BD Forêt. 889 tuiles vectorielles du zoom 10 de la BD Forêt (≈ 320 Mo, gardées dans
  `.cache/foret/`) et autant du Plan IGN (≈ 85 Mo, `.cache/plan/`), une à deux minutes, sans
  dépendance ; tourne en local (il traduit `src/meteoGrid.ts` lui-même).
- `npm run test:donnees` : `test:meteo` (mise à jour de la météo commune rejouée sur plusieurs jours
  avec des séries simulées : budgets, jours manquants, journée provisoire, publication) + `test:geologie` (règles des sols
  sur la table de toutes les descriptions de France, `tests/donnees/`) + `test:foret` (géométrie du
  calcul des parts de forêt, lecteur de tuiles, fichier versionné ; lui seul tourne en local).
  `node tests/geologie.mjs non` liste les formations encore sans sol, `sol <id>` et `grep <motif>`
  servent à régler les règles.

Après chaque modification : `npm run check` puis `npm run test:e2e` (`npm run test:donnees` si
`scripts/`, `src/meteoGrid.ts` ou `src/metricsSchema.ts` changent ; `npm test` dans `worker/` si le
serveur de mesure ou `src/metricsSchema.ts` change). Sans accès à npm (bac à sable), pousser sur une
branche et lancer `verification.yml` (`gh workflow run verification.yml --ref <branche>`).

## Pile

Vite + TypeScript strict + MapLibre GL JS 5, sans framework. Une seule autre dépendance : `pmtiles`
(lecture des archives de tuiles du site, protocole `pmtiles://` enregistré dans `mapView.ts`). Pas de
nouvelle dépendance sans raison.

## Architecture (`src/`)

| Fichier | Rôle |
|---|---|
| `main.ts` | Point d'entrée (petit) : feuilles de style, îlot, avertissement, et chaque vue chargée par `import()` à sa première ouverture |
| `view.ts` | Les deux vues : lecture et écriture de `#vue=analytics` dans l'adresse, historique, îlot, annonce aux lecteurs d'écran |
| `mapView.ts` | La vue Carte (chargée à la demande) : protocole `pmtiles://`, carte (France entière puis dernière vue gardée), modules, état → carte, clic → bilan du coin, comptages |
| `analyticsView.ts`, `analytics.css` | La vue Analytics (chargée à la demande, sans rien de la carte) : en-tête, entonnoir (emplacement vide), pari en cours, analyses, paris tranchés, états vides |
| `analyticsData.ts` | **Le** fichier de contenu de la vue Analytics, modifié à la main (guide en tête du fichier) |
| `analyticsTypes.ts`, `analyticsCheck.ts` | Format de ce contenu (types stricts : dates, adresse https) et relecture de ce que les types ne voient pas (date impossible, texte vide, valeur négative) |
| `disclaimer.ts` | Avertissement bloquant (`<dialog>` modal, ni Échap ni clic à côté), moins de 100 mots : bouton actif 3 s après le premier affichage (horloge, pas minuteries ; il attend aussi la fin du texte si la fenêtre défile), mémorisé par version des conditions, 30 jours au plus ; dit si c'est un premier accord |
| `tour.ts` | « La carte en 3 gestes » : fenêtre libre montrée après un premier accord et depuis la légende, schéma de l'écran dessiné en HTML/CSS (grand écran et téléphone) ; chargé avec l'entrée, n'importe rien de la carte |
| `legal.ts` | Version des conditions (`TERMS_VERSION`), jour de la refonte (`TOUR_SINCE`), adresse de « À propos », données gardées dans le navigateur, effacement |
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
| `forestShare.ts` | Arbres hôtes et part bâtie de chaque carré de 4,5 km, lus dans `public/foret/parts.json` : part de surface et qualité moyenne des hôtes par champignon, et la règle d'allumage d'un carré (`isLit`) |
| `soils.ts` | 8 natures de sol, champignons associés, motifs dessinés au canevas |
| `geology.ts` | Motifs fournis à MapLibre (`styleimagemissing`), forêt et sol sous un point |
| `meteoGrid.ts` | Grille météo commune (cases de 0,16° × 0,224°, blocs de 8 × 8, 16 carrés de 4,5 km par case : `subBox`, `subIndexAt`), format des fichiers, dates ; lu aussi par Node (scripts) : aucun import |
| `weather.ts` | Fichiers météo communs (index, blocs), résumé de 30 jours daté (épisodes de pluie, gel, `rain20` pour l'humidité, jour estimé), `atAltitude`, `summaryAtAltitude`, Open-Meteo en secours (cache du jour), altitude IGN |
| `meteoLayer.ts` | Grille météo sur la vue, à tous les zooms (toute la France d'un coup en vue d'ensemble) : pluie cumulée ou indice du champignon choisi, détaillé par carrés de 4,5 km à partir du zoom 8, allumés à la mesure de leurs arbres hôtes, hors des villes ; carrés fins en mode indice. Règles de fluidité en tête de classe |
| `fineGrid.ts` | Carrés de 500 m : découpage, relevé forêt/sol (index spatial sur `queryRenderedFeatures`), altitudes en cache permanent, choix des carrés à dessiner (`fineCellsToDraw` : plus sévère en ville), indice par carré |
| `metrics.ts` | Compteurs de consommation des API (en mémoire) et envoi groupé au serveur de mesure |
| `metricsSchema.ts` | Liste des compteurs, partagée avec `worker/` (un compteur absent est refusé par le serveur) |
| `spot.ts` | Bilan d'un coin au clic, la réponse d'abord : zone protégée, terrain (forêt, sol, altitude, statut), une ligne par champignon, bouton « ? », pluie, règles repliées |
| `search.ts` | Recherche de lieu (autocomplétion de la Géoplateforme) |
| `toolbar.ts` | Boutons : légende, fond de carte, géolocalisation, plein écran, zoom |
| `counts.ts` | Nombre de polygones par type dans les tuiles affichées |
| `dom.ts`, `icons.ts` | Utilitaires DOM (`h()`, `toast()`…), icônes SVG |

`scripts/geologie/` : `construire.sh` (téléchargement BRGM → GeoJSONSeq WGS84 → classement → archive
PMTiles), `regles.mjs` (règles de classement des descriptions géologiques en natures de sol),
`classer.mjs` (avec `TABLE_DESCR=fichier.tsv` : table de toutes les descriptions), `info.mjs` (écrit
`info.json` : provenance, départements, emprise et zooms lus dans l'en-tête de l'archive, surfaces par sol).
`scripts/meteo/` : `mettre-a-jour.mjs` (fichiers météo communs, voir « Météo commune »), `cases.mjs`
(liste des cases qui touchent la France, d'après ADMIN EXPRESS, et altitude IGN de leurs carrés de
4,5 km), `cases-france.json` (versionné).
`scripts/foret/` : `parts.mjs` (parts de forêt par carré de 4,5 km → `public/foret/parts.json`,
versionné), `mvt.mjs` (lecteur de tuiles vectorielles sans dépendance), `geometrie.mjs` (aires,
découpage d'un anneau par un rectangle, tuiles XYZ).
`scripts/zones/` : `telecharger.mjs` (WFS → GeoJSONSeq Lambert-93, noms nettoyés, `resume.json`),
`construire.sh` (GPKG simplifié à 5 m → archive PMTiles, couches `protection`, `protection_nom` (un point par zone,
pour n'afficher son nom qu'une fois : les sites des conservatoires sont faits de dizaines de parcelles)
et `foret_publique`, `info.json`).

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
`meteo-fin-contours` (carrés de 500 m, zoom ≥ 12, mode indice), `meteo-etiquettes`,
`meteo-fin-etiquettes`, `zones-protegees-contours`, `zones-protegees-etiquettes` (au-dessus de
l'indice), `bdforet-highlight-casing`, `bdforet-highlight`.

Carrés de 4,5 km (`meteoLayer.ts`, zoom ≥ `WEATHER_SUB_MIN_ZOOM` = 8, mode indice) : chaque case
commune est dessinée en 16 carrés (id « I:J/k », propriété `sub` = 1), même pluie, températures
ramenées à l'altitude de chaque carré (`a` dans les fichiers, `summaryAtAltitude`) ; un carré sans
terre française n'est pas dessiné. En deçà du zoom 8, et en mode pluie, cases entières (`sub` = 0, à
l'altitude médiane de leurs carrés). Étiquettes des carrés à partir du zoom 10 (une expression de
zoom dans une propriété `layout` n'est évaluée qu'aux zooms entiers).

Arbres hôtes (`forestShare.ts`, `public/foret/parts.json`, mode indice) : avant le 14/11/2026, cases
et carrés ne regardaient que la météo (Paris affichait « 78 % · favorable », le bilan au même point
« ≈ 0 % »). Désormais un carré n'est coloré (`isLit`) que si les arbres hôtes du champignon y couvrent
au moins `HOST_MIN_COVER` (10 %) de la surface et si moins de `BUILT_MAX_COVER` (15 %) est bâti, et
d'autant plus qu'ils en couvrent (teinte pleine à `HOST_FULL_COVER`, 50 %) ; son indice est multiplié
par la qualité moyenne de ces hôtes (pas par le sol, inconnu à cette échelle : le bilan, qui regarde
la forêt et le sol du point, peut différer dans les deux sens). Seuils du 14/11/2026 : à 5 % d'hôtes
et sans regarder le bâti, 85 % des carrés de France s'allumaient pour les cèpes (25 154 sur 29 483),
dont 1 600 bâtis à 15 % ou plus : toutes les villes étaient colorées (Nancy : 80 à 84 % sur le
centre). Avec 10 % et 15 % : 20 048 carrés (68 %). Un carré éteint n'est pas envoyé à la carte : ni
teinte, ni quadrillage, ni étiquette, ni pastille. Propriétés d'un carré : celles du champignon
montré seulement, sous des noms fixes (`l` niveau, `p` chance estimée, `c` part d'hôtes de 0 à 1 ;
`c` = −1 si le fichier manque : la grille se dessine alors comme avant et la légende le dit ; `c` = 0
pour une case éteinte du mode pluie). Case entière (zoom < 8) :
moyenne de ses carrés, pastille posée sur son carré allumé le plus boisé. Aux zooms des carrés de 500 m, la grille des
cases reste en fond sans étiquette dès que le relevé fin est fait (`fineDone`), même s'il n'a trouvé
aucun arbre hôte. Fichier : par case commune, 16 carrés `[rang du code, part en %, …]` (null : pas de
terre française) dans `cases`, et leur part bâtie en % dans `bati` (champ ajouté le 14/11/2026, même
format `v: 1` : un fichier sans lui se lit encore, rien n'est alors tenu pour bâti) ; 993 ko, 236 ko
compressé ; aux limites de départements des polygones de la BD Forêt se recouvrent (99 carrés ramenés
à 100 %). Part bâtie : zones bâties et zones d'activité du Plan IGN (voir « Données et API ») ;
3 509 carrés bâtis à 10 % ou plus, 2 043 à 15 %, 1 011 à 25 %, 299 à 50 %. Les identifiants de texte des cases (« I:J/k ») ne
survivent pas aux tuiles de MapLibre : dans les tests, un carré se reconnaît à son centre (`x`, `y`).
Simulé dans les tests e2e (`forestShare()` de `mocks.mjs`). Le fichier est chargé dans tous les modes (en
passant de la pluie à la chance estimée, les carrés déjà là sont repeints tout de suite) ; un échec
de réseau se retente au plus toutes les 30 secondes, un fichier d'un autre format jamais. Une case
entière est allumée dès qu'un de ses carrés l'est (sa teinte suit la moyenne). La police des
étiquettes est vide dans les tests : aucune étiquette n'y est dessinée, on y évalue donc les
expressions de MapLibre carré par carré (`map.style.getLayer(…).paint.get(…).evaluate(…)`). Le mois
est figé en octobre dans les tests de bureau (saison des champignons).

## Fluidité : ce que coûte un changement sur la carte

Mesuré le 14/11/2026 (Chromium sans carte graphique, comme une machine virtuelle ou un vieux
téléphone ; vraies données, 1280 × 800 ; fil principal occupé et images redessinées, relevés par le
profileur du navigateur et l'événement `render` de MapLibre). Un clic sur un champignon :

| Vue | Avant | Après |
|---|---|---|
| France entière (zoom 5) | 1,2 à 1,4 s, 20 à 22 images | 0,4 s, 4 images |
| Lyon (zoom 9) | 1,1 à 1,3 s, 12 à 15 images | 0,5 s, 5 images |
| Annecy (zoom 11) | 1,8 s, 6 à 8 images | 1,2 à 1,4 s, 5 images |
| Forêt (zoom 13, carrés de 500 m) | 1,0 s, 9 à 10 images | 0,6 s, 4 à 5 images |

Le code du site n'y pèse presque rien (5 à 100 ms) : le temps part dans MapLibre. Deux faits à
garder en tête avant de toucher à la grille (`meteoLayer.ts`, `mapStyle.ts`) :
- chaque arrivée de tuiles fait redessiner la carte, et sans carte graphique chacune de ces images
  occupe le fil principal 0,1 à 0,3 s (0,1 s à Lyon au zoom 9, 0,26 s à Annecy au zoom 11) ;
- MapLibre refait toutes les tuiles d'une source dès qu'on change son contenu (`setData`), un filtre,
  ou une propriété de dessin dont l'expression lit une propriété des objets (`['get', …]`). Une
  propriété constante (opacité fixe) ne refait rien.

D'où les règles : les carrés ne portent que les valeurs du champignon montré sous des noms fixes
(`l`, `p`, `c` : changer de champignon ne change plus aucune expression, un test le vérifie) ; un
carré éteint n'est pas envoyé ; un contenu identique au précédent n'est pas renvoyé (`setSource`) ;
la grille est refaite tout de suite au changement de mode ou de champignon (les 0,5 s d'attente ne
servent qu'aux déplacements) ; les carrés de 500 m sont redessinés au plus toutes les 1,2 s pendant
que leurs altitudes arrivent ; pas de fondu des étiquettes (`fadeDuration: 0`) ni de transition de
0,3 s (`transition` du style) ; sources de la grille avec un `maxzoom` bas (une ou deux tuiles pour
la vue au lieu de douze).

Ce qui reste : à partir du zoom 10, choisir un champignon change aussi le filtre des forêts, et
MapLibre refait alors toutes les tuiles de la BD Forêt (≈ 1 s à lui seul au zoom 11 sans carte
graphique). Voir « Pistes ».

## Bilan et légende : la réponse d'abord

Refonte du 14/11/2026 (mesures du 13/11 : sur téléphone, aucun pourcentage visible à l'ouverture du
bilan ; légende de 61 contrôles dont 39 cases, météo en 5ᵉ position).

- **Bilan** (`spot.ts`), dans l'ordre : alerte de zone protégée s'il y en a une (en tête, que la
  météo réponde ou non) ; terrain (Forêt, Sol, Altitude, **Statut**) ; « Champignons · chance
  estimée » ; météo ; « Droit de cueillir : les règles », replié ; actions ; une ligne de note.
- **Statut** : toujours visible, un fait et ce qu'il implique (« Forêt sans doute privée : il faut
  l'accord du propriétaire », « X : forêt publique »), jamais « autorisé ». C'est le garde-fou qui
  permet de replier les règles : ne pas le déplacer sous les champignons. Un test e2e vérifie qu'il se
  voit sans rien déplier.
- **Champignons** : du plus probable au moins probable (tri sur l'indice, sans exception) ; le
  champignon recherché est signalé à son rang (liseré, « recherché ») et sa ligne dépliée, sinon la
  première si elle atteint 50 % ; les raisons sont dans un `<details>` par champignon ; exclu par la
  saison ou la forêt (`MushroomScore.blocker`) : une ligne avec la raison. Le bilan ouvert suit le
  champignon recherché (`SpotPanel.refresh()`). Il est redessiné jusqu'à trois fois par clic : tout ce
  qui se déplie garde son état dans un champ de `SpotPanel`, remis à zéro à chaque nouveau coin.
- **« ? »** (un seul, près du titre « Champignons ») : un bouton `aria-expanded` qui déplie un encart
  sur place, au clic, au toucher et au clavier (Échap le replie) ; pas d'infobulle au survol (rien de
  tel sur téléphone, et le panneau la rognerait). Il dit « estimation, pas une probabilité mesurée ».
- Sous le zoom 10, ou tant que les tuiles de la BD Forêt ne sont pas arrivées (clic juste après un
  zoom), la forêt est **inconnue**, pas absente (`forestUnknown` : `'zoom'` ou `'loading'`). Le bilan
  applique alors la règle de la carte au carré de 4,5 km qui contient le point (`View.sector`,
  `hostCover`, `isLit`) : sans arbres hôtes dans le secteur, aucune chance annoncée (« peu d'arbres
  hôtes dans ce secteur ») ; secteur d'abord bâti, de même (« secteur surtout bâti ») ; sinon celle
  de ses forêts hôtes, et la raison le dit. Fichier des parts absent :
  météo seule. Sans cela, le bilan annonçait « favorable » en pleine ville dès qu'on dézoomait.
- La phrase de pluie d'un champignon commente la pluie la plus récente dont le délai n'est pas
  dépassé, plutôt qu'une vieille pluie « dépassée » qui pèse plus dans l'indice (sinon elle contredit
  le bloc météo) ; une pluie modeste encore fraîche ne promet rien (« pousse incertaine »).
  « pousse attendue d'ici N jours » est en gras dans sa raison (`reasonItem` de `spot.ts`, repérée par
  `AWAITED` de `mushrooms.ts` : garder les deux textes identiques) : c'est la seule qui dit quand revenir.
- Un `<details>` créé ouvert émet lui aussi « toggle » : ne retenir dans `SpotPanel.cards` que ce qui
  s'écarte de l'état d'office, sinon l'ancienne ligne reste dépliée quand le champignon recherché
  change. Le clavier retrouve sa place après un redessin par la clé `data-focus` de l'élément.
- **Légende** (`legend.ts`), dans l'ordre : « Je cherche… » (seule dépliée à la première visite),
  « Météo », « Types de forêt » (repliée, rappel « 15 / 32 » dans l'en-tête), « Nature du sol »,
  « Droit de cueillir », « Fond de carte : … », puis « Comment ça marche ? » et les liens. À la
  première visite le panneau tient sans défiler (test e2e). Une section à interrupteur se déplie
  quand sa couche est allumée, au chargement aussi.
- **Fiche d'un champignon** : résumé, lien « Photos et description : *espèce* sur MycoDB (site
  tiers) », conditions repliées, encadré de précaution en dernier. Les entrées sont des groupes : le
  lien nomme l'espèce visée ; adresses en dur dans `mushrooms.ts` (MycoDB répond 200 pour une fiche
  absente). Libellé neutre : ni « identifier », ni « comestible » (la fiche tierce, elle, l'écrit).
  **MycoDB interdit les robots d'IA dans son `robots.txt` et bloque les rafales : ne jamais
  l'interroger par script ni l'ajouter à `surveillance.yml`** ; une fiche se vérifie à la main.

Grille fine (`fineGrid.ts`, zoom ≥ `FINE_MIN_ZOOM` = 12, mode indice) : chaque case de base de 4,5 km
(0,04° × 0,056°) est découpée en 9 × 9 carrés (id « I:J ») ; une case météo commune en contient
exactement 36 × 36 (parent : `cellOfBase`). Forêt et sol relevés sur 3 × 3 points par
carré, en une seule requête `queryRenderedFeatures` sur toute la vue puis test point-dans-polygone (un
appel par point serait bien plus lent) ; relevés gardés pour la visite. Altitude IGN au centre, gardée
dans `localStorage` (`foret-explorer:altitudes`, 40 000 carrés au plus), demandée seulement pour les
carrés boisés, par lots de 200 points (service en panne : altitude du carré de 4,5 km). Températures
de la case commune corrigées de −0,65 °C par 100 m ; la pluie reste celle de la case. Carré dessiné
seulement si trois de ses neuf points au moins sont sous un arbre hôte du champignon montré
(`FINE_MIN_HOST_SHARE`) ; en ville (son carré de 4,5 km est bâti à 15 % ou plus), il en faut cinq et
deux carrés voisins boisés sur huit (`fineCellsToDraw` : un parc isolé n'en pose plus ; un voisin hors
de l'écran, inconnu, compte pour boisé). Opacité
selon la part d'arbres hôtes ; défavorable = contour seul. Les forêts s'estompent (45 %) à ces zooms.
⚠ Zoom MapLibre = zoom « 512 px » : au zoom 13, ≈ 5 m/pixel (pas 10).

## Deux vues : Carte et Analytics

- **Adresse** : `#vue=analytics` à côté de la position que MapLibre tient à jour (`hash: 'carte'`),
  par exemple `#carte=11.5/45.92/6.19&vue=analytics` ; sans `vue=analytics`, c'est la carte.
  `view.ts` découpe le fragment à la main (jamais `URLSearchParams` : il encoderait les « / » de
  `carte=`, que MapLibre ne relirait plus) et passe toujours une adresse complète à `pushState`
  (une chaîne vide y est ignorée : l'adresse garderait `vue=analytics`).
- **Historique** : un clic sur l'îlot ajoute une entrée sans émettre `hashchange`, donc MapLibre ne
  déplace pas la carte ; Précédent et Suivant rendent à chaque entrée sa vue et, par MapLibre, sa
  position. En quittant la carte par l'îlot, `map.stop()` arrête le déplacement en cours : la
  position exacte est écrite dans l'entrée quittée. Pas de lien `href="#…"` dans la vue Analytics :
  il remplacerait tout le fragment, `vue=analytics` compris.
- **Chargement** : `main.ts` (≈ 4 ko) charge chaque vue à sa première ouverture. Arriver sur
  `#vue=analytics` ne demande ni MapLibre, ni tuile, ni fichier météo. Toutes les feuilles de style
  sont dans l'entrée, MapLibre d'abord (`style.css` corrige `.maplibregl-ctrl-bottom-right` et
  `.maplibregl-ctrl-scale`, de même poids), `analytics.css` compris : pas d'éclair au premier
  affichage, et un module chargé à la demande ne porte aucune feuille de style. Ses sélecteurs
  commencent tous par `#analytics`, `.analytics` ou `html[data-view='analytics']` : la carte n'en
  est pas changée.
- **En-tête d'`index.html`** : un script pose `data-view="analytics"` sur `<html>` avant le premier
  affichage (même règle que `view.ts`) ; sinon il précharge le code de la carte, dont
  `vite.config.ts` écrit le nom au build à la place de `__MAP_CHUNK__`. Mesuré le 13/11/2026 (build
  servi en gzip, réseau bridé) : la carte arrive comme avant le découpage (4G lente : 2,2 s ; 3G :
  7,9 s, soit +0,07 et +0,1 s) ; sans ce préchargement, +0,2 et +0,5 s. L'avertissement, lui,
  s'affiche 1,6 à 6 s plus tôt qu'avant (il n'attend plus MapLibre).
- **Carte masquée** : en vue Analytics, `#app` et tous ses descendants sont en `visibility: hidden`
  (`#app *` est nécessaire : MapLibre force `visibility: visible` sur ses crédits dépliés). Pas de
  `display: none` : la carte garde sa taille, sa position, sa légende et son bilan, et rien n'est
  rechargé au retour. `#app` est alors figé à `100vw` × `100svh` (ni la barre de défilement ni la
  barre d'adresse du téléphone ne le redimensionnent). `view.ts` reprend le clavier resté dans la vue
  masquée.
- **Avertissement** : c'est `main.ts` qui l'appelle, avec la vue Carte seulement ; quitter la carte
  sans l'avoir accepté le retire (`withdrawDisclaimer()`), y revenir le remontre, compte à rebours
  repris de zéro. Tant qu'il est à l'écran, l'îlot est inerte (fenêtre modale) : l'adresse à donner
  pour montrer la vue Analytics est `…/#vue=analytics`.
- **Îlot** : `nav` de deux liens (`aria-current="page"`), avant `#app` dans la page (premier arrêt de
  la touche Tab). 208 px × 46 px (`--island-width`, `--btn`), liens pleine hauteur, fond clair du
  segment actif en `::before` (glissement de 300 ms, bord meneur en premier ; rien si les animations
  sont réduites). Placé en `vw`, sans `transform`. Ce qu'il a déplacé :
  - ≤ 640 px : îlot sur la première rangée, entre le bouton légende et les boutons de droite ; la
    recherche passe à la deuxième rangée (`.topbar` en `flex-wrap`, `pointer-events: none` sur le
    vide), le bandeau « Zoomez… » à la troisième, arrêté avant la colonne de boutons ;
  - de 641 à 1187 px : îlot à droite de la recherche (décentré) ; sous 760 px la recherche se
    resserre ; de 641 à 1127 px le bilan s'ouvre une rangée plus bas, et le bandeau « Zoomez… »
    aussi (il reste sous l'en-tête du bilan, par-dessus son contenu, comme avant) ;
  - à partir de 1188 px : centré, rien ne bouge.
- **Contenu de la vue Analytics** : tout vient de `src/analyticsData.ts` ("" , `null` ou `[]` : état
  vide). Guillemets doubles dans ce fichier (les apostrophes du français y sont sans danger), modèles
  en commentaire dont chaque champ vaut `A_REMPLIR` (un oubli fait échouer `npm run check`). Les
  types refusent une date à la française, une adresse sans https, un champ mal nommé ;
  `analyticsCheck.ts` relit le reste (date qui n'existe pas, texte vide, valeur négative), affiché
  en tête de vue en développement et vérifié par `npm run check` et par les tests e2e. Le rendu ne casse jamais (date impossible montrée telle quelle, graphique sans barre
  omis). Graphique : barres horizontales, une série, échelle à zéro, aucune valeur calculée.
  N'y écrire que des chiffres mesurés ; « Entonnoir en direct » reste un emplacement vide tant
  qu'aucune mesure n'est branchée. Jamais de modification directe sur `main` : une erreur y
  bloquerait `npm run check`, donc la publication quotidienne de la météo.

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
  → `{ elevations: [930] }` ; −99999 hors couverture. Plusieurs points : `lon=a|b|c&lat=x|y|z` (vérifié
  le 01/11/2026 : 250 points ≈ 1,4 s ; 400 points ≈ 3,7 s ; 800 points, soit 15 Ko d'URL, refusé).
  POST JSON refusé (`zonly` mal lu) : rester en GET. Limite : 5 requêtes/s/IP, sinon 429 et blocage
  de 5 s ; autocomplétion 10/s ; tuiles WMTS et TMS sans limite
  ([cartes.gouv.fr](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/limites-d-usage/)).
- **Météo** : Open-Meteo, `https://api.open-meteo.com/v1/forecast?latitude=a,b&longitude=c,d&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&past_days=N&forecast_days=1&timezone=Europe/Paris`
  (+ `elevation=…` pour ramener les températures à une altitude). Plusieurs points → tableau dans
  le même ordre, un seul point → objet. Sans clé, CORS ouvert, CC BY 4.0, usage non commercial :
  moins de 10 000 appels/jour, 5 000/h, 600/min, 300 000/mois, limites par IP et par application.
  Poids d'un appel : points × max(1, jours/14) × max(1, variables/10) (`openMeteoCalls10()` le compte
  en dixièmes) : jusqu'à 14 jours, 1 par point ; 31 jours, 2,2. **Seule la tâche `meteo.yml` l'appelle**
  (voir « Météo commune ») ; la carte ne s'en sert qu'en secours (fichiers injoignables : 20 jours, au
  plus 60 cases à l'écran, cache du jour ; point hors de France).
- **Géologie** : cartes harmonisées au 1/50 000 du BRGM (BD Charm-50, version 2019), couche
  `S_FGEOL` (champs utiles `NOTATION`, `DESCR`), Lambert-93. Téléchargées en CI depuis le miroir
  référencé par data.gouv.fr : `http://data.cquest.org/brgm/bd_charm_50/2019/GEO050K_HARM_0XX.zip`,
  une archive par département (001 à 095, 02A, 02B ; 2,7 Go en tout), sauf deux archives regroupées :
  `GEO050K_HARM_059_062.zip` (Nord, Pas-de-Calais) et `GEO050K_HARM_075_077_078_091_092_093_094_095.zip`
  (Île-de-France) ; les numéros seuls de ces dix départements répondent 404.
  `infoterre.brgm.fr/telechargements/…` renvoie 404 et le WMS `geoservices.brgm.fr` n'a pas de CORS
  (et filtre les robots) : ne pas l'appeler depuis le navigateur.
  Tuiles produites (vérifié le 11/11/2026 en CI, GDAL 3.12 : 9 minutes, 96 départements,
  1 035 752 formations dont 988 094 classées) : une archive `data/geologie/geologie.pmtiles` (couche
  `geologie`, champs `sol`, `notation`, `descr`, zooms 10 et 11, sur-zoom au-delà, 4 218 tuiles
  compressées, 143 Mo ; `SIMPLIFICATION=4` au zoom 10, `SIMPLIFICATION_MAX_ZOOM=2` ; avec le zoom 12 :
  262 Mo) et son `info.json`. Au zoom 11, une unité de tuile vaut 3,3 m : bien assez pour du 1/50 000.
  Une tuile absente de l'archive (mer, étranger) est rendue vide par le protocole : pas une erreur.
- **Zones protégées et forêts publiques** (WFS de la Géoplateforme, sans clé, vérifié le 03/11/2026
  depuis GitHub Actions ; **pas de CORS** : seulement au build) : `TYPENAMES=patrinat_rnn:rnn`,
  `patrinat_rnr:rnr`, `patrinat_pprnn:pprnn`, `patrinat_pprnr:pprnr`, `patrinat_rb:rb` (champ `zone` :
  Intégrale / Dirigée), `patrinat_pn:parc_national` (champ `zone` : Cœur / Adhesion, on garde le cœur),
  `patrinat_apb:apb`, `patrinat_aphn:aphn`, `patrinat_cdl:conservatoire_littoral`, `patrinat_cen:cen`
  (champs `nom_site`, `url_fiche` vers l'INPN, `id_mnhn`) ; `BDTOPO_V3:foret_publique` (`nature` : Forêt
  domaniale / Autre forêt publique, `toponyme`, source ONF 2021). Requête : `OUTPUTFORMAT=application/json`,
  `SRSNAME=EPSG:2154`, `BBOX=41.2,-5.3,51.2,9.7,urn:ogc:def:crs:EPSG::4326` (lat/lon en WFS 2.0 ; toute
  la France métropolitaine), `COUNT=5000` + `STARTINDEX`. France entière (03/11/2026) : 151 RNN, 191 RNR,
  18 périmètres de protection, 267 réserves biologiques, 8 cœurs de parc national, 1 062 arrêtés de
  biotope, 26 arrêtés d'habitats naturels, 623 sites du Conservatoire du littoral, 2 552 sites des CEN ;
  17 071 forêts publiques (1 285 domaniales ; 360 Mo de GeoJSON). Tuiles : une archive
  `data/zones/zones.pmtiles`, zooms 9 à 11 (sur-zoom au-delà), 4 142 tuiles, 24 Mo, 3 minutes de
  construction ; gardée en cache et refaite chaque semaine (`deploy.yml`).
  ⚠ Un cœur de parc national compte des centaines de milliers de points : pas de `Math.min(...tableau)`
  ni de `push(...tableau)` sur ces géométries (dépassement de pile).
  Exclus exprès : Natura 2000, ZNIEFF, PNR, sites classés, réserves de chasse (pas d'interdiction de
  cueillette en soi). Aussi disponible : `PROTECTEDAREAS.PRSF:prsf` (points de rencontre des secours en
  forêt, ONF).
- **Archives PMTiles** (tuiles du site : sols et zones) : un fichier par couche, écrit par GDAL
  (`ogr2ogr -f PMTiles`, tuiles compressées en gzip), lu par la bibliothèque `pmtiles` (4.5) en
  requêtes HTTP partielles (`Range`) : en-tête et répertoire d'abord (16 Ko), puis une requête par
  tuile. La source MapLibre est `tiles: ['pmtiles://<adresse>/{z}/{x}/{y}']` (`archiveTiles`), avec
  `minzoom`, `maxzoom` et `bounds` écrits dans `config.ts` : les garder égaux à ceux des scripts.
  Pourquoi : GitHub Pages abandonne une publication au bout de 10 minutes (le 10/11/2026, la première
  publication des 31 000 fichiers de tuiles de toute la France a échoué ainsi ; la suivante est
  passée en 30 secondes, les fichiers étant déjà connus). Tests e2e : `pmtilesArchive()` de
  `tests/e2e/mocks.mjs` fabrique une archive minimale (une entrée de répertoire qui rend la même tuile
  pour tous les z/x/y) servie par morceaux.
- **Plan IGN en tuiles vectorielles** (vérifié le 14/11/2026 ; seulement pour calculer la part bâtie,
  `scripts/foret/parts.mjs` ; la carte, elle, affiche le Plan IGN en images WMTS) :
  `https://data.geopf.fr/tms/1.0.0/PLAN.IGN/{z}/{x}/{y}.pbf`, numérotation XYZ comme la BD Forêt.
  Au zoom 10, couche `bati_zone_surf`, champ `symbo` : `ZONE_BATI` (zones d'habitat) et
  `ZONE_INDUS_ACTI` (zones industrielles et d'activité), polygones généralisés ; les deux peuvent se
  recouvrir (part ramenée à 100 %). Autres couches du même niveau : `ocs_vegetation_surf`,
  `hydro_surf`, `routier_route`, `oro_courbe` (la plus lourde)… 889 tuiles, ≈ 100 ko chacune.
- **WFS BD Forêt** (pas utilisé, utile pour un export) : `https://data.geopf.fr/wfs`,
  `TYPENAMES=LANDCOVER.FORESTINVENTORY.V2:formation_vegetale`, `OUTPUTFORMAT=application/json`,
  `CQL_FILTER` et `PROPERTYNAME` acceptés. Avec GeoServer, `BBOX=` et `CQL_FILTER=` ne se combinent
  pas : mettre la boîte dans le CQL.

## Météo commune (`meteo.yml`, `scripts/meteo/`, `src/meteoGrid.ts`)

- Cases de 4 × 4 cases de base = 0,16° × 0,224° (≈ 18 km) : 1 972 cases pour la France métropolitaine
  et la Corse (une case est gardée si l'un de ses 9 × 9 points tombe dans un département ; point de
  relevé = centre, ou point du territoire le plus proche du centre : 177 cases de côte ou de frontière).
- Taille choisie sur mesure (novembre 2026 : indice recalculé sur 5 régions de 70 km — Alpes, Corrèze,
  Landes, Vosges, Var — avec une seule série par case, températures ramenées à l'altitude de chaque
  point, comparé à la grille de 4,5 km d'avant). En octobre, saison pleine : même niveau d'indice dans
  82 % des cas à 9 km, 79 % à 13 km, 75 % à 18 km, 74 % à 22 km, 70 % à 27 km, 67 % à 36 km ; à un niveau
  près : 97, 97, 95, 95, 93, 91 %. En été sec (2 régions) : 94 % et 99 % à 18 km. Passer de 18 à 9 km
  coûterait 4 fois plus d'appels pour 7 points de mieux ; au-delà de 22 km l'écart se creuse. Les
  modèles plus lisses (ARPEGE, ECMWF) font nettement moins bien (64 à 69 %) : garder `best_match`.
  Le plus sensible : pluies proches des seuils (Corrèze : 59 %) ; le moins : temps sec ou très arrosé.
- Altitude des 16 carrés de 4,5 km de chaque case (`cases-france.json`, 5ᵉ élément ; recopiée dans les
  fichiers, champ `a`) : RGE ALTI au centre du carré, ou au point du territoire le plus proche du
  centre (5 × 5 points essayés) ; null sans terre française ; 29 483 carrés, de −3 à 4 489 m. La mesure
  ci-dessus suppose les températures ramenées à l'altitude de chaque point de 4,5 km : c'est ce que
  fait la grille à partir du zoom 8, et le bilan d'un coin avec l'altitude exacte.
- Fichiers servis par GitHub Pages : `data/meteo/index.json` (grille, blocs, date de mise à jour `maj`,
  `dernierJour` = dernier jour définitif de la plupart des cases) et `data/meteo/b/<bi>_<bj>.json`
  (blocs de 8 × 8 cases : `dates` = 30 jours complets + la journée du passage, par case `p` pluie,
  `x`/`n` températures max/min, `z` altitude du point de relevé, `a` altitudes des 16 carrés, `f`
  dernier jour définitif, `c` dernier jour connu, `m` jour de la dernière demande). La carte charge
  seulement les blocs de la vue, avec `?v=<maj>` dans l'adresse (pas de bloc périmé en cache).
- Journée provisoire : chaque passage garde aussi la journée en cours telle qu'Open-Meteo la donne
  (heures écoulées + prévision), `c` > `f`. La carte n'affiche jamais aujourd'hui ; le lendemain, tant
  que le passage du jour n'a pas eu lieu, elle se sert de cette valeur comme estimation de la veille
  et le dit (« dernier jour estimé d'après la prévision », barre pâle dans le bilan). Le passage
  suivant la remplace par la valeur définitive. Fichiers d'avant (ni `f` ni `m`) : tout est définitif.
- Mise à jour progressive : déclenchement toutes les heures, budget de 2 500 appels pondérés par
  passage, plafonds glissants (4 000/h, 8 000/24 h, 240 000/30 j) gardés dans `.meteo-etat.json`,
  300 appels par minute au plus, arrêt net sur 429 (les machines de GitHub partagent leurs adresses
  IP). Chaque case est demandée une seule fois par jour (heure de Paris, champ `m`), pour les jours
  manquants + 2 jours relus (`past_days` ≤ 13 : 1 appel) ; une nouvelle case, 30 jours (2,2 appels).
  Le premier passage de la journée fait d'ordinaire tout le tour (9 minutes), les autres s'arrêtent
  en 10 secondes : ≈ 2 000 appels par jour, ≈ 60 000 par mois, soit un cinquième des limites, quel que
  soit le nombre de visiteurs. Premier remplissage (10 et 11/11/2026) : 4 366 appels, en deux passages.
- GitHub lance les tâches planifiées quand il peut : le 11/11/2026, la tâche prévue toutes les 2 h
  n'est passée que 3 fois (0 h 54, 9 h 49 et 18 h 02 UTC), et `surveillance.yml`, prévue à 4 h 17,
  passe en fait entre 11 h et 13 h. D'où le déclenchement horaire, la demande unique par jour et la
  journée provisoire : rien ne dépend de l'heure du passage.
- Depuis GitHub Actions, la connexion à Open-Meteo échoue souvent au premier essai (délai de connexion
  de 10 s de Node) : 5 essais de connexion (non comptés dans le budget), 3 envois au plus par requête
  (tous comptés), une requête abandonnée attend le passage suivant, 3 abandons de suite arrêtent le
  passage.
- État entre passages : cache Actions `meteo-<run_id>-<attempt>` (on restaure le plus récent), gardé
  seulement quand quelque chose a changé (`garder`) ; sans cache, on repart des fichiers du site en
  ligne (`--amorce`). `deploy.yml` restaure le même cache et réécrit les fichiers avec la liste des
  cases du dépôt (`--budget 0` : aucun appel) ; un tour complet relance `deploy.yml`
  (`actions: write`) ; un tour pas fini n'est publié qu'au bout de 6 h (pas de grille trouée en ligne).
- La carte se méfie de fichiers en retard de plus de 3 jours (`METEO_MAX_LATE_DAYS`) et interroge
  alors Open-Meteo elle-même ; `surveillance.yml` échoue si le dernier jour définitif a plus de 36 h
  (avant midi, avant-hier suffit ; ensuite il faut hier).
- GitHub suspend les tâches planifiées d'un dépôt public sans activité depuis 60 jours : la réactiver
  dans l'onglet Actions (la carte affiche « pluie connue jusqu'au … »).

## Serveur de mesure (`worker/`)

Cloudflare Worker + Durable Object à stockage SQLite (seul type de l'offre gratuite), une instance
« global ». `src/index.ts` : `POST /collect` (origine `ALLOWED_ORIGINS`, 8 Ko au plus, noms connus,
entiers sous le plafond de chaque compteur, jour à l'heure de Paris) ; `/<ADMIN_PATH>` : connexion
(mot de passe comparé en temps constant, 8 échecs par quart d'heure et par empreinte d'IP, 40 par
heure en tout), cookie de session HMAC (`HttpOnly; Secure; SameSite=Strict`, 30 jours, invalidé si le
mot de passe ou le chemin change), tableau de bord rendu côté serveur sans JavaScript
(`dashboard.ts`, CSP stricte, `noindex`), `export.json`. Tout autre chemin : 404. Totaux gardés
400 jours. Secrets : `ADMIN_PASSWORD` et `ADMIN_PATH` (12 caractères au moins chacun).

Publication (`deploy.yml`) : seulement si les secrets GitHub `CLOUDFLARE_API_TOKEN` et
`CLOUDFLARE_ACCOUNT_ID` existent ; l'étape recopie `ADMIN_PASSWORD` et `ADMIN_PATH` en secrets du
Worker et passe son adresse au build (`VITE_METRICS_URL`). Un échec côté Cloudflare ne bloque pas la
carte (`continue-on-error`). Vérifié le 01/11/2026 en CI : `wrangler deploy --dry-run` et `wrangler
dev` (wrangler 4.156, `@cloudflare/workers-types` 5). GitHub Pages ne doit pas recevoir de mot de
passe : la page privée est servie par le Worker.

Constaté le 14/11/2026 : le serveur de mesure n'est pas branché (`gh secret list` ne montre aucun
secret au dépôt, et le code en ligne ne contient aucune adresse de collecte) : la carte n'envoie donc
aucun compteur. Avant de le brancher, voir « Montée en charge » : chaque envoi écrit une ligne par
compteur, et l'offre gratuite de Cloudflare plafonne les lignes écrites par jour.

## Montée en charge : qui appelle quoi

Le site n'a pas de serveur à lui : chaque navigateur va chercher des fichiers et des tuiles, rien
n'est calculé ailleurs. Appels d'une visite (relevés le 14/11/2026 sur les vrais services, scénario
joué par un script : ouvrir la France, choisir un champignon, chercher un lieu, zoomer au niveau
10,5, déplacer la carte, zoomer au niveau 13, deux bilans ; téléphone 390 × 844, puis écran
1280 × 800) :

| Hôte | Quoi | Téléphone | Grand écran | Limite connue |
|---|---|---|---|---|
| GitHub Pages (le site) | code et styles (350 ko compressés), `foret/parts.json` (236 ko), 46 fichiers météo (343 ko : toute la France à l'ouverture), archives des sols et des zones lues par morceaux, `info.json` | ≈ 1,7 Mo, 70 requêtes | ≈ 1,8 Mo, 75 requêtes | limite souple de 100 Go par mois, soit de l'ordre de 55 000 visites de ce genre par mois ; « rate limits may apply » sans chiffre (réponse 429) ; site de 1 Go au plus ; pas fait pour un service commercial |
| IGN, Géoplateforme | fond de carte (images), BD Forêt (tuiles vectorielles, images en vue large), polices | ≈ 6,8 Mo, 65 requêtes | ≈ 13,5 Mo, 140 requêtes | aucune pour les tuiles (WMTS et TMS sont exclus des limites) |
| IGN, Géoplateforme | altitude (bilan, carrés de 500 m), recherche de lieu | 4 + 1 requêtes | 4 + 1 requêtes | par adresse IP : 5 requêtes par seconde (altitude), 10 (recherche), blocage de 5 s au-delà |
| Open-Meteo | rien en temps normal (la tâche `meteo.yml` fait ≈ 2 000 appels par jour, quel que soit le nombre de visiteurs) | 0 | 0 | secours seulement, depuis le navigateur du visiteur, si les fichiers météo ont plus de 3 jours |
| Cloudflare (mesure) | pas branché (voir « Serveur de mesure ») | 0 | 0 | offre gratuite : 100 000 requêtes par jour, 100 000 lignes écrites par jour, remise à zéro à minuit UTC |

À retenir :
- Le nombre de visiteurs ne charge aucun serveur du projet. La première limite est le trafic de
  GitHub Pages (souple : GitHub prévient par courriel et suggère un CDN) ; un pic soudain peut aussi
  recevoir des réponses 429, sans seuil publié.
- Les limites de l'IGN valent par adresse IP : chaque visiteur a la sienne. Des visiteurs derrière
  une même adresse (entreprise, école, certains réseaux mobiles) partagent les 5 requêtes par seconde
  de l'altitude : au-delà, les carrés de 500 m prennent l'altitude du carré de 4,5 km et le bilan
  dit l'altitude indisponible, la carte continue.
- Serveur de mesure, s'il est branché un jour : chaque envoi écrit une ligne par compteur non nul
  (13 compteurs sur la visite du scénario, un envoi par minute). À ≈ 25 lignes par visite
  (estimation, non mesurée), les 100 000 lignes par jour sont atteintes vers 4 000 visites par jour ;
  ensuite les compteurs sont perdus, la carte n'en souffre pas. Regrouper les compteurs en une seule
  ligne par envoi lèverait ce plafond.
- Si la tâche météo s'arrête (60 jours sans activité sur le dépôt, panne), chaque navigateur
  interroge Open-Meteo lui-même : à éviter à grande échelle (conditions d'Open-Meteo, voir « Limites
  connues ») ; `surveillance.yml` échoue dès 36 h de retard.
- Sources des limites, lues le 14/11/2026 : docs.github.com (GitHub Pages limits),
  developers.cloudflare.com (Workers limits, Durable Objects pricing), cartes.gouv.fr (limites
  d'usage de la Géoplateforme, page modifiée le 07/08/2026).

## Avertissement, conditions et droit de cueillir

- Changer `TERMS_VERSION` (`src/legal.ts`) dès que le texte de l'avertissement ou des conditions
  (`a-propos.html`) change : la carte redemande alors l'accord. Garder les deux textes cohérents, et
  regrouper les retouches de texte dans une seule version (un seul nouvel accord demandé).
- Accueil en deux fenêtres, jamais un carrousel. (1) L'avertissement (`disclaimer.ts`) reste une
  porte : bloquant, 3 s, un seul bouton « J'ai compris et j'accepte », accord enregistré à ce clic,
  ni points de progression ni « Suivant ». Moins de 100 mots, lisibles sans défiler à 1280 × 860 et
  390 × 844 (tests e2e) : les consignes de premier rang de l'Anses (connaître parfaitement, doute →
  pharmacien ou association, pas d'application, jamais aux jeunes enfants, qui appeler), le droit de
  cueillir, « estimation » et la responsabilité. Le reste des conseils (champignons entiers, panier,
  espèces séparées avec leur raison, photo, cuisson, quantités, numéros) est dans « À propos ».
  (2) « La carte en 3 gestes » (`tour.ts`) : libre (bouton, Échap, clic à côté ; fermetures ignorées
  une demi-seconde, contre le double appui), après un premier accord seulement (aucun accord gardé,
  ou version antérieure à `TOUR_SINCE` ; aucune clé de stockage en plus ; pas d'office si le
  navigateur refuse de garder l'accord, sinon elle reviendrait à chaque visite), retirée quand on
  quitte la carte, rejouable depuis la légende. Écran bas (téléphone couché) ou très étroit : le
  schéma se retire, la liste suffit. Son texte ne fait pas partie des conditions. Un schéma dessiné,
  pas une capture (illisible à cette taille, à refaire à chaque retouche) ; sur téléphone il n'y a ni
  gauche ni droite : on décrit les gestes.
- Textes vérifiés le 13/11/2026 : communiqué de l'Anses du 20/10/2026 (liste courte et bilan 2025),
  sa liste complète (article du 04/09/2025, d'où viennent cuisson, quantités, délai des symptômes et
  la raison de la séparation des espèces), Santé.fr ; numéro national (01 45 42 59 59) et numéros des
  huit centres antipoison (centres-antipoison.net, relevés les 03 et 13/11/2026 ; listés dans
  « À propos », l'avertissement dit seulement « le 15 ou un centre antipoison » : pas de numéro d'une
  région en particulier), article 547 du Code civil,
  articles L163-11 et R163-5 du Code forestier (réponse ministérielle, JO du 25/12/2012), LCEN
  article 1-1 (II) pour l'éditeur non professionnel anonyme (loi SREN de 2024), hébergeur GitHub, Inc.
- Wording : ne jamais écrire qu'un champignon est comestible, ni qu'un lieu est autorisé ; parler
  d'estimation ; la limitation de responsabilité vaut « dans les limites permises par la loi » (une
  clause ne peut pas écarter la responsabilité pour faute ou dommage corporel).
- Bilan d'un coin : ne dire « sans doute privée » que si les zones sont chargées (`info.json` lu,
  aucune erreur réseau, zoom ≥ 10, dans l'emprise) et qu'une forêt BD Forêt est sous le point.

## Nomenclature et règles

- Les 32 codes forêt sont dans `forestClasses.ts`. Toujours filtrer sur `code_tfv`, jamais sur `tfv`
  (libellés à variantes : « dun autre pin pur », apostrophes droites ou typographiques).
- Chênes : `FF1G01-01` (décidus), `FF1G06-06` (sempervirents, méditerranéens). Forêt fermée : couvert
  ≥ 40 % ; ouverte : 10 à 40 %. « Pur » : une essence ≥ 75 % du couvert.
- Natures de sol (`soils.ts`, mêmes identifiants que `scripts/geologie/regles.mjs`) : `calcaire`,
  `marne`, `limon` (limons des plateaux, lœss, argiles à silex : 12 % du pays, surtout Bassin parisien,
  Nord, Normandie), `gres`, `cristallin` (roches volcaniques comprises), `moraine`, `eboulis`, `humide`.
  Classement : le mot-clé qui apparaît le plus tôt dans `DESCR` l'emporte (la roche dominante est citée
  en premier) ; à position égale, l'expression la plus longue (« Coulées basaltiques » = roche
  volcanique) ; puis quelques corrections (pélites et siltites du socle ancien = sol acide, « Altérites
  de granite » = sol de granite). Réglé sur les 17 000 descriptions de France (`tests/geologie.mjs`) :
  99 % de la surface classée ; le reste n'est nommé que par un lieu ou un étage (« Assise des Carreaux »).
- Saisons larges exprès (cèpes de mai à décembre, chanterelles en tube jusqu'en février…) : c'est la
  température qui départage les régions (littoral atlantique et Midi plus tardifs que la montagne).
- Morilles : printemps (mars à juin, l'altitude passant par la température), hôtes `FF1-49-49`
  (frênaies…), `FP` (peupleraies), `FF1-00-00`, `FF1-00`, `FF0` (coupes, chablis), sapin-épicéa en
  montagne ; sols calcaires, alluvions, marnes. Fiche avec encadré gyromitre et cuisson.
- Indice (`mushrooms.ts`) : saison × pluie (délai depuis l'épisode ≥ 15 mm sur 3 jours, en trapèze
  propre à chaque champignon, + humidité sur 20 jours) × température (moyenne 7 jours à l'altitude,
  gel ≤ −1 °C) × arbre hôte × sol (le sol module : 0,4 + 0,6 × préférence). Niveaux : ≥ 0,5 favorable,
  ≥ 0,28 possible, ≥ 0,12 peu probable. Règles de cueilleur, pas un modèle validé : à recaler avec les
  retours de terrain.
- Chance estimée en % (`chanceOf`, choix du 12/11/2026) : l'indice ramené sur une échelle calée sur
  les niveaux (0,12 → 35 %, 0,28 → 50 %, 0,5 → 70 %, 1 → 95 %, linéaire entre deux). Seuil
  `CHANCE_THRESHOLD` = 50 % : en dessous, rien n'est mis en avant (pas d'étiquette, case presque
  effacée). Vue d'ensemble (zoom < 10) : pastilles `meteo-points` sur les 12 meilleurs secteurs de la
  vue, espacés ; à partir du zoom 10, pourcentage dans chaque carré ; bilan : « ≈ 62 % · possible ».
  Toujours écrire « estimée » ou « ≈ » : ce n'est pas une probabilité mesurée. Sur la carte, le
  pourcentage d'un carré vaut pour ses forêts hôtes (voir « Arbres hôtes ») ; un carré éteint n'est
  pas « sans champignon », un carré coloré n'est ni une promesse ni un droit de cueillir.

## Conventions

- Textes de l'interface et commentaires en français ; identifiants du code en anglais.
- Garder les couleurs officielles IGN pour les forêts ; la géologie est en motifs (pas de couleur)
  pour rester lisible par-dessus.
- DOM construit avec `h()` ; jamais d'`innerHTML` avec des données (seules les icônes SVG statiques).
- `localStorage` toujours dans un try/catch (navigation privée).
- Accessibilité : vrais `<input type="checkbox">`, interrupteurs `role="switch"`, `aria-*` à jour.
- Mobile : légende et bilan en tiroirs bas sous 640 px (un seul ouvert à la fois), boutons de 46 px.
- En développement, `window.map`, `window.store`, `window.spot` et `window.metrics` (totaux de la
  visite, `flush()`) sont exposés (console, tests e2e) une fois la vue Carte chargée (avant, `window.map`
  désigne la balise `<div id="map">`) ; `window.analytics` (`data`, `check()`, `render(contenu)`) une
  fois la vue Analytics chargée.
- Mesure : seulement des totaux par jour, jamais d'identifiant de visiteur ni de cookie ; envoi coupé
  si le navigateur signale « Global Privacy Control ». Le bilan lit la case météo commune (rien n'est
  envoyé à Open-Meteo) ; en secours seulement, coordonnées arrondies à 0,01° (vie privée). L'altitude
  IGN garde le point exact.
- Toute nouvelle clé `localStorage` commence par `foret-explorer:` (« Effacer mes données ») et prend
  un libellé dans `src/apropos.ts`.
- Actions GitHub épinglées sur leur identifiant de commit (`# vX.Y.Z` en commentaire), mises à jour par
  Dependabot (une fois par semaine, versions d'au moins 7 jours). Nouveau compteur : l'ajouter dans
  `metricsSchema.ts` (avec son plafond par envoi), puis `track()` au bon endroit.
- Chaque fiche champignon rappelle que l'indice ne dit pas ce qui se mange ; une espèce ajoutée
  prend un champ `caution` si elle a un sosie dangereux, et un champ `sheet` (fiche MycoDB de
  l'espèce nommée, vérifiée à la main).
- Mots à ne pas écrire dans l'interface : « comestible », « garanti », « autorisé », « probabilité »
  (sauf « pas une probabilité mesurée »), « trouvez ». Un même mot par chose : « chance estimée »
  pour tout pourcentage, « Droit de cueillir » des deux côtés, « carrés ».

## Limites connues

- BD Forêt photo-interprétée de 2007 à 2018 selon les départements : coupes et scolytes récents absents.
- Pas de filtrage des forêts sous le zoom 10 ; sol connu à partir du zoom 10 dans le bilan.
- Géologie : elle donne la tendance du sol, pas le sol exact (moraines décalcifiées, placages, limons
  minces…) ; 1 % du pays reste sans sol (formations nommées sans leur roche). Elle dépend d'un miroir
  personnel des cartes du BRGM (data.cquest.org) : si le cache des tuiles est perdu pendant une panne
  du miroir, la publication échoue (le site en ligne reste tel quel).
- Météo : modèles (pas de pluviomètres), une série par case de 18 km relevée en un point : un orage
  local ou un versant plus arrosé peuvent manquer (en montagne surtout) ; dans le bilan, températures
  ramenées à l'altitude exacte du point ; dans les carrés de 4,5 km et de 500 m, à l'altitude de leur
  centre. Fichiers mis à jour une fois par jour, à une heure que GitHub choisit (souvent la nuit,
  parfois en fin de matinée) : en attendant, la veille est une estimation tirée de la prévision.
- GitHub Pages : site de ≈ 170 Mo (limite : 1 Go ; publication abandonnée au bout de 10 minutes, d'où
  les archives PMTiles), republié chaque jour avec la météo ; les tâches planifiées prennent du retard
  et s'arrêtent après 60 jours sans activité sur le dépôt.
- Tuiles des sols et des zones jusqu'au zoom 11 seulement (sur-zoom au-delà) : limites précises à
  quelques mètres, ce que valent les données ; l'archive des sols fait 143 Mo d'un seul tenant.
- Mesure de consommation : compteurs envoyés par les navigateurs, donc ordres de grandeur (hors
  réseau, GPC ou page fermée brutalement : pas comptés) ; l'adresse de collecte est publique.
- Comptages des forêts sur les tuiles chargées (débordent un peu de l'écran).
- Recherche non biaisée vers la zone affichée.
- Deux vues : tant que l'avertissement est à l'écran, l'îlot ne répond pas (il faut l'accepter, ou
  arriver par `#vue=analytics`). Quitter la carte par l'îlot moins de 0,3 s après un déplacement peut
  laisser l'ancienne position dans l'entrée de l'historique (seul Précédent la retrouve). Entre 641 et
  1187 px de large, l'îlot n'est pas centré. Graphiques de la vue Analytics : une série de barres
  (ni courbe ni comparaison de deux séries).
- Arbres hôtes des carrés : BD Forêt de 2007 à 2018 ; seuils (10 % d'hôtes, 15 % de bâti, 3 points
  sur 9) choisis à l'œil sur Nancy, Annecy, Lyon, Paris, Limoges et Toulouse. Un carré de 4,5 km qui
  contient un village reste coloré s'il est assez boisé (tout carré de France en contient un) ; un
  vrai massif collé à une ville (Versailles, Fontainebleau-ville) s'éteint à cette échelle et ne se
  retrouve qu'aux carrés de 500 m ; en ville, un bois de moins de trois carrés de 500 m n'est pas
  montré. Pour les chanterelles en tube (hôtes surtout résineux) la carte se vide en plaine de
  feuillus. Part bâtie : zones généralisées du Plan IGN au zoom 10, pas les bâtiments un à un.
- Accueil : tant qu'une de ses deux fenêtres est ouverte, l'îlot ne répond pas ; sans stockage du
  navigateur, l'avertissement revient à chaque visite et la présentation n'est pas montrée d'office ;
  sur téléphone, une fois fermée, la légende reste fermée et rien à l'écran ne dit de choisir un
  champignon. Rien n'a été essayé sur un vrai téléphone ni avec un lecteur d'écran.
- Fluidité : sans carte graphique (machine virtuelle, vieux téléphone), choisir un champignon à partir
  du zoom 10 prend encore plus d'une seconde, à cause du filtre des forêts (voir « Fluidité »).
  Mesures faites dans Chromium sans carte graphique seulement, pas sur un vrai téléphone.
- Montée en charge : première limite, le trafic de GitHub Pages (voir « Montée en charge ») ; aucun
  essai de charge n'a été fait, les chiffres viennent d'une visite jouée par un script.
- Carrés de 4,5 km : pas de facteur de sol (inconnu à cette échelle), donc un pourcentage souvent
  au-dessus de celui des carrés de 500 m et du bilan au même endroit. Non couvert par les tests : la
  vue zoomée où le relevé fin ne trouve aucun arbre hôte (`fineDone` sans carré fin).
- MycoDB : site tiers tenu par des bénévoles ; un renommage d'espèce casse le lien sans erreur
  visible ; la fiche qualifie la comestibilité, ce que le site s'interdit d'écrire lui-même.
- Mentions légales : `a-propos.html` présente l'éditeur comme un particulier non professionnel qui ne
  publie pas son identité, alors que la vue Analytics porte un lien vers son profil LinkedIn ; et
  Open-Meteo réserve son API gratuite aux usages non commerciaux (ses conditions rangent les
  « promotional activities » parmi les usages commerciaux). À trancher par l'éditeur.

## Pistes pour la suite

1. Ajouter les points de rencontre des secours en forêt (PRSF) ; outre-mer (BD Forêt et zones existent,
   pas la météo commune ni la géologie harmonisée).
2. Météo plus fidèle en montagne sans plus d'appels : moyenne de 2 ou 3 points par case là où le
   relief est fort (la moyenne de tous les points d'une case gagnait 2 à 3 points de justesse). Les
   températures suivent déjà l'altitude de chaque carré de 4,5 km ; reste la pluie, la même dans
   toute la case.
3. Recaler l'indice avec des sorties réelles (journal de cueillette : date, lieu, trouvé ou non), et
   recaler alors l'échelle des pourcentages (`chanceOf`).
4. Prévisions : ajouter `forecast_days` pour annoncer les jours favorables à venir.
5. Export GeoJSON/GPX des polygones sélectionnés (WFS + `CQL_FILTER`) pour une appli hors ligne.
6. Sélection dans l'URL (`#carte=…&types=…`) pour partager une vue.
7. Mode hors ligne (PWA + cache de tuiles) pour les zones sans réseau.
8. Exposition des versants (nord/sud) à partir du relief IGN, et enneigement pour les morilles.
9. Servir les fichiers météo ailleurs que dans le site (branche de données, Worker) pour ne plus
   republier 170 Mo chaque jour.
10. Garder une copie des tuiles géologiques dans une release du dépôt (si le miroir disparaît).
11. Vue Analytics : brancher l'entonnoir en direct (mesure et consentement à décider), puis une
    courbe ou une seconde série dans les graphiques quand une analyse en a besoin.
12. Téléphone : ouvrir la légende à la fermeture de la présentation, et faire dire « Choisissez un
    champignon » au bandeau du haut tant qu'aucun n'est choisi.
13. Liens vers les fiches des sosies dangereux, et mesurer la part des visites qui ouvrent un bilan
    avant et après la refonte (les compteurs `app.sessions` et `app.spots` existent déjà).
14. Filtre des forêts sans refaire les tuiles : une couche par type de forêt, à opacité constante
    (allumer ou éteindre un type ne changerait alors qu'une valeur, sans rien recharger). Gros
    chantier : `bdforet-fill` est lu partout (clics, comptages, tests).
15. Si le trafic approche la limite de GitHub Pages : un CDN devant le site, ou les archives de
    tuiles et les fichiers météo servis ailleurs (voir aussi la piste 9) ; serveur de mesure : une
    seule ligne écrite par envoi au lieu d'une par compteur.
