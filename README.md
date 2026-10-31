# Forêt Explorer

Carte des types de forêt de la **BD Forêt® V2** de l'IGN, avec une légende cliquable pour n'afficher
que les types qui vous intéressent : chênes, hêtre, châtaignier, sapin-épicéa… Pour la cueillette, la
carte croise aussi la **nature du sol** (cartes géologiques du BRGM), la **météo des 20 derniers
jours** et l'**altitude**, et en tire un indice de pousse pour les cèpes, girolles, trompettes et
chanterelles en tube. Tout vient de services publics, sans clé d'API.

**En ligne : https://aligotaure.github.io/foret-explorer/** (ordinateur et téléphone).

## Démarrer

Prérequis : [Node.js](https://nodejs.org/) 20.19 ou plus récent.

```bash
npm install
npm run dev
```

La carte s'ouvre sur http://localhost:5173, entre Annecy, le Parmelan et Thônes.

## Utilisation

### Trouver des champignons

- **Je cherche…** : choisissez cèpes, girolles, trompettes ou chanterelles en tube. La carte ne
  garde que leurs forêts hôtes et colore une grille selon l'indice de pousse ; la fiche rappelle
  arbres, sols, délai après la pluie, températures et saison.
- **Toucher la carte** ouvre le bilan du coin : type de forêt, nature du sol, altitude exacte, pluie
  jour par jour sur 20 jours, températures, et un verdict expliqué pour chaque champignon.
- **Nature du sol** : motifs par grande nature de sol (calcaire, marnes, grès et molasses, roches
  cristallines, moraines, éboulis, zones humides), avec entre parenthèses les champignons que
  chacune favorise. Couverture : Haute-Savoie et Savoie.
- **Météo des 20 derniers jours** : grille de cases de 4,5 km, en pluie cumulée ou en indice de
  pousse. Les températures sont ramenées à l'altitude de chaque case.

L'indice applique des règles de cueilleur (délai après une grosse pluie, températures, gel, arbre
hôte, sol). C'est une aide pour choisir où aller, pas une garantie.

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
```

## Sur téléphone

Ouvrez https://aligotaure.github.io/foret-explorer/ puis, dans le menu du navigateur, « Ajouter à
l'écran d'accueil » : la carte s'ouvre ensuite comme une appli. La géolocalisation demande
l'autorisation au premier appui sur « Me localiser ».

Pour tester une version locale depuis un téléphone sur le même Wi-Fi : `npm run dev -- --host`
(adresse affichée dans le terminal ; pas de géolocalisation sans https).

## Mise en ligne

Chaque push sur `main` déclenche `.github/workflows/deploy.yml` : construction des tuiles de
géologie, vérification TypeScript, build Vite, publication sur GitHub Pages.

Les tuiles « nature du sol » sont produites par `scripts/geologie/construire.sh` (GDAL 3.8 ou plus,
Node, curl, unzip) dans `public/data/geologie/`. En développement, la carte lit celles du site en
ligne : pas besoin de les construire.

## Données

- BD Forêt® V2, Plan IGN, photographies aériennes, géocodage, altitude (RGE ALTI) : © IGN,
  Géoplateforme ([data.geopf.fr](https://data.geopf.fr)),
  [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
- Géologie : © BRGM, cartes géologiques harmonisées au 1/50 000 (BD Charm-50, 2019), Licence Ouverte
  2.0, via le miroir référencé par data.gouv.fr.
- Météo : [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), gratuit pour un usage non commercial.
- La BD Forêt V2 a été photo-interprétée entre 2007 et 2018 selon les départements : les coupes et
  dépérissements récents n'y figurent pas.
- Bibliothèque cartographique : [MapLibre GL JS](https://maplibre.org/) (licence BSD-3).
