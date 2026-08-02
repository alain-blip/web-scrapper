// snapshot-dryrun.mjs — DIAGNOSTIC LECTURE SEULE (script jetable, non commité)
//
// But : ÉTAPE 1 du système de veille. Faire un full scan de la collection
// Firestore `residences` (~1596 fiches attendues) du projet
// `primexpert-msss-registre` et produire un RAPPORT DE COUVERTURE sur les
// 7 champs surveillés (+ noForm).
//
// N'ÉCRIT RIEN. Ne crée aucune collection. Ne touche NI src/ NI functions/.
// Utilise @google-cloud/firestore (dépendance racine du repo) + Application
// Default Credentials (ADC).
//
// Fail-safe : distingue explicitement « non-vide », « vide » (présent mais ''
// ou []), « null » (présent = null) et « absent » (clé/parent manquant). Ne
// fabrique aucune valeur.
//
// Usage : node scripts/snapshot-dryrun.mjs

import { Firestore } from '@google-cloud/firestore';

const PROJET = 'primexpert-msss-registre';
const COLLECTION = 'residences';
const ATTENDU = 1596;

const db = new Firestore({ projectId: PROJET });

// Accès chemin pointé qui distingue « absent » (undefined) de « null ».
// Renvoie { present:bool, value } — present=false si une clé du chemin manque.
function lireChemin(doc, chemin) {
  let cur = doc;
  const parts = chemin.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return { present: false, value: undefined };
    }
    if (!(parts[i] in cur)) return { present: false, value: undefined };
    cur = cur[parts[i]];
  }
  return { present: true, value: cur };
}

// Classe une valeur de champ en 4 catégories mutuellement exclusives.
function classer({ present, value }) {
  if (!present || value === undefined) return 'absent';
  if (value === null) return 'null';
  if (typeof value === 'string' && value.trim() === '') return 'vide';
  if (Array.isArray(value) && value.length === 0) return 'vide';
  return 'nonvide';
}

// Les 7 champs surveillés (le libellé de type sert seulement à l'affichage).
const CHAMPS = [
  { cle: 'section1_identification.nomResidence', type: 'string' },
  { cle: 'section1_identification.categorieRPA', type: 'int 1-4' },
  { cle: 'section1_identification.nombreTotalUnitesImmeubles', type: 'int' },
  { cle: 'section2_titulaires.personneMorale.nomCompagnie', type: 'string|null' },
  { cle: 'section3_autresRPA.nombreAutresResidences', type: 'int (Q3.2)' },
  { cle: 'section4_personneResponsable', type: 'array[{nom,prenom}]' },
  { cle: 'section8_reconnaissance.associations', type: 'array<string>' },
];

// Détecte le nom littéral « Aucun » dans section4 (élément objet {nom,prenom}
// ou, par prudence, élément chaîne). Comparaison trim + insensible à la casse.
function section4ContientAucun(value) {
  if (!Array.isArray(value)) return false;
  const estAucun = (s) => typeof s === 'string' && s.trim().toLowerCase() === 'aucun';
  return value.some((el) => {
    if (el && typeof el === 'object') return estAucun(el.nom) || estAucun(el.prenom);
    return estAucun(el);
  });
}

async function main() {
  console.log(`# Projet      : ${PROJET}`);
  console.log(`# Collection  : ${COLLECTION}  (attendu ≈ ${ATTENDU})`);
  console.log(`# Mode        : LECTURE SEULE — aucune écriture, aucun commit`);
  console.log('');

  // Full scan. 1596 docs tiennent largement dans un seul get().
  const snap = await db.collection(COLLECTION).get();
  const docs = snap.docs;
  const total = docs.length;

  // Compteurs de couverture par champ.
  const cov = {};
  for (const c of CHAMPS) cov[c.cle] = { nonvide: 0, vide: 0, null: 0, absent: 0 };

  // Compteurs de cas de bord.
  let nomCompagnieNull = 0;
  let section4Aucun = 0;
  let associationsVides = 0;
  let autresResNonNum = 0; // absent OU non-numérique (NaN inclus)

  for (const doc of docs) {
    const d = doc.data();

    for (const c of CHAMPS) {
      const cat = classer(lireChemin(d, c.cle));
      cov[c.cle][cat]++;
    }

    // Cas de bord — évalués sur la valeur brute, indépendamment du classement.
    const nomComp = lireChemin(d, 'section2_titulaires.personneMorale.nomCompagnie');
    if (nomComp.present && nomComp.value === null) nomCompagnieNull++;

    const s4 = lireChemin(d, 'section4_personneResponsable');
    if (section4ContientAucun(s4.value)) section4Aucun++;

    const assoc = lireChemin(d, 'section8_reconnaissance.associations');
    if (Array.isArray(assoc.value) && assoc.value.length === 0) associationsVides++;

    const nar = lireChemin(d, 'section3_autresRPA.nombreAutresResidences');
    const numOK = nar.present && typeof nar.value === 'number' && Number.isFinite(nar.value);
    if (!numOK) autresResNonNum++;
  }

  // ---- RAPPORT DE COUVERTURE ----
  console.log('===== RAPPORT DE COUVERTURE =====');
  console.log(`Fiches lues : ${total}` +
    (total === ATTENDU ? '  (= attendu)' : `  (⚠ attendu ${ATTENDU}, écart ${total - ATTENDU})`));
  console.log('');
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(pad('Champ', 52) + padL('non-vide', 9) + padL('vide', 7) + padL('null', 7) + padL('absent', 8));
  console.log('-'.repeat(83));
  for (const c of CHAMPS) {
    const x = cov[c.cle];
    console.log(pad(c.cle, 52) + padL(x.nonvide, 9) + padL(x.vide, 7) + padL(x.null, 7) + padL(x.absent, 8));
  }
  console.log('');
  console.log('  (« vide » = présent mais chaîne "" ou tableau [] ; « null » = présent = null ;');
  console.log('   « absent » = clé ou parent manquant. Somme des 4 = total pour chaque champ.)');

  console.log('');
  console.log('===== CAS DE BORD =====');
  console.log(`nomCompagnie null (personne morale absente)     : ${nomCompagnieNull}`);
  console.log(`section4 contenant le nom littéral "Aucun"      : ${section4Aucun}`);
  console.log(`associations = [] (tableau vide)                : ${associationsVides}`);
  console.log(`nombreAutresResidences absent ou non-numérique  : ${autresResNonNum}`);

  // ---- 3 FICHES EXEMPLE (7 champs bruts) ----
  console.log('');
  console.log('===== 3 FICHES EXEMPLE (champs bruts) =====');
  for (const doc of docs.slice(0, 3)) {
    const d = doc.data();
    const brut = {
      noForm: lireChemin(d, 'noForm').value,
      'section1_identification.nomResidence': lireChemin(d, 'section1_identification.nomResidence').value,
      'section1_identification.categorieRPA': lireChemin(d, 'section1_identification.categorieRPA').value,
      'section1_identification.nombreTotalUnitesImmeubles': lireChemin(d, 'section1_identification.nombreTotalUnitesImmeubles').value,
      'section2_titulaires.personneMorale.nomCompagnie': lireChemin(d, 'section2_titulaires.personneMorale.nomCompagnie').value,
      'section3_autresRPA.nombreAutresResidences': lireChemin(d, 'section3_autresRPA.nombreAutresResidences').value,
      section4_personneResponsable: lireChemin(d, 'section4_personneResponsable').value,
      'section8_reconnaissance.associations': lireChemin(d, 'section8_reconnaissance.associations').value,
    };
    console.log(`\n--- docId=${doc.id} ---`);
    console.log(JSON.stringify(brut, null, 2));
  }

  console.log('');
  console.log(`(FIN — ${total} fiche(s) lue(s), 0 écriture)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });
