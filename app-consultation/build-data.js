// Génère app-consultation/data.js à partir des fiches JSON du registre.
//
// Pourquoi : ouvrir index.html en file:// (double-clic) interdit fetch() des
// JSON locaux (CORS). On embarque donc les fiches dans un fichier JS
// (window.REGISTRE) pour une page 100 % autonome, sans serveur.
//
// LECTURE SEULE sur les JSON : ce script ne fait que les lire.
//
// Usage : node app-consultation/build-data.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Jeu de test : les 4 fiches validées.
const SOURCES = [
  'output/sample/murray-395.json',
  'output/estrie/3629.json',
  'output/estrie/6529.json',
  'output/estrie/7948.json',
];

const fiches = SOURCES.map((rel) => {
  const fiche = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));
  delete fiche._note; // champ méta éventuel, non pertinent pour l'affichage
  fiche._source = rel; // trace de provenance (lecture seule)
  return fiche;
});

const banner = `// FICHIER GÉNÉRÉ par build-data.js — ne pas éditer à la main.\n`
  + `// Source : ${SOURCES.join(', ')}\n`;
const out = `${banner}window.REGISTRE = ${JSON.stringify(fiches, null, 2)};\n`;

fs.writeFileSync(path.join(__dirname, 'data.js'), out);
console.log(`data.js généré : ${fiches.length} fiches.`);
