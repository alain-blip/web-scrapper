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

// Jeu de test d'origine : les 4 fiches validées à la main.
const SOURCES = [
  'output/sample/murray-395.json',
  'output/estrie/3629.json',
  'output/estrie/6529.json',
  'output/estrie/7948.json',
];

const fichesManuelles = SOURCES.map((rel) => {
  const fiche = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));
  delete fiche._note; // champ méta éventuel, non pertinent pour l'affichage
  fiche._source = rel; // trace de provenance (lecture seule)
  return fiche;
});

// Export Firestore réel (output/firestore-export/, généré par
// functions/export-firestore-vers-json.mjs — lecture seule sur Firestore).
// Ces fiches, plus fraîches, priment sur les échantillons manuels en cas de
// même noForm (ex. 7948 : snapshot manuel de juin vs export réel de ce soir).
const exportDir = path.join(root, 'output', 'firestore-export');
const fichesExport = fs.existsSync(exportDir)
  ? fs.readdirSync(exportDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const fiche = JSON.parse(fs.readFileSync(path.join(exportDir, f), 'utf-8'));
      fiche._source = `firestore:residences/${fiche.noForm}`;
      return fiche;
    })
  : [];

const parNoForm = new Map();
for (const f of fichesManuelles) parNoForm.set(String(f.noForm), f);
for (const f of fichesExport) parNoForm.set(String(f.noForm), f); // priorité à l'export réel
const fiches = [...parNoForm.values()];

const banner = `// FICHIER GÉNÉRÉ par build-data.js — ne pas éditer à la main.\n`
  + `// Sources : ${SOURCES.join(', ')} + ${fichesExport.length} fiches de\n`
  + `// output/firestore-export/ (export Firestore residences/, lecture seule).\n`;
const out = `${banner}window.REGISTRE = ${JSON.stringify(fiches, null, 2)};\n`;

fs.writeFileSync(path.join(__dirname, 'data.js'), out);
console.log(`data.js généré : ${fiches.length} fiches.`);
