// Orchestrateur M02 : liste → fiches détail → filtre CHSLD privés à but lucratif.
// Miroir de src/scrape.js. Valide la mécanique avant toute collecte/écriture.
//
// Usage :
//   node src/m02/scrapeM02.js --fixture-detail fixtures/m02-etab-122.html --cd 122
//   node src/m02/scrapeM02.js --fixture-liste fixtures/m02-liste.html      # parse liste seule
//   node src/m02/scrapeM02.js --live --limit 10                            # live (là où m02 répond)
//
// Le mode --live n'écrit RIEN : il imprime les retenus + un résumé chiffré.

import fs from 'node:fs';
import { fetchM02List, fetchM02Detail } from './fetchM02.js';
import { extractM02List, extractM02Detail } from './extractM02.js';
import { transformM02, verdictCHSLDPriveLucratif } from './transformM02.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
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
  const args = parseArgs(process.argv);

  if (args['fixture-detail']) {
    const html = fs.readFileSync(args['fixture-detail'], 'utf-8');
    const rec = transformM02(extractM02Detail(html, { cdIntervSocSan: args.cd }));
    const v = verdictCHSLDPriveLucratif(rec);
    process.stdout.write(JSON.stringify({ ...rec, _verdict: v }, null, 2) + '\n');
    return;
  }

  if (args['fixture-liste']) {
    const etabs = extractM02List(fs.readFileSync(args['fixture-liste'], 'utf-8'));
    console.error(`${etabs.length} établissements listés.`);
    process.stdout.write(JSON.stringify(etabs, null, 2) + '\n');
    return;
  }

  if (args.live) {
    const throttle = Number(args.throttle) || 1500;
    const limit = args.limit ? Number(args.limit) : Infinity;
    const etabs = extractM02List(await fetchM02List('Mission'));
    console.error(`Liste : ${etabs.length} établissements.`);
    const gardes = [];
    let vus = 0;
    for (const e of etabs) {
      if (vus >= limit) break;
      await sleep(throttle);
      vus += 1;
      try {
        const rec = transformM02(extractM02Detail(await fetchM02Detail(e.cdIntervSocSan), e));
        const v = verdictCHSLDPriveLucratif(rec);
        if (v.garder) gardes.push(rec);
      } catch (err) {
        console.error(`  erreur cd=${e.cdIntervSocSan}: ${err.message}`);
      }
    }
    console.error(`Vus ${vus} · retenus (CHSLD privés lucratifs) ${gardes.length}.`);
    process.stdout.write(JSON.stringify(gardes, null, 2) + '\n');
    return;
  }

  console.error('Précise --fixture-detail, --fixture-liste ou --live. Voir en-tête.');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
