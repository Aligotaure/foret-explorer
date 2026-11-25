# Limites connues et pistes

Notes détaillées, sorties telles quelles de `CLAUDE.md` le 16/11/2026 : Claude Code ne les lit qu'à la
demande (index dans `CLAUDE.md`, « Avant de toucher à…, lire »). Un renvoi « voir « Titre » » désigne
une section de ce dossier.

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
- Zones protégées et forêts publiques refaites une fois par an : une zone créée ou agrandie
  entre-temps n'apparaît qu'à la reconstruction suivante (« À propos » les dit « indicatives […]
  dépassées »). Une archive reprise du site en ligne (cache perdu) est tenue pour faite avec les
  scripts actuels.
- Terrains du Conservatoire du littoral : plus de fiche officielle dans le bilan (la couche des
  parcelles n'en donne pas) ; noms tels que la source les donne, en capitales presque sans accents
  (« Iles Chausey ») ; sur un terrain qu'il gère, le bilan ne nomme pas le propriétaire. Un site mixte
  est tracé en deux terrains, avec un trait entre la partie possédée et la partie gérée (198 sites).
  `a-propos.html` (« Ce que vaut la carte ») attribue encore les zones protégées à PatriNat seul : à
  corriger avec les autres retouches de texte en attente (sa section « Sources » nomme le
  Conservatoire).
- Mesure de consommation : compteurs envoyés par les navigateurs, donc ordres de grandeur (hors
  réseau, GPC ou page fermée brutalement : pas comptés) ; l'adresse de collecte est publique.
- Comptages des forêts sur les tuiles chargées (débordent un peu de l'écran).
- Recherche non biaisée vers la zone affichée.
- Deux vues : réservées aux liens « vitrine » (`?analytics`), ce qui n'est pas un verrou (mot lisible
  dans le code public ; un lien transmis montre l'îlot) ; un ancien lien `…/#vue=analytics`, sans le
  mot, ouvre la carte. Tant que l'avertissement est à l'écran, l'îlot ne répond pas (il faut
  l'accepter, ou arriver par `?analytics#vue=analytics`). Quitter la carte par l'îlot moins de 0,3 s après un déplacement peut
  laisser l'ancienne position dans l'entrée de l'historique (seul Précédent la retrouve). Entre 641 et
  1187 px de large, l'îlot n'est pas centré. Graphiques de la vue Analytics : une série de barres
  (ni courbe ni comparaison de deux séries).
- Arbres hôtes des carrés : BD Forêt de 2007 à 2018 ; seuils des carrés de 500 m (3 points sur 9 ;
  en ville, 15 % de bâti, 5 points et 2 voisins boisés) choisis à l'œil sur Nancy, Annecy, Lyon,
  Paris, Limoges et Toulouse ; les carrés de 4,5 km, les cases et les pastilles en découlent. Un seul
  bois de quelques hectares suffit à allumer son carré de 4,5 km, pâle, avec son pourcentage (un carré
  allumé sur vingt-six pour les cèpes, un sur six pour les chanterelles en tube) : à cette échelle la
  carte dit « il y a un coin ici », pas « tout le carré est bon ». En ville, un bois de moins de
  trois carrés de 500 m n'est pas montré ; un massif collé à une ville (Versailles, bois de Boulogne)
  allume son carré, la ville autour restant éteinte. Part bâtie : zones généralisées du Plan IGN au
  zoom 10, pas les bâtiments un à un.
- Accueil : tant qu'une de ses fenêtres est ouverte, l'îlot ne répond pas ; sans stockage du
  navigateur, l'avertissement et le rappel « période de chasse » reviennent à chaque visite et la
  présentation n'est pas montrée d'office ;
  sur téléphone, une fois fermée, la légende reste fermée (le bandeau « Choisissez un champignon »
  dit alors par où commencer, tant qu'on ne l'a pas fermé). Rien n'a été essayé sur un vrai téléphone ni avec un lecteur d'écran.
- Rappel « période de chasse » : bornes nationales, pas les dates du département du visiteur (il
  s'affiche donc dès le 6 septembre 2026 là où la chasse n'ouvre que le 20) ; rien de mars à août,
  alors que sanglier et chevreuil peuvent être chassés dès le 1er juin, et le sanglier en mars ;
  régime de l'Alsace et de la Moselle non relu. Pendant la période, une première visite passe deux
  fenêtres bloquantes de 3 s, puis la présentation. `a-propos.html` ne parle pas de la chasse, et sa
  phrase « Sur votre appareil… » ne cite pas la clé du rappel (seule la liste « Gardé dans ce
  navigateur » la nomme) : à regrouper avec les autres retouches de texte en attente.
- Fluidité : sans carte graphique (machine virtuelle, vieux téléphone), choisir un champignon à partir
  du zoom 10 prend encore plus d'une seconde, à cause du filtre des forêts, et un zoom occupe encore
  le processeur 2,5 à 4,5 s (voir « Fluidité »). Mesures faites dans Chromium sans carte graphique
  seulement, pas sur un vrai téléphone ni dans le navigateur de Clément. Les bords des forêts ne sont
  plus lissés (léger crénelage sous le zoom 12, où aucun contour ne les souligne).
- Vue d'ensemble (zoom < 10) : la teinte d'une case de 18 km est celle de son meilleur carré de
  4,5 km : une case foncée peut n'avoir qu'un seul carré favorable (zoomer le dit). Le bilan d'un
  clic, lui, juge le carré de 4,5 km du point : dans une case colorée il peut répondre « peu d'arbres
  hôtes dans ce secteur » ou « secteur urbanisé ». Entre les zooms 9,35 et 10 la règle affiche déjà
  5 km et les cases restent de 18 km. Un secteur entre 50 et 69 % n'a ni pastille ni étiquette avant
  le zoom 10 (la légende donne la meilleure chance de la vue).
- Moyenne de France : une moyenne nationale ne dit rien d'une région ; elle date de la dernière
  publication ; elle manque le premier jour (avant la première publication) et dès que l'étape de
  calcul échoue. Bandeau « Choisissez un champignon » : fermé, il ne revient pas de la visite ; il
  ne s'affiche pas légende ouverte, donc pas à la première visite sur grand écran. Le trait de « La carte en
  3 gestes » n'est vu qu'à la première visite ; sur la vraie carte, rien d'autre que l'épingle et le
  titre « Ce coin » ne relie le clic au bilan.
- Sans carré : un secteur sans carré peut être sans arbres hôtes, en ville, ou à moins de 35 % ; la
  carte ne distingue pas ces cas (le bilan d'un clic, lui, donne la raison). Les carrés de 4,5 km
  entre 35 et 50 % restent très pâles là où la forêt couvre peu (opacité selon la part d'arbres
  hôtes) : autour de Bourges ils ne se voient presque pas. La proposition du bandeau vaut pour la vue
  à l'écran ; aux carrés de 500 m elle prend, pour les carrés jamais dessinés, l'altitude du carré de
  4,5 km (l'altitude exacte, demandée après le clic, peut faire passer un carré juste sous 50 %). Sur
  téléphone le second texte tient sur quatre lignes. Bandeau et champignon de chargement : leur
  alternance n'a pas de test.
- Relevés gardés : un carré relevé reste tel quel 30 jours au plus dans le navigateur, même si la
  BD Forêt ou les sols du site changent entre-temps (changer `SURVEY_VERSION` pour l'éviter). Le
  cache ne sert qu'aux vues déjà vues en entier : une vue neuve attend toujours ses tuiles, et entre
  les zooms 10 et 11 (carrés de 4,5 km) rien n'est changé. La phrase « Sur votre appareil… » de la
  confidentialité (`a-propos.html`) ne cite pas ces relevés, seule la liste « Gardé dans ce
  navigateur » les nomme : la corriger demande une nouvelle version des conditions, à regrouper avec
  les autres retouches en attente. Les garde-fous (30 jours, changement de version, quota du
  navigateur dépassé) n'ont pas de test.
- Pause du zoom pendant le calcul des carrés (à partir du zoom 11) : elle commence à la fin du geste,
  pas pendant ; un zoom continu de la France à une forêt n'est donc pas freiné. Sur une machine lente,
  elle peut durer jusqu'à son plafond de 8 s, et le champignon qui tourne ne dit rien de
  l'avancement. Le zoom « double toucher puis glisser » passe encore. Pas essayée sur un vrai
  téléphone ni avec un vrai pavé tactile (les gestes sont simulés dans les tests) ; le plafond et la
  trêve qui le suit ne sont couverts par aucun test (il faudrait attendre 8 s).
- Carrés de 500 m à l'échelle 2 km (zooms 11 à 12) : températures à l'altitude du carré de 4,5 km,
  pas à celle du carré de 500 m ; en montagne le chiffre d'un carré peut donc changer en passant le
  zoom 12 (altitude exacte). Chiffre de 8,5 px dans des carrés de 18 px au zoom 11 : lisible sur
  écran, pas vérifié sur un vrai téléphone. Cinq images redessinées de plus à l'arrivée sur une vue
  jamais relevée ; durée non mesurée machine au calme. Sur un écran de plus de 2 000 px de large, les
  carrés de 500 m n'arrivent qu'un peu après le zoom 11 (plafond de 6 500 carrés).
- Hors saison : au mois près, sans tenir compte de la région (les morilles sont grisées en janvier
  jusque dans le Midi) ; les chanterelles en tube sont grisées en février malgré un poids de 0,1.
- Bilan sans appel : sous le zoom 11, un vrai massif pris dans un secteur bâti à 15 % ou plus reçoit
  « secteur urbanisé : zoomez pour juger ce bois » au lieu d'une estimation ; à partir du zoom 11 la
  règle de ville n'est connue que si la grille d'indice a relevé la vue (sinon le bilan estime et
  demande une altitude).
- Montée en charge : première limite, le trafic de GitHub Pages (voir « Montée en charge ») ; aucun
  essai de charge n'a été fait, les chiffres viennent d'une visite jouée par un script.
- Échelles : un carré de 4,5 km annonce son meilleur carré de 500 m à l'altitude du carré de 4,5 km.
  À partir du zoom 12 un carré de 500 m prend son altitude exacte : en montagne il peut alors monter
  ou baisser de quelques points par rapport à ce que le carré de 4,5 km et la pastille annonçaient
  (non chiffré). Le pourcentage écrit dans le fichier est arrondi au millième au-dessus : le carré de
  4,5 km peut afficher un point de plus que son meilleur carré de 500 m. `public/foret/parts.json`
  doit être refait quand les arbres hôtes, les sols ou les seuils changent (`npm run test:france`
  le réclame), et après une reconstruction des tuiles des sols avec d'autres règles (rien ne le
  réclame : à faire à la main). Le relevé lit les forêts du zoom 11 à tous les zooms : au-delà du
  zoom 12 les lisières des carrés de 500 m sont celles de ces tuiles (à 3 m près), pas celles des
  tuiles affichées, et la carte charge une à quatre tuiles de plus (déjà dans le cache du
  navigateur si l'on est passé par le zoom 11). `a-propos.html` (« Ce que vaut la carte ») décrit
  encore l'ancienne règle (« au moins 10 % de la surface », « sans tenir compte du sol ») : à
  corriger avec les autres retouches de texte en attente, dans une même version des conditions.
  Non couvert par les tests : la vue zoomée où le relevé fin ne trouve aucun arbre hôte (`fineDone`
  sans carré fin).
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
12. Téléphone : ouvrir la légende à la fermeture de la présentation (le bandeau « Choisissez un
    champignon », lui, est fait : 15/11/2026).
13. Liens vers les fiches des sosies dangereux, et mesurer la part des visites qui ouvrent un bilan
    avant et après la refonte (les compteurs `app.sessions` et `app.spots` existent déjà).
14. Filtre des forêts sans refaire les tuiles : une couche par type de forêt, à opacité constante
    (allumer ou éteindre un type ne changerait alors qu'une valeur, sans rien recharger). Gros
    chantier : `bdforet-fill` est lu partout (clics, comptages, tests).
15. Si le trafic approche la limite de GitHub Pages : un CDN devant le site, ou les archives de
    tuiles et les fichiers météo servis ailleurs (voir aussi la piste 9) ; serveur de mesure : une
    seule ligne écrite par envoi au lieu d'une par compteur.
16. Carrés de 500 m prêts autour de la vue : relever aussi la marge des tuiles déjà chargées (elles
    débordent de l'écran ; à vérifier avec `querySourceFeatures`), sans rien télécharger de plus ; et
    faire démarrer avant `load` ce qui n'attend pas les tuiles (comptages exclus).
17. Carrés de 500 m servis tout faits : `scripts/foret/parts.mjs` relève déjà toute la France sur
    leurs points (40 secondes) ; en tirer une archive de tuiles éviterait à la carte de les relever
    dans ses propres tuiles (plus d'attente des forêts détaillées, plus de pause du zoom, mêmes
    carrés pour tous). Gros chantier : le relevé, son cache et le bilan en ville en dépendent.
18. Altitude du meilleur carré de 500 m de chaque carré de 4,5 km dans le fichier des parts (une
    demande d'altitude par carré, à faire une fois) : la pastille et le carré de 500 m
    concorderaient alors aussi en montagne à partir du zoom 12.
