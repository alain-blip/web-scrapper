// Sourcing REQ quotidien — aligné sur le collecteur K10 de 3h00.
//
// Le collecteur (functions/index.js, onSchedule '0 3 * * *') collecte la/les
// région(s) du jour selon le calendrier de collector/regions.js. Ce script,
// lancé à 5h00 par launchd (voir scripts/com.primexpert.sourcing-req.plist),
// enrichit AU REQ ces mêmes fiches — en LOCAL, sur l'IP résidentielle, pour
// passer Cloudflare (une Cloud Function sur IP datacenter se ferait bloquer).
//
// Idempotent : saute les fiches déjà REQ_DONE. Jours 19–31 : rien à faire.
//
// Usage :
//   npx tsx src/local/sourcingQuotidien.ts            # exécution réelle
//   npx tsx src/local/sourcingQuotidien.ts --dry-run  # simule, ne scrape pas

import { Firestore } from '@google-cloud/firestore';
import { regionsPourJour, jourDuMoisMontreal, LIBELLES } from '../collector/regions.js';
import { executerSourcingInverseLocal } from './sourcingInverse';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const jour = jourDuMoisMontreal();
  const codes = regionsPourJour(jour);

  const horodatage = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'America/Montreal', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date());
  console.log(`\n===== Sourcing REQ quotidien — ${horodatage} (jour ${jour}) =====`);

  if (!codes.length) {
    console.log('📭 Hors calendrier (jours 19–31) : aucune région à enrichir aujourd’hui.');
    return;
  }

  const libelles = codes.map((c) => `${c} (${LIBELLES[c] || '?'})`).join(', ');
  console.log(`🗓️  Région(s) du jour : ${libelles}`);

  if (dryRun) {
    // Simulation : compte ce qui SERAIT traité, sans ouvrir de navigateur.
    const db = new Firestore({ projectId: 'primexpert-msss-registre' });
    const snap = await db.collection('residences').where('_regionCdRSS', 'in', codes).get();
    let sansNeq = 0, dejaFait = 0, aTraiter = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      const neq = d.section2_titulaires?.personneMorale?.neqNormalise;
      if (!neq) { sansNeq++; continue; }
      if (d.enrichissement?.sourcingInverse?.status === 'REQ_DONE') { dejaFait++; continue; }
      aTraiter++;
    }
    console.log(`🔎 [DRY-RUN] ${snap.size} fiches dans la région : ${aTraiter} à traiter, ${dejaFait} déjà REQ_DONE (sautées), ${sansNeq} sans NEQ.`);
    console.log('🔎 [DRY-RUN] Aucun scrape lancé.');
    return;
  }

  await executerSourcingInverseLocal({ codesRegions: codes });
}

main().catch((e) => {
  console.error('❌ Sourcing quotidien en échec :', e);
  process.exit(1);
});
