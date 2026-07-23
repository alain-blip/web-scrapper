// Sourcing REQ quotidien — sélection backlog (remplace le miroir jour-pour-
// jour du calendrier K10).
//
// Cible : résidences avec section2_titulaires.personneMorale.neqNormalise
// peuplé ET sans enrichissement.sourcingInverse (jamais touchées par ce
// pipeline), les plus anciennes (_collecteLe) en premier. Plafonné à
// PLAFOND_FICHES ou TIME_BOX_MS, ce qui arrive en premier — KISS, pas de
// pagination Firestore, la base tient en mémoire (~1600 docs).
//
// Tourne TOUS les jours, y compris 19–31 (l'ancien calendrier régional ne
// s'applique plus au REQ — il reste utilisé tel quel par le collecteur K10
// de 3h00, functions/index.js, non touché ici).
//
// Idempotent + auto-réparant : la sélection relit à chaque run "ce qui manque
// encore" depuis Firestore, jamais un état local. Une coupure (crash, panne
// de courant, machine éteinte) ne perd rien : chaque fiche déjà écrite ne
// sera plus jamais resélectionnée ; le reste du backlog attend le prochain
// run, qu'il soit demain ou dans 3 jours.
//
// Usage :
//   npx tsx src/local/sourcingQuotidien.ts            # exécution réelle
//   npx tsx src/local/sourcingQuotidien.ts --dry-run  # simule, ne scrape pas

import { Firestore } from '@google-cloud/firestore';
import { executerSourcingInverseLocal } from './sourcingInverse';

const dryRun = process.argv.includes('--dry-run');

const PLAFOND_FICHES = 150;
const TIME_BOX_MS = 90 * 60 * 1000; // 90 minutes

async function selectionnerBacklog(db: Firestore) {
  // Même filtre que l'ex-branche "balayage complet" de sourcingInverse.ts
  // (Règle #0 — on réutilise plutôt que d'inventer un autre filtre).
  const snap = await db.collection('residences')
    .where('section2_titulaires.personneMorale.neqNormalise', '!=', '')
    .get();

  return snap.docs
    .filter((doc) => !doc.data().enrichissement?.sourcingInverse)
    .sort((a, b) => {
      const ta = a.data()._collecteLe?.toMillis?.() ?? 0;
      const tb = b.data()._collecteLe?.toMillis?.() ?? 0;
      return ta - tb; // plus anciennes (_collecteLe le plus petit) en premier
    });
}

async function main() {
  const horodatage = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'America/Montreal', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date());
  console.log(`\n===== Sourcing REQ backlog — ${horodatage} =====`);

  const db = new Firestore({ projectId: 'primexpert-msss-registre' });
  const backlog = await selectionnerBacklog(db);
  const lot = backlog.slice(0, PLAFOND_FICHES);

  console.log(`📋 Backlog : ${backlog.length} fiche(s) jamais enrichies. Lot de ce run : ${lot.length}`
    + ` (plafond ${PLAFOND_FICHES}, time-box ${TIME_BOX_MS / 60000} min).`);

  if (dryRun) {
    console.log('🔎 [DRY-RUN] Aucun scrape lancé.');
    return;
  }

  if (!lot.length) {
    console.log('✅ Backlog vide — rien à enrichir aujourd’hui.');
    return;
  }

  await executerSourcingInverseLocal({ docs: lot, timeBoxMs: TIME_BOX_MS });
}

main().catch((e) => {
  console.error('❌ Sourcing backlog en échec :', e);
  process.exit(1);
});
