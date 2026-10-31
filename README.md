# Forêt Explorer

Carte des types de forêt de la **BD Forêt® V2** de l'IGN, avec une légende cliquable pour n'afficher
que les types qui vous intéressent : chênes, hêtre, châtaignier, sapin-épicéa… Les données viennent
directement des services publics de la Géoplateforme IGN, sans clé d'API.

**En ligne : https://aligotaure.github.io/foret-explorer/** (ordinateur et téléphone).

## Démarrer

Prérequis : [Node.js](https://nodejs.org/) 20.19 ou plus récent.

```bash
npm install
npm run dev
```

La carte s'ouvre sur http://localhost:5173, entre Annecy, le Parmelan et Thônes.

## Utilisation

- **Légende** : cochez ou décochez chaque type. La case d'un groupe coche tout le groupe ;
  « Tous les types » remet tout ou vide tout.
- **Préréglages** : Chênes, Feuillus, Conifères. Double-clic sur un type pour n'afficher que lui.
- **Pastilles** : nombre de polygones de chaque type dans la zone affichée. L'option
  « Seulement les types présents dans la zone » raccourcit la liste.
- **Clic sur la carte** : type de forêt, essence, code, coordonnées (copier ou itinéraire).
- **Zoom** : le filtrage fonctionne à partir du niveau 10. Plus loin, la carte affiche le rendu
  officiel de l'IGN, qui ne se filtre pas.
- **Boutons à droite** : photographies aériennes, me localiser, plein écran, zoom.
- Vos choix (types, opacité, fond) restent mémorisés dans le navigateur, et la position de la carte
  est dans l'adresse de la page.

## Continuer avec Claude Code

Ouvrez un terminal dans ce dossier et lancez `claude`. Le fichier `CLAUDE.md` lui donne le contexte :
architecture, services IGN vérifiés et leurs pièges, conventions, idées pour la suite.

## Vérifier

```bash
npm run check                      # TypeScript + build de production
npx playwright install chromium    # une seule fois
npm run test:e2e                   # parcours complet dans un navigateur, services IGN simulés
```

## Sur téléphone

Ouvrez https://aligotaure.github.io/foret-explorer/ puis, dans le menu du navigateur, « Ajouter à
l'écran d'accueil » : la carte s'ouvre ensuite comme une appli. La géolocalisation demande
l'autorisation au premier appui sur « Me localiser ».

Pour tester une version locale depuis un téléphone sur le même Wi-Fi : `npm run dev -- --host`
(adresse affichée dans le terminal ; pas de géolocalisation sans https).

## Mise en ligne

Chaque push sur `main` déclenche `.github/workflows/deploy.yml` : vérification TypeScript, build
Vite, publication sur GitHub Pages. `npm run build` produit le même site statique dans `dist/`,
utilisable sur n'importe quel hébergement https.

## Données

- BD Forêt® V2, Plan IGN, photographies aériennes, géocodage : © IGN, Géoplateforme
  ([data.geopf.fr](https://data.geopf.fr)), [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
- La BD Forêt V2 a été photo-interprétée entre 2007 et 2018 selon les départements : les coupes et
  dépérissements récents n'y figurent pas.
- Bibliothèque cartographique : [MapLibre GL JS](https://maplibre.org/) (licence BSD-3).
