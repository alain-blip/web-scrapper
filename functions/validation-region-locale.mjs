// Outil de validation locale : collecte UNE région complète (sans cap),
// écriture Firestore réelle (mêmes sanitizeFirestore/merge que
// functions/index.js), SANS toucher/redéployer collecteTest ni sa limite.
// Réutilise collectRegion tel quel (Règle #0). Garde le rythme de prod
// (throttleMs 1500) — ce n'est pas un raccourci de vitesse, juste un
// contournement du cap de collecteTest pour une passe de validation complète.
//
// Usage : node functions/validation-region-locale.mjs [cdRSS]  (défaut 05)

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { collectRegion } from '../src/collector/collectRegion.js';
import { LIBELLES } from '../src/collector/regions.js';

initializeApp({ projectId: 'primexpert-msss-registre' });
const db = getFirestore();

function sanitizeFirestore(obj, prefix, manquants) {
  if (obj === undefined) { manquants.push(prefix); return null; }
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((v, i) => sanitizeFirestore(v, `${prefix}[${i}]`, manquants));
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = sanitizeFirestore(v, prefix ? `${prefix}.${k}` : k, manquants);
  }
  return out;
}

const cdRSS = process.argv[2] || '05';
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montreal' }).format(new Date());
const logRef = db.collection('_collectionLog').doc(`VALIDATION_${cdRSS}_${date.replace(/\//g, '-')}`);
await logRef.set({
  mode: 'validation-locale', date, cdRSS, libelle: LIBELLES[cdRSS] || null,
  statut: 'en_cours', maj: FieldValue.serverTimestamp(),
}, { merge: true });

const writeFiche = async (fiche, meta) => {
  const manquants = [];
  const ficheClean = sanitizeFirestore(fiche, '', manquants);
  const flagsIncomplete = manquants.length > 0 ? { _incomplete: true, _champsManquants: manquants } : {};
  await db.collection('residences').doc(String(fiche.noForm)).set({
    ...ficheClean, ...flagsIncomplete,
    _regionCdRSS: meta.cdRSS, _collecteLe: FieldValue.serverTimestamp(),
  }, { merge: true });
};

console.error(`=== Validation complète région ${cdRSS} — écriture Firestore réelle ===`);
const stats = await collectRegion(cdRSS, {
  writeFiche,
  throttleMs: 1500,
  logger: (m) => console.error('  ' + m),
  onProgress: (p) => console.error(`  … ${p.nbEcrites} écrites / ${p.nbVues} vues`),
});

await logRef.set({
  mode: 'validation-locale', date, cdRSS, libelle: LIBELLES[cdRSS] || null,
  nbListe: stats.nbListe, nbVues: stats.nbVues, nbEcrites: stats.nbEcrites,
  nbErreurs: stats.nbErreurs, nbSkips: stats.skips.length,
  skipsNoForm: stats.skips.slice(0, 200),
  erreursDetail: stats.erreurs.slice(0, 200),
  bloque: stats.bloque, statut: stats.statut, dureeMs: stats.dureeMs,
  maj: FieldValue.serverTimestamp(),
}, { merge: true });

console.error('\n=== RÉSUMÉ ===');
console.error(JSON.stringify({
  cdRSS, libelle: LIBELLES[cdRSS],
  nbListe: stats.nbListe, nbVues: stats.nbVues, nbEcrites: stats.nbEcrites,
  nbErreurs: stats.nbErreurs, nbSkips: stats.skips.length,
  bloque: stats.bloque, statut: stats.statut, dureeMs: stats.dureeMs,
  erreursDetail: stats.erreurs,
}, null, 2));

process.exit(0);
