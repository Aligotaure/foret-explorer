# Accueil, conditions et droit de cueillir

Notes détaillées, sorties telles quelles de `CLAUDE.md` le 16/11/2026 : Claude Code ne les lit qu'à la
demande (index dans `CLAUDE.md`, « Avant de toucher à…, lire »). Un renvoi « voir « Titre » » désigne
une section de ce dossier.

## Avertissement, conditions et droit de cueillir

- Changer `TERMS_VERSION` (`src/legal.ts`) dès que le texte de l'avertissement ou des conditions
  (`a-propos.html`) change : la carte redemande alors l'accord. Garder les deux textes cohérents, et
  regrouper les retouches de texte dans une seule version (un seul nouvel accord demandé).
- Accueil en deux fenêtres, trois pendant l'ouverture de la chasse, jamais un carrousel. (1) L'avertissement (`disclaimer.ts`) reste une
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
- **Rappel « période de chasse »** (`hunting.ts`, demande de Clément du 15/11/2026 : « un autre écran
  avec un blocage de 3 secondes […] consacré à dire qu'on est en période de chasse »). Entre
  l'avertissement et la présentation, bloquant comme l'avertissement (`gate.ts` : 3 s, ni Échap ni
  clic à côté), bouton « J'ai compris ». Texte de Clément, orthographe et ponctuation corrigées
  seulement : « ATTENTION : PÉRIODE DE CHASSE du … au … » en rouge et en gras (`#ff8080`, 7,3 pour 1
  sur le fond), chasubles, danger réel, puis, depuis le 25/11/2026 (texte dicté par Clément, non
  vérifié), « Pour *augmenter* votre sécurité, allez dans les forêts communales, où les chasseurs sont
  tenus d'indiquer si une chasse est en cours par des panneaux » (avant : « demandez au propriétaire
  (s'il est sympa) »).
  - **Dates** : Code de l'environnement, article R424-7 (en vigueur depuis le 05/05/2012, relu sur
    Légifrance le 15/11/2026). L'ouverture générale doit tenir entre le premier dimanche de septembre
    (Corse ; deuxième dimanche pour les anciennes régions du Sud, troisième pour celles du Nord) et le
    dernier jour de février ; le préfet fixe les dates de chaque département dans ces bornes. Le
    tableau ne nomme pas l'Alsace et exclut la Moselle (leur régime n'a pas été relu). L'écran affiche
    les bornes nationales, calculées pour la saison en cours (2026-2027 : du 6 septembre 2026 au
    28 février 2027) : rien à mettre à jour chaque année, et rien de propre à une région. La ligne
    en petit qui disait d'où elles viennent, et que sanglier et chevreuil peuvent être chassés dès le
    1er juin selon le département (article R424-8), a été retirée le 25/11/2026 (demande de Clément :
    alléger). Arrêtés 2026-2027 vus pour recoupement : Tarn,
    13 septembre ; Hauts-de-Seine, 20 septembre ; clôture le 28 février dans les deux.
  - **Quand** : seulement pendant cette période (le jour est lu par `getMonth` et `getDate`, comme la
    saison des champignons : les tests figent le mois) ; au plus une fois toutes les 12 heures
    (`REMIND_HOURS`, clé `foret-explorer:chasse` : une fois par sortie, pas à chaque ouverture de la
    carte) ; une fois par visite sans stockage ; retiré quand on quitte la carte, il revient avec
    elle. Jamais avec la vue Analytics.
  - Ce n'est pas un accord : rien dans les conditions, `TERMS_VERSION` inchangée.
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
