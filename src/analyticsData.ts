// Contenu de la vue « Analytics » : le seul fichier à modifier pour changer ce que la vue affiche.
//
// Règles
// - N'écrire que des chiffres réellement mesurés. Rien à montrer : laisser "", null ou [] ; la vue
//   affiche alors un état vide.
// - Textes entre guillemets doubles "comme ceci" : l'apostrophe de « l'entonnoir » y est sans danger.
//   Pour citer dans un texte : « ainsi », jamais de guillemet double à l'intérieur.
// - Dates : "AAAA-MM-JJ" (le 5 novembre 2026 s'écrit "2026-11-05").
// - Nombres : sans guillemets, un point pour les décimales, ni espace ni point pour les milliers
//   (12.5 et 1240). La vue les affiche à la française (12,5 et 1 240).
// - Pour remplir un bloc : copier son modèle, enlever les « // » du début de chaque ligne, puis
//   remplacer chaque A_REMPLIR. Un A_REMPLIR oublié fait échouer « npm run check ».
// - Avant d'envoyer : « npm run check », puis une branche et une pull request. Jamais directement sur
//   main : une erreur ici y bloquerait la publication du site, météo du jour comprise.
// - En développement (« npm run dev »), la vue liste en haut de page ce qui reste à corriger.
//
// Modèle d'un pari en cours (à la place de « currentBet: null, »)
//   currentBet: {
//     hypothesis: A_REMPLIR,   // l'hypothèse, en une phrase
//     kpi: A_REMPLIR,          // le KPI visé
//     threshold: A_REMPLIR,    // le seuil qui tranche
//     verdictDate: A_REMPLIR,  // la date du verdict
//   },
//
// Modèle d'une analyse (entre les crochets de « analyses », la plus récente en premier)
//     {
//       question: A_REMPLIR,    // la question posée
//       chart: null,            // ou un graphique (modèle suivant)
//       reading: A_REMPLIR,     // la lecture : ce que disent les chiffres
//       decision: A_REMPLIR,    // la décision prise
//       sampleSize: A_REMPLIR,  // la taille de l'échantillon, avec son unité et sa période
//       date: A_REMPLIR,        // la date de l'analyse
//     },
//
// Modèle d'un graphique (à la place de « chart: null, ») : des barres horizontales, pour les étapes
// d'un entonnoir, une comparaison ou une courte série dans le temps
//       chart: {
//         type: "bars",
//         unit: A_REMPLIR,      // facultatif : l'unité écrite après chaque valeur, "%" par exemple
//         points: [
//           { label: A_REMPLIR, value: A_REMPLIR },  // une ligne par barre, dans l'ordre d'affichage
//         ],
//       },
//
// Modèle d'un pari tranché (entre les crochets de « settledBets », le plus récent en premier)
//     {
//       hypothesis: A_REMPLIR,
//       kpi: A_REMPLIR,
//       threshold: A_REMPLIR,
//       verdictDate: A_REMPLIR,  // la date à laquelle le pari a été tranché
//       result: A_REMPLIR,       // le résultat mesuré
//       outcome: A_REMPLIR,      // "validated" (validé), "invalidated" (invalidé) ou "inconclusive" (non concluant)
//       decision: A_REMPLIR,     // la décision prise ensuite
//     },
//
// « Entonnoir en direct » n'a aucun champ ici : il sera branché sur la mesure, jamais rempli à la main.
// Le détail de chaque champ est dans src/analyticsTypes.ts.
import type { AnalyticsData } from './analyticsTypes';

export const ANALYTICS: AnalyticsData = {
  // En-tête : une phrase, affichée en grand. Vide : le titre « Analytics » la remplace.
  headline: "",

  // En-tête : le lien de contact, son texte puis son adresse (null : pas de lien).
  contact: { label: "Me contacter sur LinkedIn", url: "https://www.linkedin.com/in/cl%C3%A9ment-bril/" },

  // Pari en cours (null : aucun).
  currentBet: null,

  // Analyses, une carte par analyse.
  analyses: [],

  // Paris tranchés, une ligne par pari.
  settledBets: [],
};
