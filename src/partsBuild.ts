/**
 * Ce que `scripts/foret/parts.mjs` lit du code de la carte pour fabriquer le fichier des parts : la
 * règle des carrés de 500 m, les champignons, la grille et le format du fichier. Vite en fait une
 * version lisible par Node (comme pour franceStats.ts) : le script n'en recopie rien. Le site, lui,
 * ne charge pas ce module.
 */
export { BDFORET, BUILT_MAX_COVER, FINE_DIVISIONS, GEOLOGY, SURVEY_TILE_ZOOM } from './config';
export { FINE_OFFSETS, rulesSignature, surveySquare } from './fineRule';
export { SHARE_FORMAT, packSquare } from './forestShare';
export { BASE_STEP_LAT, BASE_STEP_LON, METEO_FACTOR, SUB_COUNT, cellId } from './meteoGrid';
export { MUSHROOMS } from './mushrooms';
export { SOIL_BY_ID } from './soils';
