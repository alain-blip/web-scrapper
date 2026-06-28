// Orchestrateur : fetch (ou fixture) → extract → transform → JSON.
//
// Usage :
//   node src/scrape.js --noForm 395                 # fetch live
//   node src/scrape.js --noForm 395 --out out.json  # + écrit le fichier
//   node src/scrape.js --fixture fixtures/murray-395.html --noForm 395

import fs from 'node:fs';
import { fetchFiche } from './fetch.js';
import { extract } from './extract.js';
import { transform } from './transform.js';

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

export async function scrape({ noForm, fixture } = {}) {
  let html;
  if (fixture) {
    // Les fixtures sont stockées en UTF-8 (artefact de test). Le chemin live
    // (fetchFiche) décode lui la réponse réelle en cp1252.
    html = fs.readFileSync(fixture, 'utf-8');
  } else {
    html = await fetchFiche(noForm);
  }
  const raw = extract(html, { noForm });
  return transform(raw);
}

async function main() {
  const args = parseArgs(process.argv);
  const noForm = args.noForm;
  if (!noForm) {
    console.error('Erreur : --noForm requis.');
    process.exit(1);
  }
  const result = await scrape({ noForm, fixture: args.fixture });
  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, json + '\n');
    console.error(`Écrit : ${args.out}`);
  } else {
    process.stdout.write(json + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
