# Forêt Explorer — notes pour Claude Code

**Ce fichier est relu à chaque échange, par toutes les sessions : il reste court (250 lignes au
plus).** On n'y ajoute qu'une règle utile à toutes les sessions, en une ligne. Mesures, dates,
historique et explications vont dans `docs/`, lu à la demande (voir « Avant de toucher à…, lire »).
Avant d'écrire une note ou une règle, ici, dans `docs/` ou en mémoire : dire à Clément quoi et
pourquoi.

Carte web des types de forêt de la **BD Forêt® V2** (IGN) avec une légende à cases à cocher pour
choisir les types affichés, enrichie pour la cueillette : nature du sol (géologie BRGM), météo des
30 derniers jours (Open-Meteo, recopiée chaque jour dans des fichiers communs par une tâche GitHub),
altitude (IGN) et indice de pousse par champignon, en cases de 18 km, puis en carrés de 4,5 km et de
500 m quand on zoome ; zones protégées et forêts publiques (droit de cueillir). **Toute la France métropolitaine** :
ne rien coder pour une région en particulier.
Accueil à l'ouverture : un avertissement bloquant (3 s, moins de 100 mots), puis, pendant l'ouverture
de la chasse, un rappel de sécurité bloquant lui aussi (3 s), puis, au premier accord,
« La carte en 3 gestes » ; page « À propos » (conseils, conditions, mentions légales,
confidentialité). Interface inspirée du panneau « Légendes » de cartes.gouv.fr
(thème sombre bleu nuit, icônes lavande, légende sur carte blanche). Une page privée (serveur
Cloudflare, `worker/`) suit la consommation des API.

Deux vues dans la même page, choisies par un îlot noir en haut au centre : « Carte » (tout ce qui
précède) et « Analytics » (comment le produit est piloté : pari en cours, analyses, paris tranchés),
à l'adresse `#vue=analytics`. L'îlot et la vue Analytics sont réservés aux liens « vitrine », qui
portent `?analytics` (`…/foret-explorer/?analytics#vue=analytics`), donnés par Clément à ses
prospects freelance : à l'adresse ordinaire, celle des cueilleurs, le site n'est que la carte. Voir
`docs/vues.md`.

Usage visé : repérer les coins favorables aux champignons (cèpes, girolles, trompettes, chanterelles
en tube, morilles) partout en France. La carte sert aussi sur téléphone, en forêt : le mobile compte
autant que le bureau. Première visite : la France entière ; ensuite, la dernière vue (`foret-explorer:vue`).

En ligne : https://aligotaure.github.io/foret-explorer/ (GitHub Pages, republié à chaque push sur
`main` et à chaque tour complet de la météo par `.github/workflows/deploy.yml` : archive des tuiles
de géologie (cache), archive des zones (cache, à défaut celle du site en ligne ; refaite une fois par
an), fichiers météo (cache de
`meteo.yml`), tests et publication du serveur de mesure s'il est configuré, `npm run check`,
publication de `dist/`). Autres workflows : `meteo.yml` (toutes les heures : fichiers météo communs,
une demande par case et par jour, voir `docs/donnees.md`), `verification.yml` (chaque pull request, Dependabot
compris), `surveillance.yml` (chaque jour : les services et les archives répondent-ils, la météo
a-t-elle plus de 36 h de retard, les zones plus de 13 mois ? Open-Meteo injoignable : simple avertissement). Liste des risques du site (document à part) :
https://claude.ai/artifact/ScNwBDt9TN7k2DhJ347QdK

## Commandes

- `npm ci` puis `npm run dev` : serveur Vite sur http://localhost:5173 (versions figées par
  `package-lock.json` ; `npm install <paquet>` pour en ajouter un, puis committer le lockfile)
- `npm run typecheck` : TypeScript strict, sans émission
- `npm run build` : build statique dans `dist/` ; `npm run check` = typecheck + build + contrôle du
  build (`tests/build.mjs`, aussi `npm run test:build` : la page d'entrée et la vue Analytics
  n'embarquent pas MapLibre, le code de la carte est préchargé, le script d'en-tête reconnaît le
  lien « vitrine », ordre des feuilles de style, contenu de `src/analyticsData.ts` relu)
- `npm run test:e2e` : test de bout en bout (Playwright + vrai MapLibre, services simulés ; avertissement,
  À propos et zones compris ; îlot et vue Analytics dans `tests/e2e/views.mjs`, ouverts par le lien
  « vitrine », plus l'adresse ordinaire sans îlot). Première fois :
  `npx playwright install chromium`. Captures dans `tests/e2e/shots/`. La suite entière prend une
  dizaine de minutes ; pour mettre un test au point, `E2E_SEULS=cache,vide npm run test:e2e` ne joue
  que ces groupes (`avertissement`, `bureau`, `secours`, `cache`, `vide`, `telephone`, `vues`).
- `cd worker && npm ci && npm test` : serveur de mesure (26 vérifications, Durable Object simulé sur
  `node:sqlite`, Node ≥ 22.18 qui lit le TypeScript directement) ; aperçus HTML dans `worker/test/apercus/`.
  `npm run typecheck` (types Cloudflare), `npm run dev` (wrangler, secrets dans `worker/.dev.vars`).
- `bash scripts/geologie/construire.sh` : tuiles « nature du sol » de toute la France, dans l'archive
  `public/data/geologie/geologie.pmtiles` (GDAL ≥ 3.8 avec le pilote PMTiles ; 2,7 Go téléchargés,
  dix minutes ; pour un essai : `DEPARTEMENTS="074 073"`). Inutile en dev : la carte lit alors
  l'archive du site en ligne.
- `bash scripts/zones/construire.sh` : tuiles des zones protégées et forêts publiques, dans l'archive
  `public/data/zones/zones.pmtiles` (GDAL ≥ 3.8 avec SpatiaLite, qui fusionne les parcelles du
  Conservatoire du littoral ; Node ; toute la France depuis le WFS, retéléchargée au plus une fois par
  semaine). Même remarque en dev.
- `node scripts/meteo/mettre-a-jour.mjs --simuler --dossier /tmp/meteo --cases scripts/meteo/cases-france.json`
  : fichiers météo communs avec des séries fictives (sans `--simuler` : vrais appels à Open-Meteo,
  `--budget` en appels pondérés). En dev, la carte lit ceux du site en ligne.
- `node scripts/meteo/cases.mjs` : refait `scripts/meteo/cases-france.json` (liste versionnée des
  cases, de leur point de relevé et de l'altitude de leurs 16 carrés de 4,5 km), seulement si la
  taille des cases change ; les points de relevé existants sont gardés. Pas de CORS ni d'accès depuis
  le bac à sable : à lancer en local ou dans une tâche GitHub.
- `node scripts/foret/parts.mjs` : refait `public/foret/parts.json` (pour chacun des 29 483 carrés de
  4,5 km et chaque champignon : nombre de carrés de 500 m à dessiner et meilleur « arbres × sol » ;
  part bâtie), quand changent les arbres hôtes ou les sols d'un champignon, les seuils des carrés de
  500 m, les règles des sols, la grille ou la BD Forêt. 3 556 tuiles du zoom 11 de la BD Forêt
  (≈ 440 Mo, `.cache/foret/`), 889 du Plan IGN (≈ 85 Mo, `.cache/plan/`), l'archive des sols du site
  (143 Mo, `.cache/geologie/`) : un quart d'heure la première fois, une minute ensuite ; en local.
- `npm run test:donnees` : `test:meteo` (mise à jour de la météo commune rejouée sur plusieurs jours
  avec des séries simulées : budgets, jours manquants, journée provisoire, publication) + `test:geologie` (règles des sols
  sur la table de toutes les descriptions de France, `tests/donnees/`) + `test:foret` (relevé des
  carrés de 500 m sur toute la France, lecteur de tuiles, fichier versionné ; lui seul tourne en local).
  `node tests/geologie.mjs non` liste les formations encore sans sol, `sol <id>` et `grep <motif>`
  servent à régler les règles.
- `npm run test:france` : le calcul des moyennes de France par champignon (chiffre des puces), joué
  sur des fichiers météo fabriqués par le test, et la règle qui relie les échelles (dont : le fichier
  des parts est-il à refaire ?) ; tourne en local (il lui faut Vite). Pour fabriquer
  le fichier en local à partir de la météo du site en ligne (les puces du serveur de développement
  l'affichent alors) : `node scripts/meteo/france.mjs --meteo .cache/meteo-en-ligne --amorce
  https://aligotaure.github.io/foret-explorer/data/meteo/ --sortie public/data/meteo/france.json`.

Après chaque modification : `npm run check` puis `npm run test:e2e` (`npm run test:donnees` si
`scripts/`, `src/meteoGrid.ts` ou `src/metricsSchema.ts` changent ; `npm test` dans `worker/` si le
serveur de mesure ou `src/metricsSchema.ts` change). Sans accès à npm (bac à sable), pousser sur une
branche et lancer `verification.yml` (`gh workflow run verification.yml --ref <branche>`).

## Pile

Vite + TypeScript strict + MapLibre GL JS 5, sans framework. Une seule autre dépendance : `pmtiles`
(lecture des archives de tuiles du site, protocole `pmtiles://` enregistré dans `mapView.ts`). Pas de
nouvelle dépendance sans raison.

## Fichiers (`src/`)

Une ligne par fichier ; rôle détaillé, couches de la carte et scripts : `docs/architecture.md`.

| Fichier | Rôle |
|---|---|
| `main.ts` | Point d'entrée : feuilles de style, îlot, avertissement, vues chargées par `import()` |
| `view.ts` | Les deux vues : `#vue=analytics` dans l'adresse, historique, îlot |
| `mapView.ts` | Vue Carte : carte MapLibre, modules, état → carte, clic → bilan du coin |
| `analyticsView.ts`, `analytics.css` | Vue Analytics (sans rien de la carte) |
| `analyticsData.ts` | Contenu de la vue Analytics, modifié à la main (guide en tête du fichier) |
| `analyticsTypes.ts`, `analyticsCheck.ts` | Format de ce contenu et sa relecture |
| `disclaimer.ts` | Avertissement bloquant, accord gardé par version des conditions |
| `gate.ts` | Fenêtre bloquante à compte à rebours (avertissement, rappel de chasse) |
| `hunting.ts` | Rappel « période de chasse » |
| `tour.ts` | « La carte en 3 gestes » |
| `legal.ts` | `TERMS_VERSION`, `TOUR_SINCE`, lien « vitrine » (`SHOWCASE`), données gardées, effacement |
| `apropos.ts`, `apropos.css` | Page `a-propos.html` |
| `config.ts` | Adresses des services, archives de tuiles, emprise de la France, réglages |
| `state.ts` | Store observable (sélection, fond, champignon, météo, sol) et persistance |
| `mapStyle.ts` | Style MapLibre : sources, couches, expressions, fonctions `apply*()` |
| `forestClasses.ts` | Les 32 codes `code_tfv` : libellés, couleurs officielles, groupes, préréglages |
| `mushrooms.ts` | Profils des 5 champignons et calcul de l'indice |
| `fineRule.ts`, `partsBuild.ts` | Règle des carrés de 500 m, sans la carte ; `scripts/foret/parts.mjs` l'applique à toute la France |
| `forestShare.ts` | Ce que chaque carré de 4,5 km contient par champignon (`public/foret/parts.json`), `isLit` |
| `soils.ts`, `geology.ts` | 8 natures de sol et leurs motifs ; forêt et sol sous un point |
| `zones.ts` | Zones protégées et forêt publique sous un point |
| `meteoGrid.ts` | Grille météo commune et format des fichiers ; lu aussi par Node : aucun import |
| `weather.ts` | Fichiers météo communs, résumé de 30 jours, Open-Meteo en secours, altitude IGN |
| `meteoLayer.ts` | Grille sur la carte : cases de 18 km, carrés de 4,5 km, pastilles, carrés de 500 m |
| `fineGrid.ts` | Carrés de 500 m : relevé forêt et sol, relevés et altitudes gardés |
| `gridLoader.ts` | Champignon de chargement, pause du zoom, bandeau « risque de chou blanc » |
| `chooseHint.ts` | Bandeau « Choisissez un champignon » |
| `franceStats.ts` | Moyenne de France par champignon (chiffre des puces) |
| `spot.ts` | Bilan d'un coin au clic |
| `directions.ts` | « Y aller » du bilan : applications de navigation, copie des coordonnées |
| `legend.ts`, `legendExtras.ts` | Panneau « Légendes » et ses sections |
| `ui.ts`, `dom.ts`, `icons.ts` | Éléments partagés : section repliable, interrupteur, `h()`, `toast()`, icônes |
| `search.ts`, `toolbar.ts`, `counts.ts` | Recherche de lieu, boutons de la carte, comptage des forêts |
| `metrics.ts`, `metricsSchema.ts` | Compteurs de consommation des API ; liste partagée avec `worker/` |

Ailleurs : `scripts/geologie/` (tuiles des sols), `scripts/meteo/` (fichiers météo communs, moyennes
de France), `scripts/foret/` (parts de forêt par carré), `scripts/zones/` (zones protégées et forêts
publiques), `worker/` (serveur de mesure Cloudflare), `tests/` (e2e Playwright, build, données).

Flux : l'interface ne touche jamais la carte. Elle appelle `store.update()` ; `mapView.ts` est abonné au
store et appelle `applySelection` / `applyOpacity` / `applyBasemap` / `applyGeology` /
`meteo.applyMode()`. Pour ajouter une option : champ dans `AppState` (+ persistance dans `state.ts`),
contrôle dans `legend.ts` ou `legendExtras.ts`, effet dans `mapStyle.ts`, abonnement dans `mapView.ts`,
vérification dans `tests/e2e/run.mjs`.

## Conventions

- Textes de l'interface et commentaires en français ; identifiants du code en anglais.
- Garder les couleurs officielles IGN pour les forêts ; la géologie est en motifs (pas de couleur)
  pour rester lisible par-dessus.
- DOM construit avec `h()` ; jamais d'`innerHTML` avec des données (seules les icônes SVG statiques).
- `localStorage` toujours dans un try/catch (navigation privée).
- Accessibilité : vrais `<input type="checkbox">`, interrupteurs `role="switch"`, `aria-*` à jour.
- Mobile : légende et bilan en tiroirs bas sous 640 px (un seul ouvert à la fois), boutons de 46 px.
- En développement, `window.map`, `window.store`, `window.spot`, `window.meteo` (la grille) et
  `window.metrics` (totaux de la visite, `flush()`) sont exposés (console, tests e2e) une fois la vue Carte chargée (avant, `window.map`
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

## Pièges

- **Tuiles de l'IGN** (BD Forêt, Plan IGN vectoriel) : numérotation XYZ. Ne jamais ajouter
  `scheme: 'tms'`, même si le style officiel de l'IGN le déclare.
- **Forêts** : filtrer sur `code_tfv`, jamais sur `tfv` (libellés à variantes) ; un polygone coupé par
  un bord de tuile garde son `id` : dédoublonner par `id`.
- **MycoDB** : ne jamais l'interroger par script ni l'ajouter à `surveillance.yml` (son `robots.txt`
  interdit les robots d'IA) ; une fiche se vérifie à la main.
- **`TERMS_VERSION`** (`src/legal.ts`) : la changer dès que le texte de l'avertissement ou des
  conditions (`a-propos.html`) change, en regroupant les retouches dans une seule version (chacune
  redemande l'accord). Bilan, rappel de chasse et « La carte en 3 gestes » n'en font pas partie.
- **Échelles** : carrés de 4,5 km, cases et pastilles n'ont pas de règle à eux : ils lisent
  `public/foret/parts.json`, calculé avec celle des carrés de 500 m (`fineRule.ts`). Arbres hôtes, sols
  ou seuils changés : refaire le fichier (`node scripts/foret/parts.mjs`), `npm run test:france` le réclame.
- **`SURVEY_VERSION`** (`src/fineGrid.ts`) : la changer quand les règles des sols ou la nomenclature
  des forêts changent (les relevés sont gardés 30 jours dans le navigateur).
- **`scripts/zones/`** : toute retouche, même d'un commentaire, relance la reconstruction des zones à
  la publication suivante (≈ 6 min, WFS de l'IGN).
- **Grille** (`meteoLayer.ts`, `fineGrid.ts`, `mapStyle.ts`) : MapLibre refait toutes les tuiles
  d'une source à chaque `setData`, changement de filtre ou de propriété de dessin lue par
  `['get', …]`. Les carrés ne portent que `l`, `p`, `c` ; un carré éteint ou à moins de 35 % n'est
  pas envoyé. Lire `docs/fluidite.md` avant d'y toucher.
- **Zooms** : le zoom de MapLibre est un zoom « 512 px » (au zoom 13, ≈ 5 m/pixel) ; une expression
  de zoom dans une propriété `layout` n'est évaluée qu'aux zooms entiers : garder des seuils entiers.
- **Altitude IGN** : GET seulement (POST refusé), lots de 200 points, 5 requêtes par seconde et par
  adresse IP (sinon 429 et blocage de 5 s) ; −99999 hors couverture.
- **Open-Meteo** : seule la tâche `meteo.yml` l'appelle (usage non commercial, limites par adresse
  IP) ; la carte ne s'en sert qu'en secours.
- **Pas de CORS** sur le WFS de la Géoplateforme ni sur le WMS du BRGM : au build ou dans un script,
  jamais depuis le navigateur.
- **Archives PMTiles** : `minzoom`, `maxzoom` et `bounds` de `config.ts` égaux à ceux des scripts.
  GitHub Pages abandonne une publication au bout de 10 minutes : pas de milliers de petits fichiers.
- **Vue Analytics** : jamais de modification de `src/analyticsData.ts` directement sur `main` (une
  erreur bloquerait `npm run check`, donc la publication quotidienne de la météo) ; n'y écrire que
  des chiffres mesurés. Le mot du lien « vitrine » est à deux endroits : script d'en-tête
  d'`index.html` et `legal.ts`.
- **Bilan** : la ligne « Statut » reste toujours visible, avant les champignons ; « sans doute
  privée » seulement si les zones sont chargées et qu'une forêt est sous le point.
- **Tests e2e** : la police des étiquettes est vide (évaluer les expressions de MapLibre carré par
  carré), le mois est figé en octobre (tests de bureau), un carré se reconnaît à son centre (`x`,
  `y`), et les puces des champignons se visent dans `#legend` (le bandeau porte les mêmes noms).

## Avant de toucher à…, lire

| Sujet | Fichier |
|---|---|
| Rôle détaillé de chaque fichier et des scripts, ordre des couches, cases de 18 km, carrés de 4,5 km, pastilles, arbres hôtes, meilleure forêt du carré | `docs/architecture.md` |
| Fluidité (mesures, règles), pause du zoom et champignon de chargement, relevés gardés, « sans carré » et bandeau « risque de chou blanc », bandeau « Choisissez un champignon » et moyenne de France, carrés de 500 m dès l'échelle 2 km | `docs/fluidite.md` |
| Bilan d'un coin, légende, fiche d'un champignon, grille fine (carrés de 500 m) | `docs/bilan-legende.md` |
| Îlot, vue Analytics, lien « vitrine », adresse et historique | `docs/vues.md` |
| Services extérieurs (IGN, Open-Meteo, BRGM, WFS des zones, archives PMTiles), météo commune (`meteo.yml`), serveur de mesure (`worker/`), montée en charge | `docs/donnees.md` |
| Avertissement, rappel « période de chasse », « La carte en 3 gestes », conditions, droit de cueillir | `docs/accueil.md` |
| Indice et pourcentages, saisons et hors saison, natures de sol, nomenclature des forêts | `docs/indice.md` |
| Limites connues et pistes pour la suite (à lire avant de proposer un chantier) | `docs/limites-pistes.md` |

Dans ces fichiers, « voir « Titre » » désigne une section de l'un d'eux : `grep -rn "Titre" docs/`.
Une mesure, une date ou une explication nouvelle s'ajoute au fichier concerné de `docs/`, pas ici.
