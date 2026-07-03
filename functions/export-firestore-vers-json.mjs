// Export read-only de residences/ (Firestore) vers des fichiers JSON locaux,
// un par fiche, pour l'appli de consultation statique (app-consultation/).
// Aucune écriture Firestore — lecture seule, écrit uniquement sur disque local.
//
// Usage : node functions/export-firestore-vers-json.mjs

import fs from 'node:fs';
import path from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: 'primexpert-msss-registre' });
const db = getFirestore();

const outDir = path.resolve('..', 'output', 'firestore-export');
fs.mkdirSync(outDir, { recursive: true });

const snap = await db.collection('residences').get();
let n = 0;
snap.forEach((doc) => {
  const data = doc.data();
  // _collecteLe est un Timestamp Firestore, non sérialisable tel quel en JSON.
  const propre = { ...data, _collecteLe: data._collecteLe?.toDate?.().toISOString() || null };
  fs.writeFileSync(path.join(outDir, `${doc.id}.json`), JSON.stringify(propre, null, 2));
  n += 1;
});

console.log(`Export terminé : ${n} fiches → ${outDir}`);
process.exit(0);
