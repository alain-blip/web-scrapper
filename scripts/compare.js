// Compare le JSON produit par le scraper à un oracle de référence et affiche
// les différences exactes (champ par champ).
//
// Usage :
//   node scripts/compare.js --noForm 395 \
//        --fixture fixtures/murray-395.html \
//        --oracle output/sample/murray-395.json

import fs from 'node:fs';
import { scrape } from '../src/scrape.js';

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

// Aplatit un objet en chemins « a.b.c » → valeur (les tableaux deviennent
// a.0, a.1…). Les feuilles sont les valeurs scalaires / null.
function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') {
    out[prefix] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) out[prefix] = '[]';
    obj.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) out[prefix] = '{}';
  keys.forEach((k) => flatten(obj[k], prefix ? `${prefix}.${k}` : k, out));
  return out;
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  const args = parseArgs(process.argv);
  const oraclePath = args.oracle || 'output/sample/murray-395.json';
  const oracle = JSON.parse(fs.readFileSync(oraclePath, 'utf-8'));
  delete oracle._note; // champ méta non produit par le scraper

  const produced = await scrape({ noForm: args.noForm, fixture: args.fixture });

  const fo = flatten(oracle);
  const fp = flatten(produced);
  const allKeys = Array.from(new Set([...Object.keys(fo), ...Object.keys(fp)])).sort();

  const same = [];
  const diff = [];
  const onlyOracle = [];
  const onlyProduced = [];

  for (const k of allKeys) {
    const inO = k in fo;
    const inP = k in fp;
    if (inO && inP) {
      if (eq(fo[k], fp[k])) same.push(k);
      else diff.push({ k, oracle: fo[k], produced: fp[k] });
    } else if (inO) {
      onlyOracle.push({ k, oracle: fo[k] });
    } else {
      onlyProduced.push({ k, produced: fp[k] });
    }
  }

  const fmt = (v) => JSON.stringify(v);

  console.log('='.repeat(72));
  console.log(`COMPARAISON  produit  vs  oracle (${oraclePath})`);
  console.log('='.repeat(72));
  console.log(`Champs identiques : ${same.length}`);
  console.log(`Champs divergents : ${diff.length}`);
  console.log(`Seulement oracle  : ${onlyOracle.length}`);
  console.log(`Seulement produit : ${onlyProduced.length}`);

  if (diff.length) {
    console.log('\n--- DIVERGENCES (champ : oracle  ≠  produit) ---');
    for (const d of diff) {
      console.log(`  ${d.k}`);
      console.log(`      oracle  = ${fmt(d.oracle)}`);
      console.log(`      produit = ${fmt(d.produced)}`);
    }
  }
  if (onlyOracle.length) {
    console.log('\n--- CHAMPS MANQUANTS dans le produit ---');
    for (const d of onlyOracle) console.log(`  ${d.k}  (oracle = ${fmt(d.oracle)})`);
  }
  if (onlyProduced.length) {
    console.log('\n--- CHAMPS EN TROP dans le produit ---');
    for (const d of onlyProduced) console.log(`  ${d.k}  (produit = ${fmt(d.produced)})`);
  }

  const ok = diff.length === 0 && onlyOracle.length === 0 && onlyProduced.length === 0;
  console.log('\n' + (ok ? '✅ IDENTIQUE À L\'ORACLE' : '❌ DIFFÉRENCES DÉTECTÉES'));
  process.exit(ok ? 0 : 2);
}

main().catch((err) => { console.error(err); process.exit(1); });
