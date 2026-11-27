# Nomenclature, saisons et indice

Notes détaillées, sorties telles quelles de `CLAUDE.md` le 16/11/2026 : Claude Code ne les lit qu'à la
demande (index dans `CLAUDE.md`, « Avant de toucher à…, lire »). Un renvoi « voir « Titre » » désigne
une section de ce dossier.

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
- Saisons larges exprès (cèpes de mai à décembre, chanterelles en tube jusqu'en janvier ; février, au
  poids 0,1, n'est plus estimé : voir « Hors saison »…) : c'est la température qui départage les
  régions (littoral atlantique et Midi plus tardifs que la montagne).
- **Hors saison** (`mushrooms.ts`, demande de Clément du 14/11/2026). Deux notions, au mois près (les
  poids de saison sont mensuels ; le mois est lu par `currentMonth()`, donc par `getMonth`) :
  - `isDormant` : à plus d'un mois de la saison **écrite** (`seasonText`, les mois au poids ≥ 0,5 :
    c'est elle que le visiteur lit, « hors saison (mars à juin) »). Grisés : cèpes et girolles de
    janvier à avril, trompettes de février à juin, chanterelles en tube de février à juillet, morilles
    d'août à janvier. Dans la légende : puce grise à bord en tirets (pas la couleur seule), toujours
    cliquable (sa fiche et ses forêts hôtes servent à préparer la saison), nom du bouton inchangé,
    « hors saison (…) » en `aria-describedby`. Dans le bilan : ligne grisée, sans pourcentage, après
    les champignons de saison.
  - `noEstimate` : grisé, ou mois au poids nul (l'indice, saison × …, vaut alors zéro par
    construction). **Rien n'est calculé** : la grille, les pastilles et les carrés de 500 m ne sont ni
    chargés ni dessinés (état `offSeason` de `MeteoLayer`, « Morilles hors saison (mars à juin) : aucune
    chance estimée en ce moment. », échelle des couleurs masquée), aucune altitude n'est demandée, et le
    bilan n'appelle pas `scoreMushroom` pour lui. Seul poids non nul ignoré : les chanterelles en tube
    en février (0,1). Le dernier relevé est gardé : revenir à un champignon de saison redessine dans
    l'instant, si la carte n'a pas bougé entre-temps (`redraw()` ignore le relevé d'une autre vue : celui
    de la France entière, découpé en carrés de 4,5 km en arrivant sur une forêt, gelait la carte).
    Choisir un champignon sans estimation ne force pas le mode « indice » (la grille de pluie affichée
    reste), et l'interrupteur de la grille allume alors la pluie. Sans champignon choisi, la grille montre le cèpe : de janvier à avril elle
    dit donc « Cèpes hors saison (juin à novembre) » (choisir un champignon de saison la rallume).
  Gain de fluidité : seulement quand un champignon hors saison est choisi ; le bilan n'y gagne rien de
  mesurable (cinq calculs de quelques microsecondes).
- Morilles : printemps (mars à juin, l'altitude passant par la température), hôtes `FF1-49-49`
  (frênaies…), `FP` (peupleraies), `FF1-00-00`, `FF1-00`, `FF0` (coupes, chablis), sapin-épicéa en
  montagne ; sols calcaires, alluvions, marnes. Fiche avec encadré gyromitre et cuisson.
- Indice (`mushrooms.ts`) : saison × pluie (délai depuis l'épisode ≥ 15 mm sur 3 jours, en trapèze
  propre à chaque champignon, + humidité sur 20 jours) × température (moyenne 7 jours à l'altitude,
  gel ≤ −1 °C) × arbre hôte × sol (le sol module : 0,4 + 0,6 × préférence). Niveaux : ≥ 0,5 favorable,
  ≥ 0,28 possible, ≥ 0,12 peu probable. Règles de cueilleur, pas un modèle validé : à recaler avec les
  retours de terrain.
- **Coupes récentes** (`mushrooms.ts`, `scoreFineCell` de `fineGrid.ts`, 25/11/2026 ; données : voir
  « Coupes datées »). Aux carrés de 500 m, chaque point hôte où l'atlas voit la forêt coupée ou
  détruite depuis moins de 10 ans ne compte plus que pour 0,2 (cèpes, girolles, trompettes,
  chanterelles en tube) ; entre 10 et 20 ans, pour 0,5, girolles seulement ; rien ne change pour les
  morilles (les coupes sont un de leurs milieux : `FF0`). L'indice du carré est multiplié par la
  moyenne de ces valeurs sur ses points hôtes : une coupe à côté des arbres hôtes ne baisse rien.
  Un carré relevé en partie (bord de l'écran) prend la part touchée du carré entier. Bilan d'un
  coin : même facteur, sur la part des neuf points du carré de 500 m du point, avec une raison par
  champignon concerné. Carrés de 4,5 km, cases de 18 km et moyenne de France : inchangés.
  D'où viennent les chiffres : guide de mycosylviculture du CRPF Rhône-Alpes (2013, valable pour
  cinq départements) : presque rien pendant une dizaine d'années après une coupe rase (p. 10 et 47),
  girolles défavorisées dans un « peuplement très jeune (moins de 20 ans) » (p. 25). Une date de
  l'atlas sur cinq étant fausse, un point « coupé » garde un cinquième de sa valeur ; la moitié pour
  les girolles est un choix de produit (le guide dit « défavorable », sans chiffre). Rien entre 20
  et 40 ans : aucune règle ferme. Choix arrêtés avec Clément le 25/11/2026.
  Un carré déjà faible peut ainsi passer sous 35 % et ne plus être dessiné (voir « Sans carré »).
- Chance estimée en % (`chanceOf`, choix du 12/11/2026) : l'indice ramené sur une échelle calée sur
  les niveaux (0,12 → 35 %, 0,28 → 50 %, 0,5 → 70 %, 1 → 95 %, linéaire entre deux). Seuil
  `CHANCE_THRESHOLD` = 50 % : en dessous, rien n'est mis en avant (pas d'étiquette, teinte pâle) ;
  sous 35 % (`SHOWN_MIN_SCORE`), pas de carré du tout (voir « Sans carré »). Vue d'ensemble (zoom < 10) : pastilles `meteo-points` sur les secteurs à 70 % et plus
  (`HOTSPOT_MIN_CHANCE`), 12 au plus, espacées (voir « Pastilles ») ; à partir du zoom 10,
  pourcentage dans chaque carré ; bilan : « ≈ 62 % · possible ».
  Toujours écrire « estimée » ou « ≈ » : ce n'est pas une probabilité mesurée. Sur la carte, le
  pourcentage d'un carré de 4,5 km est celui de son meilleur carré de 500 m (voir « Une seule règle pour toutes les échelles ») ; un carré éteint n'est
  pas « sans champignon », un carré coloré n'est ni une promesse ni un droit de cueillir.
