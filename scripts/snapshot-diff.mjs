// snapshot-diff.mjs — ÉTAPE 2bis / PARTIE B (script jetable, non commité)
//
// Compare deux snapshots de la collection _snapshots selon NOS règles :
//   - vide = null | undefined | "" | []  (tous équivalents)
//   - signale : vide→contenu, contenu→vide, contenu→contenu différent
//   - ne signale jamais : vide→vide, ni identique
//   - tableaux (personneResponsable, associations) : comparaison par ENSEMBLE
//     trié (ajout/retrait = changement ; réordre = PAS un changement)
//   - apparues / disparues / modifiées, par noForm
//
// LECTURE SEULE. Usage : node scripts/snapshot-diff.mjs <idAncien> <idRecent>

import { Firestore } from '@google-cloud/firestore';

const PROJET = 'primexpert-msss-registre';
const COL = '_snapshots';
const db = new Firestore({ projectId: PROJET });

// Les 7 champs surveillés. kind: 'scalaire' | 'tableau'.
const CHAMPS = [
  { cle: 'nomResidence', kind: 'scalaire' },
  { cle: 'categorieRPA', kind: 'scalaire' },
  { cle: 'nombreTotalUnites', kind: 'scalaire' },
  { cle: 'nomCompagnie', kind: 'scalaire' },
  { cle: 'nombreAutresResidences', kind: 'scalaire' },
  { cle: 'personneResponsable', kind: 'tableau' },
  { cle: 'associations', kind: 'tableau' },
];

const estVide = (v) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

// Forme canonique triée d'un tableau (chaînes ou {nom,prenom}) → clé comparable.
function cleTableau(arr) {
  if (!Array.isArray(arr)) return '[]';
  return JSON.stringify(
    arr.map((el) => (el && typeof el === 'object' ? `${el.nom ?? ''}|${el.prenom ?? ''}` : String(el)))
       .sort()
  );
}

// Compare un champ. Renvoie null si pas de changement, sinon {avant, apres}.
function comparerChamp(champ, a, b) {
  if (champ.kind === 'tableau') {
    if (estVide(a) && estVide(b)) return null;              // vide→vide
    if (cleTableau(a) === cleTableau(b)) return null;       // même ensemble (réordre inclus)
    return { avant: a ?? [], apres: b ?? [] };
  }
  // scalaire
  const av = estVide(a), bv = estVide(b);
  if (av && bv) return null;                                 // vide→vide
  if (!av && !bv && a === b) return null;                    // identique
  return { avant: a ?? null, apres: b ?? null };             // les 3 cas signalés
}

const fmt = (v) => (Array.isArray(v) ? JSON.stringify(v) : v === null ? 'null' : String(v));

async function charger(id) {
  const s = await db.collection(COL).doc(id).get();
  if (!s.exists) { console.error(`ERREUR : ${COL}/${id} introuvable.`); process.exit(1); }
  const fiches = s.data().fiches ?? [];
  return new Map(fiches.map((f) => [String(f.noForm), f]));
}

async function main() {
  const [idA, idB] = process.argv.slice(2);
  if (!idA || !idB) { console.error('Usage : node scripts/snapshot-diff.mjs <idAncien> <idRecent>'); process.exit(1); }

  const ancien = await charger(idA);
  const recent = await charger(idB);

  console.log(`# Diff : ${idA} (ancien, ${ancien.size} fiches)  →  ${idB} (récent, ${recent.size} fiches)`);
  console.log('');

  const apparues = [];
  const disparues = [];
  const modifiees = [];

  for (const noForm of recent.keys()) if (!ancien.has(noForm)) apparues.push(noForm);
  for (const noForm of ancien.keys()) if (!recent.has(noForm)) disparues.push(noForm);

  for (const [noForm, fA] of ancien) {
    const fB = recent.get(noForm);
    if (!fB) continue;
    const changes = [];
    for (const champ of CHAMPS) {
      const d = comparerChamp(champ, fA[champ.cle], fB[champ.cle]);
      if (d) changes.push({ champ: champ.cle, ...d });
    }
    if (changes.length) modifiees.push({ noForm, changes });
  }

  apparues.sort(); disparues.sort();
  modifiees.sort((x, y) => (x.noForm < y.noForm ? -1 : 1));

  console.log(`===== APPARUES (${apparues.length}) =====`);
  console.log(apparues.length ? apparues.join(', ') : '(aucune)');
  console.log('');
  console.log(`===== DISPARUES (${disparues.length}) =====`);
  console.log(disparues.length ? disparues.join(', ') : '(aucune)');
  console.log('');
  console.log(`===== MODIFIÉES (${modifiees.length}) =====`);
  if (!modifiees.length) console.log('(aucune)');
  for (const m of modifiees) {
    console.log(`• noForm ${m.noForm} :`);
    for (const c of m.changes) console.log(`    - ${c.champ} : ${fmt(c.avant)} → ${fmt(c.apres)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });
