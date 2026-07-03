// Seed initial de la liste blanche _accesAutorises (Firestore).
// Écriture explicitement demandée à l'étape 2 du mur — pas une exception au
// read-only de consultationApi.js (qui ne lit que cette collection, jamais
// n'y écrit).
//
// Usage : node functions/seed-acces-autorises.mjs

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp({ projectId: 'primexpert-msss-registre' });
const db = getFirestore();

const ENTREES = [
  { email: 'alain@alainstjean.com', ajoutePar: 'alain@alainstjean.com' },
  { email: 'infostellacaputo@gmail.com', ajoutePar: 'alain@alainstjean.com' },
];

for (const e of ENTREES) {
  const id = e.email.toLowerCase();
  await db.collection('_accesAutorises').doc(id).set({
    email: id,
    ajoutePar: e.ajoutePar,
    ajouteLe: FieldValue.serverTimestamp(),
    actif: true,
  }, { merge: true });
  console.log(`Ajouté/mis à jour : ${id}`);
}

process.exit(0);
