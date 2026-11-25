# Fluidité de la carte

Notes détaillées, sorties telles quelles de `CLAUDE.md` le 16/11/2026 : Claude Code ne les lit qu'à la
demande (index dans `CLAUDE.md`, « Avant de toucher à…, lire »). Un renvoi « voir « Titre » » désigne
une section de ce dossier.

## Fluidité : ce que coûte un changement sur la carte

Mesuré le 14/11/2026 (Chromium sans carte graphique, comme une machine virtuelle ou un vieux
téléphone ; vraies données, 1280 × 800 ; fil principal occupé et images redessinées, relevés par le
profileur du navigateur et l'événement `render` de MapLibre). Un clic sur un champignon :

| Vue | Avant | Après |
|---|---|---|
| France entière (zoom 5) | 1,2 à 1,4 s, 20 à 22 images | 0,4 à 0,5 s, 4 images |
| Lyon (zoom 9) | 1,1 à 1,3 s, 12 à 15 images | 0,4 à 0,5 s, 4 à 5 images |
| Annecy (zoom 11) | 1,8 s, 6 à 8 images | 1,2 à 1,5 s, 4 à 6 images |
| Forêt (zoom 13, carrés de 500 m) | 1,0 s, 9 à 10 images | 0,5 s, 3 images |

Le code du site n'y pèse presque rien (5 à 100 ms) : le temps part dans MapLibre. Deux faits à
garder en tête avant de toucher à la grille (`meteoLayer.ts`, `mapStyle.ts`) :
- chaque arrivée de tuiles fait redessiner la carte, et sans carte graphique chacune de ces images
  occupe le fil principal 0,1 à 0,3 s (0,1 s à Lyon au zoom 9, 0,26 s à Annecy au zoom 11) ;
- MapLibre refait toutes les tuiles d'une source dès qu'on change son contenu (`setData`), un filtre,
  ou une propriété de dessin dont l'expression lit une propriété des objets (`['get', …]`). Une
  propriété constante (opacité fixe) ne refait rien.

D'où les règles : les carrés ne portent que les valeurs du champignon montré sous des noms fixes
(`l`, `p`, `c` : changer de champignon ne change plus aucune expression, un test le vérifie), et rien
de tout cela en mode pluie ; un carré éteint n'est pas envoyé ; un contenu identique au précédent
n'est pas renvoyé (`setSource`) ; au changement de mode ou de champignon, la grille et les carrés de
500 m sont redessinés dans l'instant à partir du dernier relevé gardé (`redraw()`, `data`,
`fineData`), sans attendre le réseau ni le repos de la carte (sinon ils montrent les valeurs de
l'ancien champignon sous le nom du nouveau ; les 0,5 s d'attente ne servent qu'aux déplacements) ;
les carrés de 500 m sont redessinés au plus toutes les 1,2 s pendant
que leurs altitudes arrivent ; pas de fondu des étiquettes (`fadeDuration: 0`) ni de transition de
0,3 s (`transition` du style) ; sources de la grille avec un `maxzoom` bas (une ou deux tuiles pour
la vue au lieu de douze, au prix d'un arrondi de ± 7 m sur les carrés de 4,5 km).

Se déplacer et zoomer (second retour de Clément, le 14/11/2026 : « ça manque encore de fluidité ») :
sa machine virtuelle dessine au processeur (rendu « llvmpipe », vérifié dans le navigateur intégré),
comme le Chromium des mesures. Trompettes choisies, autour de Lyon (`parcours.mjs`, fil principal
occupé et images redessinées) :

| Geste | Avant | Après |
|---|---|---|
| Zoom de 7,2 à 8,2 (règle : 30 → 20 km) | 5,5 s, 69 images | 2,5 s, 32 images |
| Déplacement d'un demi-écran au zoom 8,2 | 1,8 s, 22 images | 1,1 s, 19 images |
| Zoom de 8,2 à 9,2 (règle : 10 km) | 5,9 s, 53 images | 2,6 s, 26 images |
| Déplacement au zoom 9,2 | 2,5 s, 20 images | 1,7 s, 15 images |
| Zoom de 9,8 à 10,5 (forêts détaillées) | 9,1 s, 43 images | 4,4 s, 24 images |
| Déplacement au zoom 10,5 | 4,6 s, 17 images | 2,8 s, 12 images |

Ces deux colonnes ont été mesurées à une heure d'écart, machine au calme. Une passe diffère d'une
autre de 30 % (arrivée des tuiles), et la machine elle-même varie du simple au double selon ce que
fait le bureau (le soir du 14/11, `gnome-shell` occupait la moitié d'un processeur : chaque image
coûtait deux fois plus cher, ancien code compris). Ne comparer deux réglages qu'en alternance, dans
la même fenêtre de temps (`essais.mjs` ; pour deux versions du code : l'ancienne servie sur un second
port par `git worktree`, puis `parcours.mjs` sur l'une et l'autre tour à tour). Ainsi mesuré, deux
passes par version, machine chargée : zoom de 7,2 à 8,2, 6,1 et 7,2 s avant, 3,9 et 3,9 s après ;
déplacement au zoom 8,2, 3,9 et 3,5 s → 2,8 et 1,9 s ; au zoom 9,2, 8,1 et 4,3 s → 3,0 et 3,5 s ; au
zoom 10,5, 10,9 et 11,9 s → 6,2 et 6,5 s ; grille visible à l'ouverture, 3,6 et 2,6 s → 2,6 et 2,1 s.
Le zoom de 9,8 à 10,5 remplissait la fenêtre de mesure de 9 s dans les deux versions : non concluant
ce soir-là. Le clic sur un champignon redessine toujours 3 à 6 images (tableau du haut). Ce que coûte **une image** (`images.mjs`,
`forets.mjs` : la carte forcée à se redessiner 3 s, couches allumées puis éteintes) : au zoom 8,2,
68 ms dont 34 pour la grille en carrés de 4,5 km (19 pour son seul quadrillage) → 51 ms dont 4 pour
la grille en cases de 18 km ; au zoom 10,5, 176 ms dont 123 pour `bdforet-fill` → 125 ms. Trois causes,
trois corrections (`mapStyle.ts`, `meteoLayer.ts`, `config.ts`) :
- **fondu des tuiles d'images** (`raster-fade-duration`, 0,3 s d'office) : la carte se redessinait en
  continu tant que des tuiles arrivaient. Sans lui, en alternance sur huit zooms : 23 à 28 images et
  1,2 à 1,5 s au lieu de 46 à 76 images et 3,2 à 5,0 s. C'est le plus gros gain ;
- **lissage des bords** (`fill-antialias`) : une seconde passe qui trace le contour de chaque polygone.
  Retiré des forêts (des milliers de polygones par vue), des motifs (sols, zones) et des carrés de la
  grille, rectangles pour lesquels il ne sert à rien ;
- **carrés de 4,5 km trop tôt** : cases de 18 km jusqu'au zoom 10 (voir « Carrés de 4,5 km »), et le
  quadrillage n'existe plus sous ce zoom en mode indice (son opacité lit une propriété des carrés :
  MapLibre traçait la couche même invisible ; hors de sa plage de zoom, il ne la trace pas).
Essayé puis abandonné : ne plus renvoyer la grille à chaque déplacement sous le zoom 10 (cases gardées
par blocs météo). En alternance au zoom 9,2, aucun écart mesurable (12 à 19 images sans renvoi, 15 à
20 avec) : la complexité d'un cache de plus n'était pas payée.

**Calcul en cours : champignon et pause du zoom** (demande de Clément du 14/11/2026, `gridLoader.ts`,
`MeteoLayer.begin` / `settle` / `onBusy`). Aux échelles de 2 km et moins, entre un zoom et l'arrivée
des carrés la carte ne montrait rien de neuf, et chaque cran de zoom donné en plus relançait tout le
travail. Relevé (`trou.mjs`) : en revenant du zoom 13 au zoom 11,6, les carrés de 500 m disparaissent
à 0,7 s et les carrés de 4,5 km de la nouvelle vue n'arrivent qu'à 1,6 s ; en zoomant de 11,3 à 12,3,
les carrés de 500 m arrivent à 2,6 s (sans carte graphique ; plusieurs secondes de plus chez Clément).
Depuis : à partir du zoom `GRID_BUSY_MIN_ZOOM` (11), en mode indice et pour un champignon de saison,
`MeteoLayer` annonce « calcul en cours » de la fin d'un déplacement (`moveend`), ou d'un changement
de mode ou de champignon, jusqu'à l'arrivée des tuiles des carrés et des forêts détaillées (premier
dessin des carrés de 500 m : on n'attend ni leurs altitudes, ni le fond de carte, ni les zones). Un
seul travail a le droit d'annoncer la fin : le dernier lancé (`work`). Pendant ce temps, un champignon
tourne au milieu de la carte (affiché seulement si le calcul dure plus d'un quart de seconde ; jamais
avec le bandeau « risque de chou blanc », qui attend sa fin) et le zoom ne répond
plus : molette, pincement, double clic, cadre de zoom, touches + et −, boutons + et −. Se déplacer
reste possible ; la recherche de lieu et la géolocalisation aussi.
- **Le champignon** (`.grid-loader`, refait le 15/11/2026 ; demande de Clément : « je veux que le
  champignon tourne pour que ça fasse vraiment loader […] au milieu de l'écran, plus visible et un
  peu plus gros ») : un encart bleu nuit de 182 × 138 px, un anneau de 76 px dont un arc tourne en 0,9 s,
  le champignon de 44 px qui tourne dedans en 1,6 s, « Calcul des carrés… » dessous. Centré sur la
  partie libre de la carte : `--loader-left` et `--loader-right` valent la largeur de la légende et
  du bilan quand ils sont ouverts (à partir de 641 px) ; sur téléphone, tiroir ouvert, une version
  basse au-dessus du tiroir. `pointer-events: none` : on déplace la carte à travers lui. Avant, un
  champignon de 22 px se remplissait en haut, à la place des bandeaux : il se confondait avec eux.
- **Bornes** : la pause dure `GRID_BUSY_MAX_MS` (8 s) au plus depuis son début (un déplacement ne
  relance pas le compte) ; ce plafond atteint, plus de pause tant qu'un calcul ne s'est pas terminé
  (`capped`) : sur un réseau lent, on ne zoomerait sinon que d'un cran toutes les 8 s. Pas de pause
  quand c'est le suivi de la position (GPS, `geolocateSource`) qui déplace la carte : elle
  reviendrait à chaque position, c'est-à-dire tout le temps en marchant.
- **Gestes arrêtés avant MapLibre, pas coupés dedans** (écouteurs en capture sur le conteneur de la
  carte ; MapLibre écoute sur `getCanvasContainer()`). Trois pièges vérifiés dans son code :
  `scrollZoom.disable()` en plein zoom le laisse « en train de zoomer » (la carte ne retrouve plus
  son repos, la molette ne répond plus) ; molette coupée, il n'annule plus l'événement, et un
  pincement au pavé tactile (une molette avec Ctrl) agrandit toute la page ; `touchZoomRotate.disable()`
  rend le pincement au navigateur (`touch-action`), qui zoome la page. Les touches se reconnaissent à
  leur code (`keyCode`, comme MapLibre), pas à leur caractère (Maj + « + » d'un clavier allemand
  vaut « * »). Seul `doubleClickZoom` est coupé dans MapLibre : il n'a pas d'état en cours.
- **Accessibilité** : le champignon est décoratif (`aria-hidden` : l'annoncer à chaque déplacement
  serait un bavardage) ; les boutons de zoom passent en `aria-disabled` (ils gardent le clavier) et
  sont décrits par « Zoom en pause pendant le calcul des carrés. ». Animations réduites : anneau et
  champignon immobiles (la carte et son texte restent).
Ni en mode pluie, ni pour un champignon hors saison, ni sous le zoom 11, ni sur une vue dont les
carrés de 500 m sont déjà relevés (voir « Relevés gardés »). La classe `zoom-paused` du
conteneur de la carte dit si la pause est en cours (tests).

**Relevés gardés, grille démarrée plus tôt** (idée de Clément du 14/11/2026 : « une mise en cache » ;
`fineGrid.ts`, `MeteoLayer.updateFine` / `knownView`, `mapView.ts`). Entre un zoom et l'arrivée des
carrés de 500 m, le temps part à attendre les tuiles détaillées des forêts : le relevé lit les
polygones affichés (`queryRenderedFeatures`), donc rien ne se calcule avant elles. Or le relevé d'un
carré vu en entier ne change pas (BD Forêt et sols sont des données fixes) :
- **Gardé d'une visite à l'autre** : `localStorage`, clé `foret-explorer:releves`, 40 000 carrés au
  plus (20 000 avant le 15/11/2026 : une vue à l'échelle 2 km en compte 3 000 à 5 000 ; les plus
  anciens sont oubliés), écrit 3 s après un relevé (et à la fermeture de la page).
  Mesuré sur de vraies données : 448 carrés et 14 055 caractères pour une vue des Alpes au zoom 12,3
  (1280 × 800), 924 carrés et 27 916 caractères avec une seconde vue, soit ≈ 30 caractères par carré
  et 1 200 000 au plus.
  Format `{ v, d, c, g, s }` : `c` et `g` listent les codes de forêt et les sols cités, `s` donne par
  carré ses neuf points en 18 caractères (rang du code, rang du sol ; « - » : rien), ou 2 caractères
  si les neuf se valent. Oublié en bloc 30 jours après sa première écriture (`SURVEY_MAX_DAYS`), et
  dès que `SURVEY_VERSION` change : **la changer quand les règles des sols ou la nomenclature des
  forêts changent** (2 depuis le 25/11/2026 : le relevé lit les forêts du zoom 11 à tous les zooms).
- **Vue déjà relevée** (`isSurveyed` : tous ses carrés entièrement visibles sont gardés ; ceux du
  bord de l'écran, relevés en partie, ne le sont jamais) : carrés dessinés tout de suite à partir du
  cache, sans attendre les tuiles ; **pas de pause du zoom** ni de champignon, et la mise à jour part
  120 ms après le geste au lieu de 500 (`KNOWN_VIEW_DELAY_MS`). Les tuiles arrivées, le relevé est
  complété par les carrés du bord. Vue en partie connue : on attend comme avant (dessiner quelques
  carrés connus ferait refaire deux fois les tuiles des carrés, pour rien de visible).
- **Tuile en panne** : un carré sous une tuile de forêt ou de sol qui n'a pas pu être lue est relevé
  mais pas gardé (`noteSurveyTile`, renseigné par `mapView.ts` sur les événements `error` et
  `sourcedata` de MapLibre, qui portent la tuile) : sans elle il paraîtrait sans forêt, et le
  resterait des semaines. Une tuile absente (404 de l'IGN : pas de forêt) n'est pas une panne.
- **Grille démarrée à la lecture du style** (`startGrid`, premier `styledata`), et plus à `load` :
  MapLibre n'émet `load` qu'une fois toutes les tuiles de la vue arrivées, fond et forêts compris,
  alors que la grille n'attend que les fichiers météo. À `load`, le mode n'est réappliqué que si le
  champignon ou le mode a changé entre-temps (sinon les altitudes seraient demandées deux fois).

Mesuré le 14/11/2026 (vraies données, Chromium sans carte graphique, ancienne et nouvelle version en
alternance, deux passes ; `revisite.mjs`, `ouverture.mjs`), arrivée des carrés de 500 m :

| Cas | Avant | Après |
|---|---|---|
| Page ouverte sur une vue relevée à la visite d'avant | 2,8 à 3,8 s (4 relevés) | 1,3 à 1,5 s |
| Page rechargée, puis zoom de 11,3 à 12,3 sur une vue relevée à la visite d'avant | 2,8 et 3,0 s | 1,6 et 1,7 s |
| Même zoom sur une vue relevée dans la même visite | 1,6 et 1,8 s | 1,7 et 1,7 s |
| Même zoom, vue jamais relevée | 2,5 et 2,8 s | 3,8 et 2,8 s |
| Page ouverte sur la France entière (cases de 18 km) | 1,8 et 1,8 s | 1,6 et 1,0 s |

Dans la même visite, pas de gain de temps : MapLibre a encore les tuiles en mémoire, et le reste
(animation du zoom, tuiles des carrés refaites, dessin) ne dépend pas du cache ; seule la pause du
zoom disparaît. Vue jamais relevée : inchangée, l'écart entre les passes est celui du réseau. Le
cache n'allège pas le dessin : une image coûte toujours autant.

**Sans carré, et bandeau « risque de chou blanc »** (retours de Clément du 14/11/2026 : « j'ai un
chargement et une fois fini, rien », « il y a des carrés vides, qu'est-ce que c'est ? » ;
`MeteoLayer.drawGrid` / `renderFine` / `updateVerdict` / `bestOther`, `gridLoader.ts`). Le niveau
défavorable était dessiné à 4 % d'opacité pour les carrés de 4,5 km (invisible) et en contour seul
pour ceux de 500 m, et rien ne disait que le calcul était fini. Une seule règle désormais : **un
carré, c'est une chance estimée d'au moins 35 %**.
- **Défavorable : pas envoyé à la carte**, ni case, ni carré de 4,5 km, ni carré de 500 m. La légende
  dit « Sans carré : moins de 35 %, ou pas d'arbres hôtes » (pastille vide en tirets) ; son état
  compte « N carrés de 500 m avec arbres hôtes, dont M à 35 % ou plus ».
- **Plafond météo** (`MeteoLayer.reach`, `weatherCeiling`) : saison × pluie d'une case borne l'indice
  de tous ses carrés (température, arbres et sol valent 1 au plus, et l'altitude ne joue que sur la
  température). Une case dont le plafond est sous le niveau montré n'est ni calculée carré par carré,
  ni l'objet d'une demande d'altitude : autour de Bourges le 14/11/2026 (pluie trop ancienne), une vue
  à l'échelle 1 km ne demande plus aucune altitude.
- **Bandeau** (`#grid-verdict`, à la place du champignon de chargement, jamais avec lui ; à partir du
  zoom 10, mode indice, champignon de saison, arbres hôtes connus) quand la vue n'a aucun carré à
  50 % ou plus **à l'échelle affichée** (carrés de 500 m si leur relevé est fait, de 4,5 km sinon) :
  « Cèpes : risque de chou blanc ici en ce moment. Meilleure chance estimée : [Trompettes (possible)] »,
  ou, si aucun champignon de saison n'atteint 50 % : « …, comme pour les autres champignons de saison.
  Qui ne tente rien n'a rien ! » (textes arrêtés avec Clément : « risque de », jamais « chou blanc »
  affirmé ; le niveau en mot, pas de pourcentage). Le nom proposé est un bouton qui choisit ce
  champignon. Icône : champignon barré, pas une croix (la croix est le bouton de fermeture, au bout) ;
  fermé, il ne revient que pour un autre champignon. `role="status"` sur le texte : annoncé quand il
  change, pas à chaque déplacement.
- **La proposition tient parole** : elle est calculée comme la carte dessinerait l'autre champignon
  (mêmes carrés, mêmes règles : `fineToDraw`, `scoreFineCell`, `squareScore`), sur les données déjà
  chargées. Aucun fichier en plus : météo, parts de forêt et relevés sont communs aux cinq espèces.
  Mesuré le 14/11/2026 sur de vraies données : 0,1 à 0,9 ms à Bourges et dans les Alpes, aux échelles
  2 km et 1 km ; elle n'est calculée que si le champignon choisi n'a rien à 50 %. Pendant le relevé
  des carrés de 500 m, le bandeau ne s'affiche que si le plafond météo de toutes les cases de la vue
  est sous 50 % (certitude) ; sinon il attend le relevé.
- **Recherche de lieu** : choisir un lieu ferme le bilan ouvert (il parlait d'un autre coin, et les
  deux épingles se ressemblent).
Mesuré le 14/11/2026 sur une vue où tout est défavorable (Bourges, cèpes, échelle 1 km, écran de
1850 × 940, ancienne et nouvelle version en alternance, `vide.mjs`) : carrés envoyés à la carte, 19 de
4,5 km et 104 de 500 m → aucun ; altitudes demandées, 45 → aucune. **Le coût d'une image, lui, ne
change pas de façon mesurable** (156 à 282 ms avant, 143 à 321 ms après, machine chargée : les forêts
pèsent bien plus que cent petits carrés). Le gain est dans les appels et dans la lisibilité, pas dans
la fluidité.

**« Choisissez un champignon » et moyenne de France sur les puces** (demandes de Clément du
15/11/2026 ; `chooseHint.ts`, `franceStats.ts`, `mushroomChip` et `pickMushroom` de
`legendExtras.ts`, `scripts/meteo/france.mjs`).
- **Bandeau** (`#choose-hint`, à l'emplacement des bandeaux du haut) : tant qu'aucun champignon
  n'est choisi, que la grille d'indice n'a rien à montrer **et que la légende est fermée**, à tous
  les zooms. (Grille d'indice allumée sans champignon : elle montre les cèpes, donc pas de bandeau,
  sauf de janvier à avril où, hors saison, elle ne dessine rien.) Quand il se retire alors que le
  clavier y était (puce choisie, croix), le clavier passe au bouton de la légende. Les cinq puces sont dedans (un geste, sans ouvrir la légende) ; on n'écrit pas « à
  gauche », faux sur téléphone. Il se ferme pour la visite (croix). Légende ouverte, pas de bandeau :
  elle porte les mêmes puces (c'est le cas à la première visite sur grand écran ; le bandeau sert
  surtout sur téléphone, où la légende est un tiroir fermé). Il recouvre le haut de la carte : un
  clic dessus n'atteint pas la carte. Il a pris la place de « Zoomez pour filtrer les types de
  forêt », que la légende dit dans « Types de forêt » (le bouton « Zoomer ici » a disparu avec lui).
- **Bilan ouvert** : sous 1128 px de large, il remplace les bandeaux du haut (« Choisissez un
  champignon » à toutes ces largeurs, « risque de chou blanc » entre 641 et 1127 px) : entre la
  légende et lui il ne reste que 28 px sur un écran de 834 px. Sur téléphone, « risque de chou
  blanc » reste au-dessus du tiroir.
- **Puce** (`mushroomChip`, la même dans la légende et le bandeau) : le nom, puis la moyenne de
  France en plus petit (« Trompettes 40 % »). Le nom accessible reste le nom seul (chiffre
  `aria-hidden`, redit dans `aria-describedby` avec « hors saison (…) ») : deux boutons portent donc
  le même nom quand le bandeau est affiché, les tests visent ceux de `#legend`. `pickMushroom`
  choisit le champignon, ses forêts hôtes et la grille d'indice ; la proposition du bandeau « risque
  de chou blanc » passe par lui aussi (avant, elle ne changeait pas les forêts affichées).
- (Depuis la règle « Meilleure forêt du carré » du 15/11/2026, ces moyennes montent un peu : ce
  jour-là, cèpes 12 → 14 %, girolles 12 → 13 %, trompettes 39 → 42 %, chanterelles en tube 43 → 50 %.)
- **Moyenne de France** : moyenne des chances estimées sur les carrés de 4,5 km que la carte peut
  allumer pour ce champignon (`isLit` : un de ses carrés de 500 m serait dessiné ; avant le
  25/11/2026 : 10 % d'arbres hôtes, moins de 15 % de bâti), chaque carré
  comptant pour un, calculés comme la carte (`squareScore`). Villes, plaines sans hôtes et mer n'y
  sont pas. Pas de chiffre pour un champignon sans estimation ce mois-ci. Le 14/11/2026 : cèpes
  18 %, girolles 17 %, trompettes 46 %, chanterelles en tube 48 % (20 025, 19 566, 19 034 et 6 622
  carrés). **Elle écrase les régions** (cèpes à 18 % avec 500 carrés à 70 % ou plus, 7 % des
  carrés à 50 % ou plus) : elle classe les champignons entre eux, rien de plus ; la légende sous les
  puces le dit (« chance estimée moyenne en France, là où poussent ses arbres hôtes »).
- **Calculée à la publication, pas dans le navigateur** : tant qu'aucun champignon n'est choisi la
  carte ne charge aucun fichier météo (vérifié : 0 requête) ; la calculer sur place coûterait à
  chaque visite 45 fichiers (325 ko compressés) et 0,1 à 0,25 s de calcul. `deploy.yml` lance
  `scripts/meteo/france.mjs` après les tests de données et avant la construction du site, en
  `continue-on-error` (elle ne doit jamais bloquer la publication) ; il écrit
  `public/data/meteo/france.json` (216 octets : `v`, `maj`, `jour`, `mois`, `moyennes`, `carres`).
  L'étape écrit d'abord un fichier vide, que le calcul remplace : il y a donc toujours un fichier
  (absent, il laisserait une erreur 404 dans la console à chaque visite).
  La carte le lit une fois par visite et n'affiche rien s'il manque, s'il est d'un autre format, si
  son dernier jour a plus de 4 jours, ou s'il a été calculé un autre mois (les saisons ont pu
  changer). Le script ne recopie pas l'indice : `vite build --ssr` (API de Vite, aucune dépendance
  en plus) en 0,1 s ; `config.ts` se charge donc aussi hors navigateur (`PAGE`).
- Le chiffre date de la dernière publication (une par jour, la nuit d'ordinaire) : la carte, elle,
  calcule avec le jour courant ; entre deux publications les deux peuvent différer d'un jour de
  délai après la pluie.
- Relecture du 15/11/2026 (deux relecteurs, chaque constat contre-vérifié) : 4 constats, tous
  mineurs, tous traités ; aucun sur l'étape de publication. Le test du calcul passait avec un calcul
  faux (carrés tous à l'altitude du point de relevé) : il fait maintenant varier l'altitude des
  carrés, la qualité des hôtes et le bâti, et échoue si l'on fausse l'un des trois (vérifié sur une
  copie).
- **« La carte en 3 gestes »** : un trait fléché (`.tour-link`) part de l'épingle du coin touché et
  mène à son bilan, à droite sur le schéma grand écran, vers le tiroir du bas sur le schéma
  téléphone ; de la couleur de l'épingle, pas en vert (le vert y est une forêt).

**Le relevé n'attend que les forêts et les sols** (`waitForSurveyTiles`, 14/11/2026). Il attendait
le repos de toute la carte (`idle`), donc aussi le fond de carte et les zones protégées, qu'il ne lit
pas : une image du fond en retard retenait tous les carrés de 500 m (vu une fois sur quatre captures,
les carrés absents plus de 40 s, sans que la cause de ce cas-là soit établie ; le mécanisme, lui,
l'est par un test : fond retardé de 8 s, carrés à plus de 5 s avant, 0,7 s après). Trois temps,
parce que MapLibre ne demande les tuiles d'une nouvelle vue qu'en la dessinant : une image (sinon
`isSourceLoaded` parle encore de la vue d'avant et le relevé lirait des forêts absentes, qu'il
garderait 30 jours), l'arrivée des tuiles des deux sources (`sourcedata`, et `error` : une tuile en
panne n'émet pas `sourcedata`), une image encore pour qu'elles soient à l'écran. Mesuré sur de
vraies données, réseau normal, en alternance : zoom de 11,3 à 12,3 sur une vue jamais vue, 3,0 et
3,4 s → 2,6 et 2,2 s ; déplacement d'un demi-écran, 1,9 et 1,8 s → 1,9 et 2,0 s (inchangé). Même
nombre de carrés avant et après (347, 389).

**Carrés de 500 m dès l'échelle 2 km** (demande de Clément du 15/11/2026 : « il faut charger les
carrés actuellement visibles à 1 km d'échelle dès 2 km d'échelle, et si ça fait ramer alors on
affiche le chargement » ; `config.ts`, `fineGrid.ts`, `meteoLayer.ts`, `mapStyle.ts`). La règle
affiche 3 km du zoom 10,35 à 11,09, 2 km jusqu'à 11,67, 1 km jusqu'à 12,67 (à 46° de latitude, calculé
depuis le seuil des 5 km) : les carrés de 500 m n'arrivaient qu'au zoom 12, au milieu de l'échelle
1 km. `FINE_MIN_ZOOM` passe de 12 à 11 : ils couvrent toute l'échelle 2 km. Tout ce qui lit cette
constante suit (forêts estompées, règle de ville du bilan, texte de la légende, grille des cases en
fond). Les carrés de 4,5 km ne sont donc plus l'échelle affichée qu'entre les zooms 10 et 11.
- **Quatre fois plus de carrés par vue** : un carré fait 18 px de large au zoom 11 ; 3 000 carrés sur
  un écran de 1280 × 800, 5 100 sur 1850 × 940. `FINE_MAX_CELLS` passe de 1 600 à 6 500 (au-delà, sur
  un écran de plus de 2 000 px de large au zoom 11, la carte garde les carrés de 4,5 km et la légende
  dit « zoomez un peu »), et les relevés gardés de 20 000 à 40 000 carrés.
- **Chiffre seul sous le zoom 12** (« 62 », 8,5 px) : « 62 % » ne tient pas dans 18 px. Le seuil est
  un zoom entier (une expression de zoom dans `layout` n'est évaluée qu'aux zooms entiers).
- **Altitude exacte à partir du zoom 12 seulement** (`FINE_ALTITUDE_MIN_ZOOM`) : en deçà, une vue
  demanderait des dizaines de lots de 200 points à chaque déplacement (l'IGN en accepte 5 par seconde
  et par adresse), et la carte serait redessinée à chaque lot. Les carrés prennent l'altitude de leur
  carré de 4,5 km, déjà dans les fichiers météo, ou l'exacte si une visite plus zoomée l'a gardée.
  Aucun appel de plus à l'échelle 2 km (test e2e).
- **Relevé quatre fois plus rapide, mêmes résultats** (`edgesByBand`, `inside`) : le test
  point-dans-polygone comparait chacun des neuf points d'un carré à tous les sommets de chaque forêt
  qui le touche ; les arêtes sont maintenant rangées une fois par bande de latitude (la hauteur d'un
  carré), et un point ne lit que celles de sa bande. Mesuré le 15/11/2026 sur de vraies données
  (1850 × 940, `cout-releve.mjs`, empreinte de tous les relevés identique avant et après) : 2 711 →
  761 ms au zoom 11,3, 3 419 → 718 ms au zoom 11.
- **Ce que ça coûte** (15/11/2026, ancienne et nouvelle version en alternance, deux passes, arrivée
  au zoom 11,3 depuis le zoom 9,5, Bugey (45,98° N, 5,77° E), trompettes, 1280 × 800, `gel.mjs`) : 10 et 10 images
  redessinées avant, 15 et 15 après (1 197 carrés de 500 m dessinés). Les durées de ce jour-là ne
  disent rien : la machine était saturée (charge de 8 à 10 pour 4 processeurs, `gnome-shell` à plus
  d'un processeur), 31 et 52 s avant, 47 et 48 s après, pour un geste qui prend 2 à 3 s d'ordinaire.
  À refaire machine au calme. Le champignon de chargement et la pause du zoom couvrent cette attente
  (`GRID_BUSY_MIN_ZOOM` = 11, inchangé) ; une vue déjà relevée n'attend pas.

Ce qui reste : à partir du zoom 10, une image coûte encore 125 ms, dont 68 pour les forêts ; choisir
un champignon y change aussi le filtre des forêts, et MapLibre refait alors toutes les tuiles de la
BD Forêt (≈ 1 s à lui seul au zoom 11 sans carte graphique). Au zoom 9,2 les zones protégées et les
couches invisibles coûtent 21 ms par image, pas encore regardés. Voir « Pistes ».
