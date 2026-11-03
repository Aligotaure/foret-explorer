# Forêt Explorer

Carte des types de forêt de la **BD Forêt® V2** de l'IGN, avec une légende cliquable pour n'afficher
que les types qui vous intéressent : chênes, hêtre, châtaignier, sapin-épicéa… Pour la cueillette, la
carte croise aussi la **nature du sol** (cartes géologiques du BRGM), la **météo des 20 derniers
jours** et l'**altitude**, et en tire un indice de pousse pour les cèpes, girolles, trompettes,
chanterelles en tube et morilles. Elle signale aussi les **zones protégées** et les **forêts
publiques**, pour savoir où l'on a le droit de cueillir. Tout vient de services publics, sans clé
d'API.

**En ligne : https://aligotaure.github.io/foret-explorer/** (ordinateur et téléphone).

## Démarrer

Prérequis : [Node.js](https://nodejs.org/) 20.19 ou plus récent.

```bash
npm install
npm run dev
```

La carte s'ouvre sur http://localhost:5173, entre Annecy, le Parmelan et Thônes.

## Utilisation

À l'ouverture, un avertissement reste affiché au moins 3 secondes : la carte aide à choisir où
chercher, elle n'identifie aucun champignon et ne donne aucun droit de cueillir. Il revient à chaque
nouvelle version des conditions et au plus tard après 30 jours. La page **À propos** (bouton ⓘ)
réunit les conseils avant de cueillir, les règles, les conditions d'utilisation, les mentions
légales, la confidentialité et un bouton « Effacer mes données ».

### Trouver des champignons

- **Je cherche…** : choisissez cèpes, girolles, trompettes, chanterelles en tube ou morilles. La
  carte ne garde que leurs forêts hôtes et colore une grille selon l'indice de pousse ; la fiche
  rappelle arbres, sols, délai après la pluie, températures, saison, et les confusions dangereuses
  (gyromitre pour les morilles…).
- **Carrés de 500 m** : à partir du zoom 12, la grille de l'indice se resserre. Chaque carré est
  calculé avec son altitude (IGN), les arbres et le sol relevés à l'intérieur ; seuls les carrés
  où poussent des arbres hôtes sont colorés. La pluie reste celle de la case de 4,5 km.
- **Toucher la carte** ouvre le bilan du coin : type de forêt, nature du sol, altitude exacte, droit
  de cueillir (zone protégée, forêt publique ou sans doute privée), pluie jour par jour sur 20 jours,
  températures, et un verdict expliqué pour chaque champignon.
- **Où cueillir** : les zones protégées (réserves naturelles et biologiques, cœurs de parc national,
  arrêtés de biotope, terrains des conservatoires) sont hachurées en rouge ; les forêts publiques
  (domaniales et communales) s'affichent en tirets sur demande. Données PatriNat et IGN (BD TOPO),
  indicatives : seuls les textes officiels et les panneaux sur place font foi.
- **Nature du sol** : motifs par grande nature de sol (calcaire, marnes, grès et molasses, roches
  cristallines, moraines, éboulis, zones humides), avec entre parenthèses les champignons que
  chacune favorise. Couverture : Haute-Savoie et Savoie.
- **Météo des 20 derniers jours** : grille de cases de 4,5 km, en pluie cumulée ou en indice de
  pousse. Les températures sont ramenées à l'altitude de chaque case.

L'indice applique des règles de cueilleur (délai après une grosse pluie, températures, gel, arbre
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

## Continuer avec Claude Code

Ouvrez un terminal dans ce dossier et lancez `claude`. Le fichier `CLAUDE.md` lui donne le contexte :
architecture, services vérifiés et leurs pièges, conventions, idées pour la suite.

## Vérifier

```bash
npm run check                      # TypeScript + build de production
npx playwright install chromium    # une seule fois
npm run test:e2e                   # parcours complet dans un navigateur, services simulés
cd worker && npm ci && npm test    # serveur de mesure (Node 22.18 ou plus)
```

## Page privée : consommation des API

Un petit serveur Cloudflare (dossier `worker/`, offre gratuite) reçoit des compteurs anonymes
envoyés par la carte (appels Open-Meteo pondérés, altitude, recherche, tuiles IGN, tuiles de
géologie, visites) et les présente sur une page privée : adresse secrète et mot de passe vérifié
par le serveur. Les navigateurs envoient des totaux par jour, sans identifiant ni cookie ; les
adresses IP ne sont pas conservées.

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

Chaque push sur `main` déclenche `.github/workflows/deploy.yml` : construction des tuiles de
géologie et des zones, tests et publication du serveur de mesure (s'il est configuré), vérification
TypeScript, build Vite, publication sur GitHub Pages. Les dépendances sont installées avec `npm ci
--ignore-scripts` : versions figées par les `package-lock.json`, sans script d'installation. Les
actions GitHub sont épinglées sur leur identifiant de commit.

Les tuiles « nature du sol » sont produites par `scripts/geologie/construire.sh` (GDAL 3.8 ou plus,
Node, curl, unzip) dans `public/data/geologie/`, celles des zones protégées et forêts publiques par
`scripts/zones/construire.sh` (GDAL, Node ; WFS de la Géoplateforme) dans `public/data/zones/`. En
développement, la carte lit celles du site en ligne : pas besoin de les construire.

Autres automatismes : `verification.yml` teste chaque pull request (dont celles de Dependabot,
configuré dans `.github/dependabot.yml` : une fois par semaine, versions d'au moins 7 jours) ;
`surveillance.yml` vérifie chaque matin que les services IGN, Open-Meteo et le site répondent, et
échoue (avec un e-mail de GitHub) si l'un d'eux tombe.

## Données

- BD Forêt® V2, Plan IGN, photographies aériennes, géocodage, altitude (RGE ALTI) : © IGN,
  Géoplateforme ([data.geopf.fr](https://data.geopf.fr)),
  [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
- Géologie : © BRGM, cartes géologiques harmonisées au 1/50 000 (BD Charm-50, 2019), Licence Ouverte
  2.0, via le miroir référencé par data.gouv.fr.
- Zones protégées : PatriNat (OFB, MNHN), via la Géoplateforme ; forêts publiques : © IGN, BD TOPO®
  (d'après l'ONF), Licence Ouverte Etalab 2.0.
- Météo : [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), gratuit pour un usage non commercial
  (moins de 10 000 appels par jour et 300 000 par mois) : la page privée suit cette consommation.
- La BD Forêt V2 a été photo-interprétée entre 2007 et 2018 selon les départements : les coupes et
  dépérissements récents n'y figurent pas.
- Bibliothèque cartographique : [MapLibre GL JS](https://maplibre.org/) (licence BSD-3).
