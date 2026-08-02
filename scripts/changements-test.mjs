// changements-test.mjs — écrit UN doc _changements de test réaliste (jetable).
//
// Forme EXACTE du contrat produit par snapshotMensuel (functions/index.js:377).
// Sert à valider la route API ?vue=changements avant qu'un vrai diff mensuel
// n'existe. Écrit _changements/changements_TEST. AUCUN commit, AUCUN déploiement.
//
// Usage : node scripts/changements-test.mjs

import { Firestore, FieldValue } from '@google-cloud/firestore';

const PROJET = 'primexpert-msss-registre';
const COL = '_changements';
const ID = 'changements_TEST';

const db = new Firestore({ projectId: PROJET });

const document = {
  _cree_le: FieldValue.serverTimestamp(),
  _snapshot_ancien: 'snapshot_2026-08-02',
  _snapshot_recent: 'snapshot_TEST',
  apparues: ['999001', '999002'],
  disparues: ['1008'],
  modifiees: [
    { noForm: '1002', champs: [{ champ: 'nombreTotalUnites', avant: 16, apres: 20 }] },
    { noForm: '1007', champs: [{ champ: 'nomCompagnie', avant: '9477-2829 Québec inc.', apres: null }] },
    { noForm: '1011', champs: [
      { champ: 'associations', avant: ['RQRA'], apres: ['RQRA', 'AUTRE'] },
      { champ: 'nombreAutresResidences', avant: 0, apres: 3 },
    ] },
  ],
};

async function main() {
  await db.collection(COL).doc(ID).set(document);
  const relu = await db.collection(COL).doc(ID).get();
  const r = relu.data();
  console.log(`✓ Écrit : ${COL}/${ID}`);
  console.log(`  _snapshot_ancien : ${r._snapshot_ancien}`);
  console.log(`  _snapshot_recent : ${r._snapshot_recent}`);
  console.log(`  apparues  (${r.apparues.length}) : ${r.apparues.join(', ')}`);
  console.log(`  disparues (${r.disparues.length}) : ${r.disparues.join(', ')}`);
  console.log(`  modifiees (${r.modifiees.length}) : ${r.modifiees.map((m) => m.noForm).join(', ')}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });
