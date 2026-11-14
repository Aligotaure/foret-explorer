# Forêt Explorer

Carte des types de forêt de la **BD Forêt® V2** de l'IGN, avec une légende cliquable pour n'afficher
que les types qui vous intéressent : chênes, hêtre, châtaignier, sapin-épicéa… Pour la cueillette, la
carte croise aussi la **nature du sol** (cartes géologiques du BRGM), la **météo des 30 derniers
jours** et l'**altitude**, et en tire un indice de pousse pour les cèpes, girolles, trompettes,
chanterelles en tube et morilles. Elle signale aussi les **zones protégées** et les **forêts
publiques**, pour savoir où l'on a le droit de cueillir. Toute la France métropolitaine, Corse
comprise. Tout vient de services publics, sans clé d'API.

**En ligne : https://aligotaure.github.io/foret-explorer/** (ordinateur et téléphone).

## Démarrer

Prérequis : [Node.js](https://nodejs.org/) 20.19 ou plus récent.

```bash
npm install
npm run dev
```

La carte s'ouvre sur http://localhost:5173 : la France entière à la première visite, puis la
dernière vue (ou celle de l'adresse, `#carte=zoom/lat/lon`).

## Utilisation

À l'ouverture, un avertissement court reste affiché au moins 3 secondes : la carte aide à choisir où
chercher, elle n'identifie aucun champignon et ne donne aucun droit de cueillir. Il revient à chaque
nouvelle version des conditions et au plus tard après 30 jours. Après un premier accord, « La carte
en 3 gestes » présente l'écran (à revoir depuis la légende : « Comment ça marche ? »). La page
**À propos** (bouton ⓘ)
réunit les conseils avant de cueillir, les règles, les conditions d'utilisation, les mentions
légales, la confidentialité et un bouton « Effacer mes données ».

### Trouver des champignons

- **Je cherche…** : choisissez cèpes, girolles, trompettes, chanterelles en tube ou morilles. La
  carte ne garde que leurs forêts hôtes et colore une grille selon l'indice de pousse ; la fiche
  rappelle arbres, sols, délai après la pluie, températures, saison, et les confusions dangereuses
  (gyromitre pour les morilles…).
- **Carrés de 4,5 km** : à partir du zoom 10, chaque case météo (≈ 18 km) est détaillée en 16 carrés,
  chacun avec les températures ramenées à sa propre altitude (un fond de vallée et un versant à
  1 500 m n'ont pas le même indice). La pluie reste celle de la case.
- **Carrés de 500 m** : à partir du zoom 12, la grille de l'indice se resserre encore. Chaque carré
  est calculé avec son altitude (IGN), les arbres et le sol relevés à l'intérieur ; seuls les carrés
  où poussent assez d'arbres hôtes sont colorés (en ville, seulement les vrais massifs, pas les parcs).
- **Toucher la carte** ouvre le bilan du coin, la réponse d'abord : zone protégée s'il y en a une,
  type de forêt, nature du sol, altitude exacte et statut du terrain (forêt publique ou sans doute
  privée), puis une ligne par champignon, du plus probable au moins probable (les raisons se
  déplient, un « ? » explique le pourcentage), la pluie jour par jour sur 30 jours, les températures,
  et les règles de cueillette, repliées.
- **Droit de cueillir** : les zones protégées (réserves naturelles et biologiques, cœurs de parc national,
  arrêtés de biotope, terrains des conservatoires) sont hachurées en rouge ; les forêts publiques
  (domaniales et communales) s'affichent en tirets sur demande. Données PatriNat et IGN (BD TOPO),
  indicatives : seuls les textes officiels et les panneaux sur place font foi.
- **Nature du sol** : motifs par grande nature de sol (calcaire, marnes, limons et lœss, grès et
  sables, roches cristallines et volcaniques, moraines, éboulis, zones humides), avec entre
  parenthèses les champignons que chacune favorise. Couverture : France métropolitaine (cartes
  départementales du BRGM).
- **Météo** : grille de cases d'environ 18 km sur toute la France, en pluie des 20 derniers jours ou
  en chance estimée du champignon recherché. Un carré n'est coloré que s'il contient assez d'arbres
  hôtes de ce champignon (au moins 10 % de sa surface, d'après la BD Forêt) et s'il n'est pas d'abord
  une ville (moins de 15 % de bâti, d'après le Plan IGN) : villes, mer et plaines sans arbres restent
  éteintes. Les températures sont ramenées à l'altitude de chaque carré (4,5 km,
  puis 500 m) ou du point touché. La légende donne le dernier jour de pluie connu ;
  tant que la mise à jour du jour n'est pas passée, la veille est une estimation et c'est écrit.

La carte affiche une **chance estimée en %** : 70 % et plus, bonnes conditions ; 50 à 70 %, ça se
tente ; en dessous de 50 %, peu d'espoir sans connaître un coin précis. En vue d'ensemble (cases de
18 km), des pastilles marquent les secteurs à 70 % et plus. Un champignon à plus d'un mois de sa saison
est grisé : rien n'est calculé pour lui. L'indice applique des règles de cueilleur (délai après une grosse pluie, températures, gel, arbre
hôte, sol). C'est une aide pour choisir où aller, pas une garantie, et il ne dit rien de ce qui se
mange : au moindre doute, faites contrôler la récolte par un pharmacien ou une société mycologique.

### Forêts

- **Légende** : cochez ou décochez chaque type. La case d'un groupe coche tout le groupe ;
  « Tous les types » remet tout ou vide tout.
- **Préréglages** : Chênes, Feuillus, Conifères. Double-clic sur un type pour n'afficher que lui.
- **Pastilles** : nombre de polygones de chaque type dans la zone affichée. L'option
  « Seulement les types présents dans la zone » raccourcit la liste.
- **Zoom** : le filtrage fonctionne à partir du niveau 10. Plus loin, la carte affiche le rendu
  officiel de l'IGN, qui ne se filtre pas.
- **Boutons à droite** : photographies aériennes, me localiser, plein écran, zoom.
- Vos choix restent mémorisés dans le navigateur, et la position de la carte est dans l'adresse de
  la page.

### Deux vues : Carte et Analytics

En haut au centre, un îlot bascule entre la **carte** et la vue **Analytics**, qui montre comment le
produit est piloté : pari en cours, analyses, paris tranchés. Revenir à la carte la retrouve telle
quelle (position, légende, bilan), et la vue Analytics s'ouvre sans charger la carte. Son adresse
directe : `…/#vue=analytics` (elle se combine avec la position : `#carte=11.5/45.92/6.19&vue=analytics`).

Tout ce qu'affiche la vue Analytics vient d'un seul fichier, `src/analyticsData.ts`, à modifier à la
main : son en-tête explique comment (modèles à recopier, dates, nombres). Tant qu'un bloc est vide,
la vue affiche un état vide. `npm run check` refuse un champ oublié ou mal écrit, et relit le contenu
(une date qui n'existe pas, un texte laissé vide) ; en développement (`npm run dev`), la vue liste en
haut de page ce qui reste à corriger.

## Continuer avec Claude Code

Ouvrez un terminal dans ce dossier et lancez `claude`. Le fichier `CLAUDE.md` lui donne le contexte :
architecture, services vérifiés et leurs pièges, conventions, idées pour la suite.

## Vérifier

```bash
npm run check                      # TypeScript + build de production + contrôle du découpage
npx playwright install chromium    # une seule fois
npm run test:e2e                   # parcours complet dans un navigateur, services simulés
cd worker && npm ci && npm test    # serveur de mesure (Node 22.18 ou plus)
```

## Page privée : consommation des API

Un petit serveur Cloudflare (dossier `worker/`, offre gratuite) reçoit des compteurs anonymes
envoyés par la carte (fichiers météo, appels Open-Meteo de secours, altitude, recherche, tuiles
IGN, tuiles de géologie, visites) et les présente sur une page privée : adresse secrète et mot de
passe vérifié par le serveur. Les navigateurs envoient des totaux par jour, sans identifiant ni
cookie ; les adresses IP ne sont pas conservées.

Mise en route (une fois, une dizaine de minutes) :

1. Créer un compte gratuit sur [dash.cloudflare.com](https://dash.cloudflare.com/sign-up), puis
   ouvrir **Workers & Pages** une fois : choisir le sous-domaine `xxx.workers.dev` s'il est demandé,
   et noter l'**Account ID** affiché dans la colonne de droite.
2. **My Profile → API Tokens → Create Token**, modèle **Edit Cloudflare Workers**, puis copier le
   jeton (il n'est montré qu'une fois).
3. Dans le dépôt GitHub, **Settings → Secrets and variables → Actions → New repository secret** :
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ADMIN_PASSWORD` (12 caractères au moins) et
   `ADMIN_PATH` (le chemin secret, 12 caractères au moins : lettres, chiffres, `-` ou `_`).
4. Relancer la publication (onglet **Actions → Publication GitHub Pages → Run workflow**).

La page est alors à l'adresse `https://foret-explorer-mesures.<sous-domaine>.workers.dev/<ADMIN_PATH>`.
Sans ces secrets, la carte fonctionne normalement et n'envoie rien. Pour changer le mot de passe
ou l'adresse, modifiez le secret et relancez la publication : les sessions ouvertes sont fermées.

## Sur téléphone

Ouvrez https://aligotaure.github.io/foret-explorer/ puis, dans le menu du navigateur, « Ajouter à
l'écran d'accueil » : la carte s'ouvre ensuite comme une appli. La géolocalisation demande
l'autorisation au premier appui sur « Me localiser ».

Pour tester une version locale depuis un téléphone sur le même Wi-Fi : `npm run dev -- --host`
(adresse affichée dans le terminal ; pas de géolocalisation sans https).

## Mise en ligne

Chaque push sur `main` déclenche `.github/workflows/deploy.yml` : tuiles de géologie (gardées en
cache tant que leurs scripts ne changent pas), tuiles des zones (refaites chaque semaine), fichiers
météo, tests et publication du serveur de mesure (s'il est configuré), vérification TypeScript,
build Vite, publication sur GitHub Pages. Les dépendances sont installées avec `npm ci
--ignore-scripts` : versions figées par les `package-lock.json`, sans script d'installation. Les
actions GitHub sont épinglées sur leur identifiant de commit.

Les tuiles « nature du sol » sont produites par `scripts/geologie/construire.sh` (GDAL 3.8 ou plus,
Node, curl, unzip ; ≈ 2,7 Go de cartes du BRGM pour toute la France) dans `public/data/geologie/`,
celles des zones protégées et forêts publiques par `scripts/zones/construire.sh` (GDAL, Node ; WFS
de la Géoplateforme) dans `public/data/zones/`. Chaque couche tient dans une seule archive
[PMTiles](https://docs.protomaps.com/pmtiles/) (143 Mo pour les sols, 24 Mo pour les zones), que la
carte lit par morceaux : GitHub Pages abandonne une publication au bout de 10 minutes, et des
dizaines de milliers de petits fichiers de tuiles n'y passent pas toujours. En développement, la
carte lit les archives du site en ligne : pas besoin de les construire.

La part de chaque type de forêt et la part bâtie de chaque carré de 4,5 km (`public/foret/parts.json`,
versionné) sont calculées une fois par `node scripts/foret/parts.mjs` à partir des tuiles
vectorielles de la BD Forêt et du Plan IGN, sans dépendance ; à relancer seulement si la grille ou
la BD Forêt changent.

### Météo commune

La carte n'appelle pas Open-Meteo depuis chaque navigateur : la tâche `.github/workflows/meteo.yml`
recopie, pour chaque case d'environ 18 km de la France métropolitaine (1 972 cases), la pluie et
les températures des 30 derniers jours dans des fichiers publiés avec le site (`data/meteo/`), avec
l'altitude des 16 carrés de 4,5 km de chaque case. Elle est déclenchée toutes les heures avec un
budget d'appels, mais chaque case n'est demandée qu'une fois par jour et seulement pour les jours
qui lui manquent (un appel par case, soit ≈ 2 000 appels par jour pour toute la France, quel que
soit le nombre de visiteurs : un cinquième des 10 000 permis) ; les autres passages ne font rien.
Quand le tour du jour est fini, elle relance la publication. GitHub lance ces tâches quand il peut,
parfois avec des heures de retard : chaque passage garde donc aussi la journée en cours telle que la
prévision la donne, et la carte s'en sert le lendemain comme estimation de la veille en attendant le
passage du jour. Si les fichiers sont injoignables ou en retard de plus de 3 jours, la carte
interroge Open-Meteo elle-même (20 jours, quelques dizaines de cases au plus).

Autres automatismes : `verification.yml` teste chaque pull request (dont celles de Dependabot,
configuré dans `.github/dependabot.yml` : une fois par semaine, versions d'au moins 7 jours) ;
`surveillance.yml` vérifie chaque jour que les services IGN, Open-Meteo et le site répondent (archives
des tuiles comprises), et que la météo commune n'a pas plus de 36 heures de retard ; elle échoue (avec
un e-mail de GitHub) sinon. GitHub
suspend les tâches planifiées d'un dépôt public resté 60 jours sans activité : il suffit alors de
les réactiver dans l'onglet **Actions**.

## Données

- BD Forêt® V2, Plan IGN, photographies aériennes, géocodage, altitude (RGE ALTI) : © IGN,
  Géoplateforme ([data.geopf.fr](https://data.geopf.fr)),
  [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
- Géologie : © BRGM, cartes géologiques harmonisées au 1/50 000 (BD Charm-50, 2019), Licence Ouverte
  2.0, via le miroir référencé par data.gouv.fr.
- Zones protégées : PatriNat (OFB, MNHN), via la Géoplateforme ; forêts publiques : © IGN, BD TOPO®
  (d'après l'ONF), Licence Ouverte Etalab 2.0.
- Météo : [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), gratuit pour un usage non commercial
  (moins de 10 000 appels par jour et 300 000 par mois), recopiée chaque jour dans les fichiers
  météo du site ; limites des départements (grille météo) : © IGN, ADMIN EXPRESS.
- La BD Forêt V2 a été photo-interprétée entre 2007 et 2018 selon les départements : les coupes et
  dépérissements récents n'y figurent pas.
- Bibliothèques : [MapLibre GL JS](https://maplibre.org/) pour la carte et
  [PMTiles](https://github.com/protomaps/PMTiles) pour lire les archives de tuiles (licences BSD-3).
