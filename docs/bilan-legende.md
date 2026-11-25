# Bilan d'un coin et légende

Notes détaillées, sorties telles quelles de `CLAUDE.md` le 16/11/2026 : Claude Code ne les lit qu'à la
demande (index dans `CLAUDE.md`, « Avant de toucher à…, lire »). Un renvoi « voir « Titre » » désigne
une section de ce dossier.

## Bilan et légende : la réponse d'abord

Refonte du 14/11/2026 (mesures du 13/11 : sur téléphone, aucun pourcentage visible à l'ouverture du
bilan ; légende de 61 contrôles dont 39 cases, météo en 5ᵉ position).

- **Bilan** (`spot.ts`), dans l'ordre : alerte de zone protégée s'il y en a une (en tête, que la
  météo réponde ou non) ; terrain (Forêt, Sol, Altitude, **Statut**) ; « Champignons · chance
  estimée » ; météo ; « Droit de cueillir : les règles », replié ; actions ; une ligne de note.
- **Statut** : toujours visible, un fait et ce qu'il implique (« Forêt sans doute privée : il faut
  l'accord du propriétaire », « X : forêt publique »), jamais « autorisé ». C'est le garde-fou qui
  permet de replier les règles : ne pas le déplacer sous les champignons. Un test e2e vérifie qu'il se
  voit sans rien déplier. « Propriété publique (Conservatoire du littoral) » seulement sur un terrain
  que le Conservatoire possède (type `cdl`) ; sur un terrain qu'il gère sans le posséder
  (`cdl_gestion`, contrats de gestion : Vaccarès, îles Chausey…), « Propriétaire non identifié : accord
  à demander », comme dans les autres zones protégées (test e2e pour les deux).
- **Coupes** (25/11/2026, `cutsText` de `spot.ts`) : sous une forêt seulement, juste après la ligne
  « Forêt », quand l'atlas date une coupe ou un dégât dans le carré de 500 m du point : « coupe ou
  dégât vu par satellite depuis 2017 sur environ un tiers de ce carré de 500 m : peuplement jeune, à
  vérifier sur place » (et « entre 2007 et 2016 sur … » pour la tranche de 10 à 20 ans). Un fait
  daté et ce qu'il implique, comme le statut ; la part du carré en mots (`shareWords` : elle vient de
  neuf points, un pourcentage mentirait) ; « à vérifier sur place » parce qu'une date sur cinq est
  fausse. Chaque champignon concerné reçoit une raison (« Coupe ou dégât récent sur … du carré :
  presque rien n'y pousse pendant une dizaine d'années. »), et le « ? » le dit en une phrase.
  Légende : un paragraphe « Coupes récentes » dans « Comment c'est calculé ».
- **Champignons** : du plus probable au moins probable (tri sur l'indice, sans exception parmi les
  champignons de saison ; ceux qui sont hors saison de plus d'un mois viennent ensuite, grisés et sans
  pourcentage, voir « Hors saison ») ; le
  champignon recherché est signalé à son rang (liseré, « recherché ») et sa ligne dépliée, sinon la
  première si elle atteint 50 % ; les raisons sont dans un `<details>` par champignon ; écarté par la
  saison, la forêt ou le secteur (`SpotPanel.exclusion`) : une ligne avec la raison, sans calcul
  (`scoreMushroom` n'est appelé que pour les champignons qu'on peut estimer). Le bilan ouvert suit le
  champignon recherché (`SpotPanel.refresh()`). Il est redessiné jusqu'à trois fois par clic : tout ce
  qui se déplie garde son état dans un champ de `SpotPanel`, remis à zéro à chaque nouveau coin.
- **« ? »** (un seul, près du titre « Champignons ») : un bouton `aria-expanded` qui déplie un encart
  sur place, au clic, au toucher et au clavier (Échap le replie) ; pas d'infobulle au survol (rien de
  tel sur téléphone, et le panneau la rognerait). Il dit « estimation, pas une probabilité mesurée ».
- Sous le zoom 10, ou tant que les tuiles de la BD Forêt ne sont pas arrivées (clic juste après un
  zoom), la forêt est **inconnue**, pas absente (`forestUnknown` : `'zoom'` ou `'loading'`). Le bilan
  applique alors la règle de la carte au carré de 4,5 km qui contient le point (`View.sector`,
  `hostCover`, `isLit`) : carré éteint (aucun carré de 500 m n'y serait dessiné), aucune chance
  annoncée (« peu d'arbres hôtes dans ce secteur », ou « secteur urbanisé » si le carré est bâti à
  15 % ou plus : jamais « surtout bâti », à 16 % ce serait faux) ; carré allumé, celle de son
  meilleur carré de 500 m, comme sur la carte, et la raison le dit (« chance du meilleur coin du
  secteur (arbres hôtes et sol) » ; le sol du point touché n'est alors pas compté en plus). Fichier
  des parts absent :
  météo seule. Sans cela, le bilan annonçait « favorable » en pleine ville dès qu'on dézoomait.
  (Sous le zoom 10 la carte ne montre plus que des cases de 18 km, allumées dès qu'un de leurs carrés
  l'est : le bilan, au carré de 4,5 km, y est plus précis qu'elle, c'est voulu.)
- **Pas d'appel là où rien n'est à estimer** (demande de Clément du 14/11/2026 : « pas besoin d'appel
  pour les villes ou les parcs »). `SpotPanel.open` décide une fois par clic, avant tout appel, ce qui
  écarte chaque champignon (`exclusion`, gardé dans `View.excluded`), dans cet ordre : la saison
  (`noEstimate`) ; la forêt sous le point quand elle est connue (« pas de forêt cartographiée sous ce
  point », « pas un arbre hôte ici ») ; puis le secteur. Ville, forêt connue : sous le zoom 11,
  « secteur urbanisé : zoomez pour juger ce bois » (la carte n'y allume rien non plus) ; à partir du
  zoom 11, le bilan suit le relevé des carrés de 500 m de la carte (`MeteoLayer.townSquareKept`, passé
  à `SpotPanel` par `mapView.ts`) : « secteur urbanisé, trop peu de bois autour du point » si la carte
  n'y dessinerait pas de carré, estimation si elle en dessine un ; relevé absent ou incomplet (grille
  éteinte, mode pluie, bord de l'écran) : on estime, quitte à demander une altitude de trop. Si les
  cinq champignons sont écartés : **ni altitude IGN, ni Open-Meteo de secours**
  (`weatherAt(…, sharedOnly)`) ; les lignes s'affichent tout de suite, l'altitude est celle de la
  grille météo (« ≈ N m (d'après la grille météo) », ou « non demandée (rien à estimer ici) » sans
  fichiers météo), terrain, statut, pluie et règles restent. Le fichier des parts n'est attendu que
  s'il peut changer la décision, et 2,5 s au plus (`SPOT_ALTITUDE_WAIT_MS`, un seul délai compté
  depuis le clic, qui vaut aussi pour l'altitude) : s'il ne répond pas, on estime sans lui, et s'il
  arrive ensuite la décision est revue et le bilan redessiné (sinon il resterait « favorable » en
  pleine ville ; l'altitude a alors été demandée pour rien). Une ligne écartée garde « ≈ 0 % » quand
  l'indice vaut zéro par construction (saison au poids nul, pas de forêt, pas d'arbre hôte) ; pour une
  ville (`Exclusion.zero` à faux) elle n'affiche pas de pourcentage : rien n'y a été estimé, et un
  « 0 % » contredirait « zoomez pour juger ce bois ».
- En secteur urbanisé (carré de 4,5 km bâti à 15 % ou plus, que le bilan estime ou non), sous la
  liste : « cueillez loin des routes, des zones industrielles et des décharges, les champignons
  absorbent les polluants », avec un lien vers `a-propos.html#identifier`, qui porte déjà ce conseil
  (Anses ; relu le 14/11/2026 sur service-public.gouv.fr, fiche A15186 du 14/10/2026). Le bilan ne
  fait pas partie des conditions : `TERMS_VERSION` ne change pas.
- La phrase de pluie d'un champignon commente la pluie la plus récente dont le délai n'est pas
  dépassé, plutôt qu'une vieille pluie « dépassée » qui pèse plus dans l'indice (sinon elle contredit
  le bloc météo) ; une pluie modeste encore fraîche ne promet rien (« pousse incertaine »).
  « pousse attendue d'ici N jours » est en gras dans sa raison (`reasonItem` de `spot.ts`, repérée par
  `AWAITED` de `mushrooms.ts` : garder les deux textes identiques) : c'est la seule qui dit quand revenir.
- Un `<details>` créé ouvert émet lui aussi « toggle » : ne retenir dans `SpotPanel.cards` que ce qui
  s'écarte de l'état d'office, sinon l'ancienne ligne reste dépliée quand le champignon recherché
  change. Le clavier retrouve sa place après un redessin par la clé `data-focus` de l'élément.
- **Légende** (`legend.ts`), dans l'ordre : « Je cherche… » (seule dépliée à la première visite),
  « Météo », « Types de forêt » (repliée, rappel « 15 / 32 » dans l'en-tête), « Nature du sol »,
  « Droit de cueillir », « Fond de carte : … », puis « Comment ça marche ? » et les liens. À la
  première visite le panneau tient sans défiler (test e2e). Une section à interrupteur se déplie
  quand sa couche est allumée, au chargement aussi.
- **Fiche d'un champignon** : résumé, lien « Photos et description : *espèce* sur MycoDB (site
  tiers) », conditions repliées, encadré de précaution en dernier. Les entrées sont des groupes : le
  lien nomme l'espèce visée ; adresses en dur dans `mushrooms.ts` (MycoDB répond 200 pour une fiche
  absente). Libellé neutre : ni « identifier », ni « comestible » (la fiche tierce, elle, l'écrit).
  **MycoDB interdit les robots d'IA dans son `robots.txt` et bloque les rafales : ne jamais
  l'interroger par script ni l'ajouter à `surveillance.yml`** ; une fiche se vérifie à la main.

Grille fine (`fineGrid.ts`, zoom ≥ `FINE_MIN_ZOOM` = 11, mode indice ; 12 avant le 15/11/2026, voir
« Carrés de 500 m dès l'échelle 2 km ») : chaque case de base de 4,5 km
(0,04° × 0,056°) est découpée en 9 × 9 carrés (id « I:J ») ; une case météo commune en contient
exactement 36 × 36 (parent : `cellOfBase`). Forêt et sol relevés sur 3 × 3 points par
carré, en une seule requête `queryRenderedFeatures` sur toute la vue puis test point-dans-polygone (un
appel par point serait bien plus lent), dès que les tuiles des forêts et des sols sont à l'écran, sans
attendre le fond de carte ; relevés gardés d'une visite à l'autre (voir « Relevés gardés »). Altitude IGN au centre, gardée
dans `localStorage` (`foret-explorer:altitudes`, 40 000 carrés au plus, écrit une fois par relevé),
demandée seulement à partir du zoom 12 (`FINE_ALTITUDE_MIN_ZOOM`) et pour les carrés **à dessiner
pour le champignon montré** (`fineToDraw` ; avant le
14/11/2026 : pour tout carré boisé, lande ou parc de ville compris), par lots de 200 points. Un carré
dont l'altitude n'est pas encore arrivée est dessiné tout de suite à celle de son carré de 4,5 km,
puis corrigé (de même si le service est en panne) : au changement de champignon les carrés ne
disparaissent pas, et `fineDone` ne bascule pas. Températures
de la case commune corrigées de −0,65 °C par 100 m ; la pluie reste celle de la case. Carré dessiné
seulement si trois de ses neuf points au moins sont sous un arbre hôte du champignon montré
(`FINE_MIN_HOST_SHARE`) ; en ville (son carré de 4,5 km est bâti à 15 % ou plus), il en faut cinq et
deux carrés voisins boisés sur huit (`fineCellsToDraw` : un parc isolé n'en pose plus). Un carré à
cheval sur le bord de l'écran, relevé en partie, est quand même compté sur neuf points, et seuls les
voisins connus comptent : au bord, un carré apparaît quand il est assez visible, il ne disparaît pas
après coup. Opacité
selon la part d'arbres hôtes ; un carré défavorable n'est pas dessiné (avant le 14/11/2026 : en
contour seul, des « carrés vides » illisibles). Les forêts s'estompent (45 %) à ces zooms.
Chaque carré de 500 m dessiné porte son pourcentage (`meteo-fin-etiquettes` : le chiffre seul sous le
zoom 12, texte de 8,5 px au zoom 11 ; « 62 % » ensuite, de 10 px au zoom 12 à 18 px au zoom 16). Avant le 14/11/2026 il n'arrivait qu'au zoom 14, et seulement à
50 % ou plus : aux échelles 1 km à 300 m il ne restait que la nuance de couleur (retour de Clément :
« un irritant »). Coût mesuré, étiquettes allumées puis éteintes en alternance, sans carte graphique :
446 étiquettes au zoom 12,4, 221 et 247 ms par image avec, 225 et 230 sans ; 157 au zoom 13,2, 130 et
135 ms avec, 125 et 126 sans. Rien de sensible.
⚠ Zoom MapLibre = zoom « 512 px » : au zoom 13, ≈ 5 m/pixel (pas 10).
