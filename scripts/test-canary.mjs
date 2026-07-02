// Test offline (aucune requête K10) du canary de détection de blocage réel
// dans collectRegion.js. Injecte fetchFicheFn/chercherRegionFn simulés.
//
// Usage : node scripts/test-canary.mjs

import assert from 'node:assert/strict';
import { collectRegion } from '../src/collector/collectRegion.js';

const DETAIL_OK = '<html><a name="lien_1"></a>fiche complète</html>';
const ACCUEIL = '<html>Objet déplacé <a href="/K10accueil.asp">accueil</a></html>';

function residences(n) {
  return Array.from({ length: n }, (_, i) => ({ registre: String(1000 + i) }));
}

async function testCanaryEchoueAborte() {
  // 25 fiches listées, toutes non consultables (accueil). Canary tous les 20
  // skips → doit se déclencher une fois (au 20e skip) et échouer lui aussi
  // (même page accueil) → arrêt réel attendu.
  const chercherRegionFn = async () => ({ bloque: false, residences: residences(25) });
  const fetchFicheFn = async () => ACCUEIL; // tout — y compris le canary — échoue
  const ecrites = [];
  const stats = await collectRegion('05', {
    writeFiche: async (f) => ecrites.push(f),
    throttleMs: 0,
    chercherRegionFn,
    fetchFicheFn,
  });

  assert.equal(stats.bloque, true, 'doit détecter un vrai blocage (canary en échec)');
  assert.equal(stats.statut, 'partiel');
  assert.equal(stats.nbVues, 20, 'doit s\'arrêter au skip qui déclenche le canary (20e)');
  assert.equal(stats.nbEcrites, 0);
  console.log('✅ testCanaryEchoueAborte');
}

async function testLongStreakSkipsLegitimesContinue() {
  // 60 fiches listées : les 45 premières non consultables (skips légitimes,
  // largement > ancien seuilBlocage=10), puis 15 valides. Le canary (fixe,
  // noForm=395) charge toujours → aucun arrêt, tout le streak de skips est
  // traversé, les 15 fiches valides sont écrites.
  const chercherRegionFn = async () => ({ bloque: false, residences: residences(60) });
  const fetchFicheFn = async (noForm) => {
    if (noForm === '395') return DETAIL_OK; // canary toujours bon
    const idx = Number(noForm) - 1000;
    return idx < 45 ? ACCUEIL : DETAIL_OK;
  };
  const ecrites = [];
  const stats = await collectRegion('05', {
    writeFiche: async (f) => ecrites.push(f),
    throttleMs: 0,
    chercherRegionFn,
    fetchFicheFn,
  });

  assert.equal(stats.bloque, false, 'un long streak de skips légitimes ne doit pas déclencher un arrêt');
  assert.equal(stats.nbVues, 60, 'doit traiter toute la région malgré 45 skips consécutifs');
  assert.equal(stats.skips.length, 45);
  assert.equal(stats.nbEcrites, 15, 'les 15 fiches valides après le streak doivent être écrites');
  console.log('✅ testLongStreakSkipsLegitimesContinue');
}

async function main() {
  await testCanaryEchoueAborte();
  await testLongStreakSkipsLegitimesContinue();
  console.log('\n✅ Tous les tests canary passent (0 requête K10 réelle).');
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
