// Orchestrateur unitaire REQ : fetch (ou fixture) → extract → transform → JSON.
// Miroir de src/scrape.js, pour valider la mécanique sur UNE fiche avant toute
// collecte en masse (Charte : on cale la mécanique sur petit échantillon).
//
// Usage :
//   node src/req/scrapeReq.js --neq 1162487210                       # fetch live*
//   node src/req/scrapeReq.js --neq 1162487210 --fixture fixtures/req-1162487210.html
//   node src/req/scrapeReq.js --neq 1162487210 --fixture … --out out.json
//
//   *live : ne marche que là où le domaine REQ est joignable (pas dans
//    l'environnement géré, où la politique réseau le refuse — voir README).

import fs from 'node:fs';
import { fetchReq } from './fetchReq.js';
import { extractReq } from './extractReq.js';
import { transformReq } from './transformReq.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i += 1; }
      else args[key] = true;
    }
  }
  return args;
}

export async function scrapeReq({ neq, fixture } = {}) {
  const html = fixture
    ? fs.readFileSync(fixture, 'utf-8')
    : await fetchReq(neq);
  return transformReq(extractReq(html, { neq }));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.neq) {
    console.error('Erreur : --neq requis.');
    process.exit(1);
  }
  const result = await scrapeReq({ neq: args.neq, fixture: args.fixture });
  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, json + '\n');
    console.error(`Écrit : ${args.out}`);
  } else {
    process.stdout.write(json + '\n');
  }
  if (result._incomplete) {
    console.error('⚠️  _incomplete=true — parseur non calé (stub) ou fiche vide.'
      + ' Fournis une fixture réelle et câble les sélecteurs de extractReq.js.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
