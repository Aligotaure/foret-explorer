# Données, services et montée en charge

Notes détaillées, sorties telles quelles de `CLAUDE.md` le 16/11/2026 : Claude Code ne les lit qu'à la
demande (index dans `CLAUDE.md`, « Avant de toucher à…, lire »). Un renvoi « voir « Titre » » désigne
une section de ce dossier.

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
  `patrinat_apb:apb`, `patrinat_aphn:aphn`, `patrinat_cen:cen` (champs `nom_site`, `url_fiche` vers
  l'INPN, `id_mnhn`) ; `CONSERVATOIRE_LITTORAL.PARCELLES:parcelles_protegees` (terrains du Conservatoire
  du littoral, une parcelle cadastrale par objet ; `PROPERTYNAME=pera_id,pera_nom,type_maitrise,geom` :
  site, nom en capitales presque sans accents, « Propriété » ou « Contrats de gestion » ; pas de fiche
  INPN) ; `BDTOPO_V3:foret_publique` (`nature` : Forêt
  domaniale / Autre forêt publique, `toponyme`, source ONF 2021). Requête : `OUTPUTFORMAT=application/json`,
  `SRSNAME=EPSG:2154`, `BBOX=41.2,-5.3,51.2,9.7,urn:ogc:def:crs:EPSG::4326` (lat/lon en WFS 2.0 ; toute
  la France métropolitaine), `COUNT=5000` + `STARTINDEX`. France entière (03/11/2026) : 151 RNN, 191 RNR,
  18 périmètres de protection, 267 réserves biologiques, 8 cœurs de parc national, 1 062 arrêtés de
  biotope, 26 arrêtés d'habitats naturels, 2 552 sites des CEN ;
  17 071 forêts publiques (1 285 domaniales ; 360 Mo de GeoJSON). Conservatoire du littoral
  (16/11/2026) : 63 895 parcelles (99 Mo de GeoJSON), 641 sites, 148 994 ha, dont 108 685 possédés et
  40 264 gérés sans être possédés (contrats de gestion ; 46 ha sans type, tenus pour gérés), soit
  847 terrains une fois fusionnés par site et par type (599 `cdl`, 248 `cdl_gestion`). Tuiles : une archive
  `data/zones/zones.pmtiles`, zooms 9 à 11 (sur-zoom au-delà), 4 142 tuiles, 24 Mo. Construction
  dans GitHub (16/11/2026, Ubuntu 26.04) : 5 min, dont 3 min 54 s de téléchargements (1 min pour les
  parcelles du Conservatoire), 20 s pour la fusion et 31 s de découpage.
  **Refaite une fois par an** (`deploy.yml`, demande de Clément du 16/11/2026 : les zones bougent
  peu ; avant, chaque semaine) : seulement si l'archive a 365 jours ou plus (date `genere` de son
  `info.json`), si les scripts de `scripts/zones/` ont changé depuis (toute retouche, même d'un
  commentaire, relance la reconstruction), ou s'il n'y en a nulle part. Gardée dans le cache
  d'Actions sous un nom par exécution (`zones-tuiles-<empreinte des scripts>-<exécution>`) ; cache
  perdu : reprise du site en ligne (24 Mo), sans appeler le WFS. Une reconstruction ratée laisse
  l'archive précédente en place et est retentée à chaque publication ; `surveillance.yml` échoue
  quand l'archive en ligne a plus de 13 mois (395 jours).
  **Conservatoire du littoral : parcelles au lieu des sites de PatriNat** (16/11/2026). La couche
  `patrinat_cdl:conservatoire_littoral` (623 sites, avec fiche INPN) a disparu du WFS entre le 11 et le
  16/11/2026 (HTTP 400 « Unknown namespace [patrinat_cdl] », absente des GetCapabilities), et la
  reconstruction échouait. Les parcelles protégées l'ont remplacée, vérifiées contre l'archive du
  11/11/2026 (`cdl` découpé à ses tuiles du zoom 11, 20 000 points tirés de part et d'autre) :
  98,7 % de l'ancienne surface (143 227 ha) est dans les parcelles, et 96,2 % des parcelles y étaient
  déjà, contrats de gestion compris (98,4 %) : l'ancienne couche disait donc « Propriété publique »
  du Vaccarès et des îles Chausey, que le Conservatoire gère sans les posséder. 616 des 622 anciens
  noms retrouvés tels quels, 6 renommés ou regroupés ; 23 noms nouveaux (743 ha), dont 17 protégés
  en 2024-2026. Fusion dans `construire.sh` (SQL de SpatiaLite) : par site et par type, sinon chaque
  parcelle serait tracée en rouge ; chaque parcelle dilatée d'un mètre puis le terrain resserré
  d'autant, car des parcelles voisines laissent des interstices de moins d'un mètre (≈ 30 km de bords
  sur un quart des parcelles, mesuré le 16/11/2026), qui deviendraient de fins trous cernés de rouge ;
  la construction échoue si un terrain perd sa géométrie. Archive ainsi reconstruite le 16/11/2026
  (tuiles du zoom 11) : 148 756 ha (108 478 possédés, 40 277 gérés), 639 noms ; 14 878 contours
  extérieurs contre 14 364 avant (sans la fusion, il y en aurait plus de 64 000) ; trous de moins de
  3 m de large en moyenne : 129 km de contours, contre 133 km dans l'archive du 11/11/2026.
  Étiquette : dans la plus grande parcelle du site. Noms : capitales converties (`capitales` de `telecharger.mjs` : « ILES CHAUSEY » →
  « Iles Chausey », « -DE- » → « -de- »). Pas de lien : la couche n'en donne pas, l'INPN refuse les
  scripts (403), et les numéros des pages du site du Conservatoire (`/siteLittoral/<n>/…`) ne sont pas
  les `pera_id` (Agriate : 42 contre 50). Aussi listée : `CONSERVATOIRE_LITTORAL.PERIMETRES:perimetre_intervention`
  (722 périmètres où le Conservatoire peut acquérir : pas des terrains protégés, à ne pas prendre).
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
  ⚠ Le côté de la couche (`extent`) n'est pas toujours de 4 096 unités : 9 tuiles des Alpes du Nord
  (Grenoble, Chambéry, Albertville) en ont 256 à 2 048 pour `bati_zone_surf`. Compter les aires en
  fraction de tuile, jamais en unités (sinon Grenoble ressort bâtie à 1 % au lieu de 89 %). Et une
  tuile peut revenir vide une fois puis pleine (Loiret, le 14/11/2026) : le script retente, ne garde
  pas une tuile vide et le signale.
- **WFS BD Forêt** (pas utilisé, utile pour un export) : `https://data.geopf.fr/wfs`,
  `TYPENAMES=LANDCOVER.FORESTINVENTORY.V2:formation_vegetale`, `OUTPUTFORMAT=application/json`,
  `CQL_FILTER` et `PROPERTYNAME` acceptés. Avec GeoServer, `BBOX=` et `CQL_FILTER=` ne se combinent
  pas : mettre la boîte dans le CQL.

## Coupes datées (`scripts/coupes/`, `src/cuts.ts`)

Ajout du 25/11/2026 (demande de Clément : tenir compte de l'âge des arbres ; plan arrêté avec lui).
La BD Forêt date de 2007 à 2018 : une forêt coupée, brûlée ou abattue depuis y est encore une forêt
en place.

- **Source** : European Forest Disturbance Atlas (Viana-Soto, Senf et al.), version 3.0.0 du
  13/09/2026, publié sur Zenodo (fiche 21722408 ; toutes versions : doi 10.5281/zenodo.8389085),
  CC BY 4.0, sans compte. Satellites Landsat, pixels de 30 m, EPSG:3035, de 1985 à 2024. Une seule
  couche est lue, « année de la dernière perturbation » (`latest_disturbance_france_v30.tif`, coupe,
  tempête, scolytes ou incendie) : 49 Mo dans une archive `France.zip` de 5,2 Go, repérée dans la
  table des matières de l'archive et demandée par plage d'octets (HTTP « Range »).
- **Pièges** : Zenodo refuse le nom de client que Node donne d'office (HTTP 403, « unusual
  traffic ») : le script se nomme `script-de-donnees/1.0`, sans rien qui désigne le site. Le nom de
  la couche porte la version (`_v30`) : elle est cherchée par motif. La dernière version se lit à
  `…/api/records/21722408/versions/latest`. Aucune dépendance : lecteur d'image TIFF (tuiles LZW ou
  Deflate, prédicteur), projection EPSG:3035 et lecteur d'archive zip (zip64) sont écrits dans
  `scripts/coupes/`, et éprouvés par `tests/coupes.mjs` sur une image et une archive fabriquées.
- **Fichiers** (`public/data/coupes/`, non versionnés) : `index.json` (grille, `depuis` et `jeune` :
  bornes des deux périodes, `dernierAn`, `genere`, `atlas`, liste des blocs) et `b/<bloc>.json`
  (blocs de 8 × 8 cases communes, comme la météo). Par case, ses 16 × 81 carrés de 500 m en trois
  caractères chacun, soit 18 bits : les neuf points que la carte relève dans un carré (`FINE_OFFSETS` de
  `fineRule.ts`, sud → nord puis ouest → est), d'abord « récent » (moins de 10 ans l'année de la
  fabrication : 2017 et après), puis « jeune » (10 à 20 ans : 2007 à 2016). Une case sans point daté
  est absente. La carte refuse un index d'un autre format ou d'une autre grille.
- **Mesuré le 25/11/2026** : 45 blocs, 7,4 Mo, 679 Ko compressés (82 Ko pour le plus gros) ;
  2 388 123 carrés lus, 207 410 avec au moins un point récent, 181 698 avec au moins un point jeune ;
  7 s de calcul, 28 s téléchargement compris. Les fichiers faits par le script depuis Zenodo sont
  identiques, octet pour octet, à ceux faits à partir de l'image téléchargée à la main.
- **Refaits une fois par an** (`deploy.yml`), comme les zones : cache d'Actions sous un nom par
  exécution ; cache perdu : reprise du site en ligne (`reprendre.mjs`, sans rien demander à Zenodo) ;
  refaits s'ils ont 365 jours, si `scripts/coupes/` ou `public/foret/parts.json` ont changé, ou s'il
  n'y en a nulle part. Une reconstruction ratée laisse les fichiers précédents ; sans aucun fichier,
  la publication écrit un index sans bloc (`construire.mjs --vide` : la carte demande l'index, et un
  fichier absent laisserait une erreur 404 dans la console). `surveillance.yml` échoue quand les
  fichiers en ligne ont plus de 13 mois, ou pas de date.
- **Dans la carte** : demandés en même temps que la météo quand des carrés de 500 m vont être
  dessinés (mode indice, zoom `FINE_MIN_ZOOM` et plus), attendus `CUTS_WAIT_MS` (2 s) au plus, puis
  gardés pour la visite ; demandés aussi à l'ouverture d'un bilan sous une forêt. Aucun dessin en
  plus (le facteur change `p` et `l`, rien d'autre). Absents ou en panne : la carte fait sans.
  Compteurs `pages.coupes` et `pages.coupes.errors`. Règles de l'indice : voir « Coupes récentes ».
- **Ce que vaut la donnée** (mesures du 25/11/2026 sur l'image entière ; forêt de référence : celle
  de la BD Forêt, 17,86 Mha d'après `parts.json`) : 3,55 Mha portent une date, soit 19,9 % de la
  forêt (6,9 % de 2015 à 2024, 4,7 % de 2005 à 2014, 8,3 % de 1985 à 2004). 2000 ressort (171 000 ha,
  après les tempêtes de décembre 1999), 2022 aussi (203 000 ha) ; 1985 et 1986 sont anormalement
  hautes (146 000 et 132 000 ha, cause non établie). Sur les 20 815 carrés de 4,5 km boisés à 10 %
  ou plus et bâtis à moins de 15 %, le carré médian a 3,4 % de sa forêt datée depuis 2015 ; 764 en
  ont un quart ou plus (Landes, Limousin, Morvan surtout).
  **Contrôle sur photos** : dix pixels datés de 2016 à 2020, tirés au hasard (graine fixe), comparés
  aux photos aériennes de l'IGN par millésime : huit coupes réelles (dont une datée au moins trois
  ans trop tard, et une simple rangée d'arbres), deux fausses alertes (une forêt restée debout, une
  prairie). Dix points ne mesurent pas un taux ; les auteurs annoncent 18,4 % de fausses alertes et
  19,8 % d'événements manqués. La couche des causes de l'atlas (47,5 % récolte, 33,9 % tempête ou
  scolytes, 9,2 % incendie, 9,4 % mêlées) ne trie pas les fausses alertes : elle n'est pas lue.
  **« Sans date » ne veut pas dire « vieille forêt »** : la forêt a progressé de plus de 20 % depuis
  1985 (ministère, « Milieux forestiers en France, état des connaissances en 2025 ») ; ces bois
  jeunes, jamais coupés, sont invisibles pour l'atlas. Scripts de mesure et planches du contrôle :
  hors dépôt (`.cache/efda/` de la copie de travail de Clément).

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
  fait la grille à partir du zoom 10 (en deçà, la case et sa pastille prennent l'indice de son meilleur
  carré, à l'altitude de ce carré), et le bilan d'un coin avec l'altitude exacte.
- `data/meteo/france.json` : moyennes de France par champignon, écrites à chaque publication (voir
  « Choisissez un champignon et moyenne de France »), pas par la tâche météo.
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
- `surveillance.yml` et Open-Meteo (15/11/2026). Le 14/11 elle a échoué : trois délais de connexion de
  30 s vers Open-Meteo, tout le reste répondait. Le 15/11 elle est restée 10 minutes sur Open-Meteo
  sans rien écrire, jusqu'à son annulation, sans contrôler ni le site ni la météo commune. Reproduit
  en local avec le curl de GitHub (8.18) : à une réponse 429 portant « Retry-After: 3600 »,
  `curl --retry` attend une heure, et `-s` masque son avertissement (ce qu'Open-Meteo a répondu ce
  jour-là n'est pas connu). Depuis : chaque vérification est bornée (`demander` : 10 s pour se
  connecter, 30 s par essai, 5 essais, plus aucun passé une minute avec `--retry-max-time`, arrêt de
  force à 100 s), donc la tâche va toujours au bout ; et Open-Meteo injoignable depuis GitHub (pas de
  réponse, 429, 5xx) ne donne qu'un avertissement, la tâche reste verte : la carte ne l'appelle qu'en
  secours, et c'est le retard de la météo commune qui fait échouer la tâche. Une réponse inattendue
  d'Open-Meteo (autre code, texte attendu absent) reste une erreur, comme toute panne des autres
  services. Éprouvé contre un faux serveur local (21 cas : 429 avec et sans attente, 503, panne
  passagère, serveur muet, connexion impossible, curl bloqué ; l'ancien fichier y reste bloqué) ; ces
  essais ne sont pas dans le dépôt.
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

## Mesure d'usage (PostHog, `src/tracking.ts`)

Demande de Clément du 15/11/2026 : mesurer l'usage du site avec PostHog et le montrer dans la vue
Analytics, qui lui sert de vitrine. Codée le 27/11/2026, **pas en service** : `deploy.yml` ne fournit
pas `VITE_POSTHOG_KEY`, donc le site en ligne ne télécharge pas la bibliothèque et n'envoie rien. La
mise en service demande, ensemble : le texte « Confidentialité » d'`a-propos.html` (donc une nouvelle
`TERMS_VERSION`), un interrupteur de refus, et la clé passée au build.

Choix :
- **Cloud UE** de PostHog (Francfort) : envois vers `https://eu.i.posthog.com`, adresse écrite dans
  le code, pas réglable. PostHog, Inc. et son hébergeur sont américains : dire « hébergé dans
  l'UE », pas « souverain ».
- **Mode sans cookie** (`cookieless_mode: 'always'`) : rien n'est écrit dans le navigateur, rien n'y
  est lu pour la mesure. D'après la documentation de PostHog, ses serveurs reconnaissent une visite
  par une empreinte qui change chaque jour : pas de visiteur reconnu d'un jour à l'autre, donc pas de
  rétention. Elle viendrait avec un choix accepter / refuser (seconde étape, pas codée).
- **La bibliothèque `posthog-js`**, pas un envoi écrit à la main : le mode sans cookie n'est
  documenté que pour elle (constaté pendant le cadrage, en novembre 2026). Variante `dist/module.no-external` : elle ne
  télécharge jamais de code depuis PostHog. Dépendance ajoutée avec l'accord de Clément le
  27/11/2026 ; ≈ 132 ko compressés, dans un fichier à part.
- **Chargée à la demande** (`startTracking`) : au premier repos de la carte, ou quand la vue
  Analytics est dessinée, ou au bout de 8 s si la vue tarde (`src/main.ts`). Les gestes faits avant
  attendent en mémoire (50 au plus) avec leur heure ; l'ouverture de la page est envoyée à la main,
  datée du moment où elle a eu lieu, pour que l'ordre des étapes d'un entonnoir reste le bon. Une
  visite quittée avant l'arrivée de la bibliothèque n'est pas comptée.
- **Coupé** : tout ce que la bibliothèque relève d'elle-même (clics, erreurs, performances,
  enregistrement d'écran, sondages, drapeaux), et les profils de personnes (`person_profiles: 'never'`).

Plan de tracking (type `TrackedEvents`, validé par Clément le 27/11/2026) :

| Événement | Geste | Propriétés |
|---|---|---|
| `$pageview` | ouverture de la page | adresse sans sa partie « # », page d'origine, `utm_*` |
| `avertissement_accepte` | « J'ai compris et j'accepte » | |
| `champignon_choisi` | puce d'un champignon (légende, bandeau, suggestion) | `champignon`, `hors_saison` |
| `bilan_ouvert` | clic sur la carte | `niveau` : celui du champignon recherché, sinon le meilleur ; `inconnu` si le bilan est quitté avant la météo |
| `y_aller_ouvert` | « Y aller » déplié | |
| `navigation_choisie` | Google Maps, Waze ou Plans : l'activation | `appli`, `niveau` |
| `coordonnees_copiees` | « Copier les coordonnées » | |
| `contact_clique` | lien de contact de la vue Analytics | |

Chaque envoi porte `vitrine` (visite ouverte par un lien `?analytics`) : à exclure des analyses des
cueilleurs. `avertissement_accepte` n'existe que pour qui voit l'avertissement (premier accord, ou
nouvelle version des conditions) : rien n'est lu dans le navigateur pour distinguer les autres.

Ce qui ne part jamais, et comment :
- la position de la carte (`#carte=zoom/lat/lon`) : option `disable_capture_url_hashes`, puis `clean`
  (`before_send`), qui coupe au « # » toute adresse d'un envoi ;
- les coordonnées d'un coin, le texte d'une recherche : aucun événement ne les porte ;
- les identifiants de clic des régies publicitaires (`fbclid`, `gclid`…), que la bibliothèque relève
  d'elle-même dans l'adresse : `clean` ne laisse passer que les propriétés de la bibliothèque (nom en
  « $ »), les `utm_*` et celles du plan (liste `KEPT`) ;
- rien du tout sous « Global Privacy Control » (`privacySignal`, la règle de `src/metrics.ts`) : la
  bibliothèque n'est même pas téléchargée.

Ce que la bibliothèque ajoute à chaque envoi (relevé le 27/11/2026 dans Chromium, version 1.453.1) :
système, navigateur et sa version, type d'appareil, fuseau horaire, langue, taille de l'écran et de
la fenêtre, chaîne complète du navigateur (`$raw_user_agent`), hôte, chemin, adresse sans « # »,
page d'origine, titre de la page. À décrire dans « Confidentialité » à la mise en service.

Pour ajouter un événement : une ligne dans `TrackedEvents`, ses propriétés dans `KEPT`, `capture()`
au bon endroit, une vérification dans `tests/e2e/tracking.mjs` (qui refuse toute propriété hors du
plan), et sa description dans « À propos » une fois la mesure en service.

Tests : groupe e2e `mesure` (`tests/e2e/tracking.mjs`), sur un second serveur Vite construit avec une
clé fictive (`startTrackingServer`, cache `node_modules/.vite-mesure`) ; tout envoi vers posthog.com
est intercepté, rien ne sort de la machine. La bibliothèque jette les événements d'un navigateur
piloté par un programme (adresse du navigateur, marque « HeadlessChrome », `navigator.webdriver`) :
le groupe masque les trois. Les autres groupes tournent sans clé, comme le site en ligne.
`tests/build.mjs` vérifie que la bibliothèque reste un fichier chargé à la demande.

Pas vérifié au 27/11/2026 : que PostHog accepte ces envois (aucun projet UE n'existe encore ;
Clément le crée, c'est invérifiable depuis la machine). Dans ce projet, activer « Enable cookieless
tracking » (Settings > Project > Web analytics) : la documentation de PostHog dit que, sans ce
réglage, les événements sans cookie sont jetés. Faits et sources du cadrage (hébergement, offre
gratuite, CNIL) : relevés le 15/11/2026, à revérifier avant de les citer à un client.

## Montée en charge : qui appelle quoi

Le site n'a pas de serveur à lui : chaque navigateur va chercher des fichiers et des tuiles, rien
n'est calculé ailleurs. Appels d'une visite (relevés le 14/11/2026 sur les vrais services, scénario
joué par un script : ouvrir la France, choisir un champignon, chercher un lieu, zoomer au niveau
10,5, déplacer la carte, zoomer au niveau 13, deux bilans ; téléphone 390 × 844, puis écran
1280 × 800) :

| Hôte | Quoi | Téléphone | Grand écran | Limite connue |
|---|---|---|---|---|
| GitHub Pages (le site) | code et styles (350 ko compressés), `foret/parts.json` (236 ko le jour du relevé ; 320 ko depuis le 25/11/2026), 46 fichiers météo (343 ko : toute la France à l'ouverture), archives des sols et des zones lues par morceaux, `info.json` | ≈ 1,7 Mo, 70 requêtes | ≈ 1,8 Mo, 75 requêtes | limite souple de 100 Go par mois, soit de l'ordre de 55 000 visites de ce genre par mois ; « rate limits may apply » sans chiffre (réponse 429) ; site de 1 Go au plus ; pas fait pour un service commercial |
| IGN, Géoplateforme | fond de carte (images), BD Forêt (tuiles vectorielles, images en vue large), polices | ≈ 6,8 Mo, 65 requêtes | ≈ 13,5 Mo, 140 requêtes | aucune pour les tuiles (WMTS et TMS sont exclus des limites) |
| IGN, Géoplateforme | altitude (bilan, carrés de 500 m), recherche de lieu | 4 + 1 requêtes | 4 + 1 requêtes | par adresse IP : 5 requêtes par seconde (altitude), 10 (recherche), blocage de 5 s au-delà |
| Open-Meteo | rien en temps normal (la tâche `meteo.yml` fait ≈ 2 000 appels par jour, quel que soit le nombre de visiteurs) | 0 | 0 | secours seulement, depuis le navigateur du visiteur, si les fichiers météo ont plus de 3 jours |
| Cloudflare (mesure) | pas branché (voir « Serveur de mesure ») | 0 | 0 | offre gratuite : 100 000 requêtes par jour, 100 000 lignes écrites par jour, remise à zéro à minuit UTC |
| PostHog (mesure d'usage) | pas en service (voir « Mesure d'usage ») | 0 | 0 | offre gratuite : 1 000 000 d'événements par mois (page de tarifs de PostHog, lue le 15/11/2026) |

À retenir :
- Le nombre de visiteurs ne charge aucun serveur du projet. La première limite est le trafic de
  GitHub Pages (souple : GitHub prévient par courriel et suggère un CDN) ; un pic soudain peut aussi
  recevoir des réponses 429, sans seuil publié.
- Les limites de l'IGN valent par adresse IP : chaque visiteur a la sienne. Des visiteurs derrière
  une même adresse (entreprise, école, certains réseaux mobiles) partagent les 5 requêtes par seconde
  de l'altitude : au-delà, les carrés de 500 m prennent l'altitude du carré de 4,5 km et le bilan
  dit l'altitude indisponible, la carte continue.
- Depuis le 14/11/2026 l'altitude n'est plus demandée que là où une estimation est possible : carrés
  de 500 m à dessiner pour le champignon montré (plus toute forêt de la vue), bilan d'un coin où au
  moins un champignon peut être estimé (pas en ville, hors forêt hôte ni hors saison). Le relevé du
  tableau (4 requêtes d'altitude) date d'avant ; il n'a pas été refait.
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
