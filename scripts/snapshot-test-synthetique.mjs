// snapshot-test-synthetique.mjs — ÉTAPE 2bis / PARTIE A (script jetable, non commité)
//
// Fabrique un snapshot de TEST à changements connus, dérivé de la baseline
// _snapshots/snapshot_2026-08-02, pour valider le diff. Écrit UN doc de test
// (_snapshots/snapshot_TEST_synthetique). AUCUN commit, AUCUN déploiement.
// Ne touche PAS la baseline.
//
// Usage : node scripts/snapshot-test-synthetique.mjs

import { Firestore } from '@google-cloud/firestore';

const PROJET = 'primexpert-msss-registre';
const COL = '_snapshots';
const BASE = 'snapshot_2026-08-02';
const TEST = 'snapshot_TEST_synthetique';

const db = new Firestore({ projectId: PROJET });

async function main() {
  const baseSnap = await db.collection(COL).doc(BASE).get();
  if (!baseSnap.exists) { console.error(`ERREUR : baseline ${COL}/${BASE} introuvable.`); process.exit(1); }
  const base = baseSnap.data();
  const fiches = structuredClone(base.fiches);       // copie profonde — baseline intacte
  const parNoForm = new Map(fiches.map((f, i) => [String(f.noForm), i]));

  const used = new Set();
  // Sélectionne le 1er indice dont la fiche vérifie `pred` et n'est pas déjà pris.
  function choisir(pred) {
    for (let i = 0; i < fiches.length; i++) {
      if (used.has(i)) continue;
      if (pred(fiches[i])) { used.add(i); return i; }
    }
    return -1;
  }
  const estVideAssoc = (f) => !Array.isArray(f.associations) || f.associations.length === 0;

  const manips = [];

  // (a) nombreTotalUnites 16 → 20  (contenu→contenu, champ cœur)
  const ia = choisir((f) => f.nombreTotalUnites === 16);
  { const f = fiches[ia]; const avant = f.nombreTotalUnites; f.nombreTotalUnites = 20;
    manips.push({ tag: 'a', noForm: String(f.noForm), champ: 'nombreTotalUnites', nature: 'contenu→contenu', avant, apres: 20 }); }

  // (g) réordre associations (≥2 éléments) — NON-changement piège. Choisi tôt (rare).
  const ig = choisir((f) => Array.isArray(f.associations) && f.associations.length >= 2);
  { const f = fiches[ig]; const avant = [...f.associations]; f.associations = [...f.associations].reverse();
    manips.push({ tag: 'g', noForm: String(f.noForm), champ: 'associations', nature: 'réordre (NE DOIT PAS être signalé)', avant, apres: [...f.associations] }); }

  // (d) associations : ajout d'un élément (≥1 élément, non vide)
  const id = choisir((f) => Array.isArray(f.associations) && f.associations.length >= 1);
  { const f = fiches[id]; const avant = [...f.associations]; f.associations = [...f.associations, 'AUTRE'];
    manips.push({ tag: 'd', noForm: String(f.noForm), champ: 'associations', nature: 'ajout dans tableau', avant, apres: [...f.associations] }); }

  // (b) nomCompagnie contenu → null
  const ib = choisir((f) => typeof f.nomCompagnie === 'string' && f.nomCompagnie.trim() !== '');
  { const f = fiches[ib]; const avant = f.nomCompagnie; f.nomCompagnie = null;
    manips.push({ tag: 'b', noForm: String(f.noForm), champ: 'nomCompagnie', nature: 'contenu→vide', avant, apres: null }); }

  // (c) nomCompagnie null → contenu
  const ic = choisir((f) => f.nomCompagnie === null);
  { const f = fiches[ic]; f.nomCompagnie = 'Nouvelle inc.';
    manips.push({ tag: 'c', noForm: String(f.noForm), champ: 'nomCompagnie', nature: 'vide→contenu', avant: null, apres: 'Nouvelle inc.' }); }

  // (e) suppression d'une fiche → doit sortir "disparue"
  const ie = choisir(() => true);
  const noFormSupprime = String(fiches[ie].noForm);
  manips.push({ tag: 'e', noForm: noFormSupprime, champ: '(fiche entière)', nature: 'disparue', avant: 'présente', apres: 'supprimée' });

  // Construit la liste finale : retire (e), ajoute (f) la nouvelle 999999.
  const fichesFinal = fiches.filter((_, i) => i !== ie);
  const nouvelle = {
    noForm: '999999',
    nomResidence: 'Résidence Synthétique de Test',
    categorieRPA: 2,
    nombreTotalUnites: 42,
    nomCompagnie: 'Bidon Test inc.',
    nombreAutresResidences: 0,
    personneResponsable: [{ nom: 'TEST', prenom: 'Synthétique' }],
    associations: [],
  };
  fichesFinal.push(nouvelle);
  manips.push({ tag: 'f', noForm: '999999', champ: '(fiche entière)', nature: 'apparue', avant: 'absente', apres: 'ajoutée' });

  // Écrit le snapshot de test (métadonnées marquées TEST).
  const docTest = {
    _cree_le: base._cree_le ?? null,
    _test: true,
    _derive_de: BASE,
    _nb_fiches: fichesFinal.length,
    _cycle_complet: base._cycle_complet ?? null,
    _regions_vues: base._regions_vues ?? [],
    fiches: fichesFinal,
  };
  await db.collection(COL).doc(TEST).set(docTest);

  console.log(`✓ Snapshot de test écrit : ${COL}/${TEST}  (${fichesFinal.length} fiches ; baseline ${base.fiches.length})`);
  console.log('');
  console.log('===== TABLE DES 7 MANIPULATIONS (attendu) =====');
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('#', 3) + pad('noForm', 10) + pad('champ', 20) + pad('nature attendue', 34) + 'avant → après');
  console.log('-'.repeat(110));
  for (const m of manips) {
    const av = Array.isArray(m.avant) ? JSON.stringify(m.avant) : String(m.avant);
    const ap = Array.isArray(m.apres) ? JSON.stringify(m.apres) : String(m.apres);
    console.log(pad(m.tag, 3) + pad(m.noForm, 10) + pad(m.champ, 20) + pad(m.nature, 34) + `${av} → ${ap}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });
