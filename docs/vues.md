# Vues Carte et Analytics

Notes détaillées, sorties telles quelles de `CLAUDE.md` le 16/11/2026 : Claude Code ne les lit qu'à la
demande (index dans `CLAUDE.md`, « Avant de toucher à…, lire »). Un renvoi « voir « Titre » » désigne
une section de ce dossier.

## Deux vues : Carte et Analytics

- **Lien « vitrine »** (demande de Clément du 16/11/2026 : l'îlot invisible pour les cueilleurs,
  visible pour ses prospects freelance et entreprises ; `SHOWCASE` de `legal.ts`). Seule une adresse
  qui porte `?analytics` dans sa partie `?` (`?analytics`, `?analytics=1`, `?utm_source=x&analytics`)
  montre l'îlot et peut ouvrir la vue Analytics ; à l'adresse ordinaire, `vue=analytics` est ignoré,
  même tapé à la main, et la vue Analytics n'est pas chargée. Lien à donner :
  `https://aligotaure.github.io/foret-explorer/?analytics#vue=analytics` (ou sans `#vue=analytics`
  pour ouvrir sur la carte). Le mot est avant le `#` : ni MapLibre ni `view.ts` n'y touchent (vérifié
  dans le code de MapLibre : il ne remplace que ce qui suit le `#`), il reste donc tout au long de la
  visite ; il est lu une fois, à l'ouverture. Il suit les liens internes : « À propos » (`ABOUT_URL`)
  et ses deux « Retour à la carte » (`apropos.ts`), le lien « Carte » de l'îlot (`./?analytics`, pour
  un onglet ouvert à part). Deux endroits appliquent la règle : le script en tête d'`index.html`
  (avant le premier affichage, il pose `data-island` sur `<html>`, que la feuille de style lit) et
  `legal.ts` ; changer le mot aux deux. **Ce n'est pas un verrou** : le mot se lit dans le code, qui
  est public, comme le contenu de la vue Analytics (`analyticsData.ts`) ; un lien transmis par un
  prospect montre l'îlot à qui le reçoit. N'y mettre rien de confidentiel.
- **Adresse** : `#vue=analytics` à côté de la position que MapLibre tient à jour (`hash: 'carte'`),
  par exemple `#carte=11.5/45.92/6.19&vue=analytics` ; sans `vue=analytics`, c'est la carte.
  `view.ts` découpe le fragment à la main (jamais `URLSearchParams` : il encoderait les « / » de
  `carte=`, que MapLibre ne relirait plus) et passe toujours une adresse complète à `pushState`
  (une chaîne vide y est ignorée : l'adresse garderait `vue=analytics`).
- **Historique** : un clic sur l'îlot ajoute une entrée sans émettre `hashchange`, donc MapLibre ne
  déplace pas la carte ; Précédent et Suivant rendent à chaque entrée sa vue et, par MapLibre, sa
  position. En quittant la carte par l'îlot, `map.stop()` arrête le déplacement en cours : la
  position exacte est écrite dans l'entrée quittée. Pas de lien `href="#…"` dans la vue Analytics :
  il remplacerait tout le fragment, `vue=analytics` compris.
- **Chargement** : `main.ts` (≈ 4 ko) charge chaque vue à sa première ouverture. Arriver sur
  `#vue=analytics` ne demande ni MapLibre, ni tuile, ni fichier météo. Toutes les feuilles de style
  sont dans l'entrée, MapLibre d'abord (`style.css` corrige `.maplibregl-ctrl-bottom-right` et
  `.maplibregl-ctrl-scale`, de même poids), `analytics.css` compris : pas d'éclair au premier
  affichage, et un module chargé à la demande ne porte aucune feuille de style. Ses sélecteurs
  commencent tous par `#analytics`, `.analytics` ou `html[data-view='analytics']` : la carte n'en
  est pas changée.
- **En-tête d'`index.html`** : un script pose `data-view="analytics"` sur `<html>` avant le premier
  affichage (même règle que `view.ts`) ; sinon il précharge le code de la carte, dont
  `vite.config.ts` écrit le nom au build à la place de `__MAP_CHUNK__`. Mesuré le 13/11/2026 (build
  servi en gzip, réseau bridé) : la carte arrive comme avant le découpage (4G lente : 2,2 s ; 3G :
  7,9 s, soit +0,07 et +0,1 s) ; sans ce préchargement, +0,2 et +0,5 s. L'avertissement, lui,
  s'affiche 1,6 à 6 s plus tôt qu'avant (il n'attend plus MapLibre).
- **Carte masquée** : en vue Analytics, `#app` et tous ses descendants sont en `visibility: hidden`
  (`#app *` est nécessaire : MapLibre force `visibility: visible` sur ses crédits dépliés). Pas de
  `display: none` : la carte garde sa taille, sa position, sa légende et son bilan, et rien n'est
  rechargé au retour. `#app` est alors figé à `100vw` × `100svh` (ni la barre de défilement ni la
  barre d'adresse du téléphone ne le redimensionnent). `view.ts` reprend le clavier resté dans la vue
  masquée.
- **Avertissement** : c'est `main.ts` qui l'appelle, avec la vue Carte seulement ; quitter la carte
  sans l'avoir accepté le retire (`withdrawDisclaimer()`), y revenir le remontre, compte à rebours
  repris de zéro. Tant qu'il est à l'écran, l'îlot est inerte (fenêtre modale) : l'adresse à donner
  pour montrer la vue Analytics est `…/?analytics#vue=analytics`.
- **Îlot** : `nav` de deux liens (`aria-current="page"`), avant `#app` dans la page (premier arrêt de
  la touche Tab). 208 px × 46 px (`--island-width`, `--btn`), liens pleine hauteur, fond clair du
  segment actif en `::before` (glissement de 300 ms, bord meneur en premier ; rien si les animations
  sont réduites). Placé en `vw`, sans `transform`. Ce qu'il déplace, pour un lien « vitrine »
  seulement :
  - ≤ 640 px : îlot sur la première rangée, entre le bouton légende et les boutons de droite ; la
    recherche passe à la deuxième rangée (`.topbar` en `flex-wrap`, `pointer-events: none` sur le
    vide), les bandeaux du haut (« Choisissez un champignon », champignon de chargement, « risque de
    chou blanc ») à la troisième, arrêtés avant la colonne de boutons ;
  - de 641 à 1187 px : îlot à droite de la recherche (décentré) ; sous 760 px la recherche se
    resserre ; de 641 à 1127 px le bilan s'ouvre une rangée plus bas, et les bandeaux du haut
    aussi ;
  - à partir de 1188 px : centré, rien ne bouge.
  À l'adresse ordinaire (`html:not([data-island])`), l'îlot est en `display: none` (ni clavier ni
  lecteur d'écran), `--island-width` vaut 0 (la recherche garde ses 420 px), et sur téléphone
  `--island-row` aussi : la recherche revient sur la première rangée à côté du bouton légende, et ce
  qui se place sous elle (bandeaux, champignon de chargement tiroir ouvert, hauteur du bilan) remonte
  d'une rangée. Le schéma téléphone de « La carte en 3 gestes » ne dessine pas l'îlot. De 641 à
  1127 px, le bilan s'ouvre une rangée plus bas dans les deux cas (sans l'îlot, sur la première
  rangée, il chevaucherait encore la recherche sous 904 px de large : 8 + 46 + 8 + 420 px à gauche,
  360 + 62 px à droite).
- **Contenu de la vue Analytics** : tout vient de `src/analyticsData.ts` ("" , `null` ou `[]` : état
  vide). Guillemets doubles dans ce fichier (les apostrophes du français y sont sans danger), modèles
  en commentaire dont chaque champ vaut `A_REMPLIR` (un oubli fait échouer `npm run check`). Les
  types refusent une date à la française, une adresse sans https, un champ mal nommé ;
  `analyticsCheck.ts` relit le reste (date qui n'existe pas, texte vide, valeur négative), affiché
  en tête de vue en développement et vérifié par `npm run check` et par les tests e2e. Le rendu ne casse jamais (date impossible montrée telle quelle, graphique sans barre
  omis). Graphique : barres horizontales, une série, échelle à zéro, aucune valeur calculée.
  N'y écrire que des chiffres mesurés ; « Entonnoir en direct » reste un emplacement vide tant
  qu'aucune mesure n'est branchée. Jamais de modification directe sur `main` : une erreur y
  bloquerait `npm run check`, donc la publication quotidienne de la météo.
