// Test offline (aucune requête K10, aucune écriture Firestore) du fix F7 :
// 'suspect' se déclenche sur zéro écriture avec du volume, pas sur un taux de
// skip élevé — et ne doit jamais écraser un vrai blocage ('partiel').
//
// Usage : node scripts/test-suspect.mjs

import assert from 'node:assert/strict';
import { collectRegion } from '../src/collector/collectRegion.js';

const DETAIL_OK = '<html><a name="lien_1"></a>fiche complète</html>';
const ACCUEIL = '<html>Objet déplacé <a href="/K10accueil.asp">accueil</a></html>';

function residences(n) {
  return Array.from({ length: n }, (_, i) => ({ registre: String(2000 + i) }));
}

async function testRegionSaineFortSkipPasSuspect() {
  // 60 fiches : 1 sur 3 valide (20 écrites, 40 skips) — aucun streak >= 20
  // consécutifs (max = 2), donc le canary n'intervient jamais ici : ce test
  // isole la métrique F7, pas le canary.
  const chercherRegionFn = async () => ({ bloque: false, residences: residences(60) });
  const fetchFicheFn = async (noForm) => {
    const idx = Number(noForm) - 2000;
    return idx % 3 === 2 ? DETAIL_OK : ACCUEIL;
  };
  const stats = await collectRegion('05', {
    writeFiche: async () => {}, throttleMs: 0, chercherRegionFn, fetchFicheFn,
  });

  assert.notEqual(stats.statut, 'suspect', 'un fort taux de skip normal ne doit pas déclencher suspect');
  assert.equal(stats.nbEcrites, 20);
  assert.equal(stats.skips.length, 40);
  console.log('✅ testRegionSaineFortSkipPasSuspect');
}

async function testAncreRenommeeDeclencheSuspect() {
  // 15 fiches (< 20, sous le seuil canary — le streak ne l'atteint jamais),
  // toutes non consultables : simule un renommage d'ancre sur cette portion
  // de région sans engager le canary. Zéro écriture, volume suffisant.
  const chercherRegionFn = async () => ({ bloque: false, residences: residences(15) });
  const fetchFicheFn = async () => ACCUEIL;
  const stats = await collectRegion('05', {
    writeFiche: async () => {}, throttleMs: 0, chercherRegionFn, fetchFicheFn,
  });

  assert.equal(stats.bloque, false, 'le canary ne doit pas s\'être déclenché (streak < 20)');
  assert.equal(stats.nbEcrites, 0);
  assert.equal(stats.statut, 'suspect', 'zéro écriture sur du volume doit déclencher suspect');
  console.log('✅ testAncreRenommeeDeclencheSuspect');
}

async function testVraiBlocageResteParteielJamaisEcraseParSuspect() {
  // 25 fiches, TOUTES non consultables (canary y compris) : le streak de 20
  // déclenche le canary, qui échoue lui aussi (même page partout) → vrai
  // blocage. nbEcrites reste à 0 au moment de l'abort — le test critique :
  // 'partiel' ne doit JAMAIS être écrasé par 'suspect'.
  const chercherRegionFn = async () => ({ bloque: false, residences: residences(25) });
  const fetchFicheFn = async () => ACCUEIL; // y compris pour le canary (noForm 395)
  const stats = await collectRegion('05', {
    writeFiche: async () => {}, throttleMs: 0, chercherRegionFn, fetchFicheFn,
  });

  assert.equal(stats.bloque, true, 'le canary doit détecter le vrai blocage');
  assert.equal(stats.nbEcrites, 0);
  assert.equal(stats.statut, 'partiel', 'suspect ne doit JAMAIS écraser partiel — priorité au vrai blocage');
  console.log('✅ testVraiBlocageResteParteielJamaisEcraseParSuspect');
}

async function testPetitEchantillonSousLeSeuilPasSuspect() {
  // Région vide (type 17/18, 0 résidence attendue) : nbListe=0 → nbVues=0,
  // jamais suspecte.
  const statsVide = await collectRegion('17', {
    writeFiche: async () => {}, throttleMs: 0,
    chercherRegionFn: async () => ({ bloque: false, residences: [] }),
    fetchFicheFn: async () => ACCUEIL,
  });
  assert.equal(statsVide.nbVues, 0);
  assert.notEqual(statsVide.statut, 'suspect');

  // 3 fiches listées, toutes non consultables : nbVues=3 < MIN_VUES_SUSPECT(5),
  // pas assez de volume pour conclure à un bris — pas suspect non plus.
  const statsPetit = await collectRegion('05', {
    writeFiche: async () => {}, throttleMs: 0,
    chercherRegionFn: async () => ({ bloque: false, residences: residences(3) }),
    fetchFicheFn: async () => ACCUEIL,
  });
  assert.equal(statsPetit.nbVues, 3);
  assert.equal(statsPetit.nbEcrites, 0);
  assert.notEqual(statsPetit.statut, 'suspect', 'nbVues < 5 : pas assez de volume, pas suspect');

  console.log('✅ testPetitEchantillonSousLeSeuilPasSuspect');
}

async function main() {
  await testRegionSaineFortSkipPasSuspect();
  await testAncreRenommeeDeclencheSuspect();
  await testVraiBlocageResteParteielJamaisEcraseParSuspect();
  await testPetitEchantillonSousLeSeuilPasSuspect();
  console.log('\n✅ Tous les tests F7 passent (0 requête K10 réelle, 0 écriture Firestore).');
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
