// Mesure locale d'une collecte, SANS Firebase (n'écrit rien de durable).
// Sert à mesurer le rendement réel (fiches consultables vs redirections) et le
// temps d'exécution AVANT de décider d'un éventuel découpage.
//
// Usage :
//   node src/collector/runLocal.js --cdRSS 05 --limit 15
//   node src/collector/runLocal.js --jour 5            (utilise le calendrier)
//   node src/collector/runLocal.js --cdRSS 05 --throttle 1500 --out /tmp/05.json

import fs from 'node:fs';
import { collectRegion } from './collectRegion.js';
import { regionsPourJour, LIBELLES } from './regions.js';

function args(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2); const n = argv[i + 1];
      if (n && !n.startsWith('--')) { a[k] = n; i += 1; } else a[k] = true;
    }
  }
  return a;
}

async function main() {
  const a = args(process.argv);
  const codes = a.cdRSS ? [String(a.cdRSS)]
    : a.jour ? regionsPourJour(Number(a.jour))
      : null;
  if (!codes || !codes.length) {
    console.error('Préciser --cdRSS NN ou --jour J (jour avec collecte).');
    process.exit(1);
  }

  const collectees = [];
  const writeFiche = async (fiche) => {
    collectees.push({ noForm: fiche.noForm, nom: fiche.section1_identification?.nomResidence });
  };

  const tout = [];
  for (const cd of codes) {
    console.error(`\n=== Région ${cd} — ${LIBELLES[cd] || '?'} ===`);
    const stats = await collectRegion(cd, {
      writeFiche,
      throttleMs: a.throttle ? Number(a.throttle) : 1500,
      maxFiches: a.limit ? Number(a.limit) : Infinity,
      logger: (m) => console.error('  ' + m),
      onProgress: (p) => console.error(`  … ${p.nbEcrites} écrites / ${p.nbVues} vues`),
    });
    tout.push(stats);
    console.error(`  → listées=${stats.nbListe} vues=${stats.nbVues} écrites=${stats.nbEcrites}`
      + ` erreurs=${stats.nbErreurs} skips=${stats.skips.length} statut=${stats.statut}`
      + ` durée=${Math.round(stats.dureeMs / 1000)}s`);
  }

  const resume = { codes, fiches: collectees.length, stats: tout };
  if (a.out) { fs.writeFileSync(a.out, JSON.stringify(resume, null, 2)); console.error(`Écrit : ${a.out}`); }
  else console.log(JSON.stringify(resume, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
