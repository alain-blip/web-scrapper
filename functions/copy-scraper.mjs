// Embarque le parseur validé dans le bundle des Functions, SANS le réécrire.
// Copie src/ (fetch, extract, transform, scrape + collector/) du dépôt vers
// functions/lib/scraper/. Lancé automatiquement en predeploy (voir firebase.json)
// et exécutable à la main : `node functions/copy-scraper.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..', 'src');
const destDir = path.join(here, 'lib', 'scraper');

// Fichiers du parseur à embarquer (le reste de src/ n'est pas nécessaire ici).
const FICHIERS = [
  'fetch.js', 'extract.js', 'transform.js', 'scrape.js',
  'collector/regions.js', 'collector/regionSearch.js', 'collector/collectRegion.js',
];

fs.rmSync(destDir, { recursive: true, force: true });
for (const rel of FICHIERS) {
  const from = path.join(srcDir, rel);
  const to = path.join(destDir, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
console.log(`Parseur copié dans ${path.relative(here, destDir)} (${FICHIERS.length} fichiers).`);
