// Aperçu chiffré read-only de residences/ (primexpert-msss-registre).
// Aucune écriture. Usage : node scripts/apercu-firestore.mjs (depuis functions/
// pour firebase-admin, voir invocation dans le rapport).

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: 'primexpert-msss-registre' });
const db = getFirestore();

const snap = await db.collection('residences').get();
const fiches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

console.log(`Total fiches écrites : ${fiches.length}`);

console.log('\nRépartition par région (_regionCdRSS) :');
const parRegion = {};
for (const f of fiches) {
  const cd = f._regionCdRSS || '(inconnu)';
  parRegion[cd] = (parRegion[cd] || 0) + 1;
}
for (const [cd, n] of Object.entries(parRegion).sort()) {
  console.log(`  ${cd} : ${n}`);
}

console.log('\nÉchantillon (5 fiches) :');
for (const f of fiches.slice(0, 5)) {
  console.log(`  noForm=${f.id} | ${f.section1_identification?.nomResidence || '(sans nom)'}`
    + ` | catégorie=${f.section1_identification?.categorieRPA ?? '—'}`);
}

const nbAutresRPA = fiches.filter((f) => (f.section3_autresRPA?.liste || []).length > 0).length;
const nbImmeubles = fiches.filter((f) => (f.section1_identification?.immeublesAssocies || []).length > 0).length;
console.log(`\nFiches avec section3_autresRPA.liste non-vide : ${nbAutresRPA}`);
console.log(`Fiches avec immeublesAssocies non-vide : ${nbImmeubles}`);

process.exit(0);
