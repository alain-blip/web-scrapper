// Génère app-consultation/regions-actives.json : liste des cdRSS ayant au
// moins une fiche en base, avec leur libellé — réutilise LIBELLES
// (src/collector/regions.js), n'invente aucun nom de région.
//
// Lecture seule sur Firestore, écriture sur disque local uniquement (asset
// statique de présentation, pas une donnée de fiche — consultationApi n'est
// pas touché : il reste l'unique source des fiches elles-mêmes).
//
// Usage : node functions/regions-actives.mjs

import fs from 'node:fs';
import path from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { LIBELLES } from '../src/collector/regions.js';

initializeApp({ projectId: 'primexpert-msss-registre' });
const db = getFirestore();

const snap = await db.collection('residences').get();
const compte = {};
snap.forEach((d) => {
  const cd = d.data()._regionCdRSS;
  if (cd) compte[cd] = (compte[cd] || 0) + 1;
});

const regions = Object.entries(compte)
  .map(([cdRSS, total]) => ({ cdRSS, libelle: LIBELLES[cdRSS] || null, total }))
  .sort((a, b) => a.cdRSS.localeCompare(b.cdRSS));

const outPath = path.resolve('..', 'app-consultation', 'regions-actives.json');
fs.writeFileSync(outPath, JSON.stringify(regions, null, 2) + '\n');
console.log(`Écrit : ${outPath} (${regions.length} régions)`);
console.log(JSON.stringify(regions, null, 2));

process.exit(0);
