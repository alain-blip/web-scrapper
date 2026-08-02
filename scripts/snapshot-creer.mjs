// snapshot-creer.mjs — ÉTAPE 2 : écriture de la baseline (script jetable, non commité)
//
// But : lire tout `residences` (full scan) et écrire UN SEUL document dans la
// collection `_snapshots` (id = snapshot_AAAA-MM-JJ, date du jour Montréal),
// contenant l'objet léger (noForm + 7 champs surveillés) par fiche, normalisé
// vide-stable.
//
// UNE écriture Firestore autorisée. AUCUNE autre collection. AUCUN commit,
// AUCUN déploiement. SOURCING EXCLU (on ne lit jamais enrichissement.*).
//
// Garde-fous :
//  - refuse d'écraser un snapshot du même jour (STOP si l'id existe déjà) ;
//  - estime la taille Firestore du doc AVANT d'écrire ; si elle approche 1 Mo,
//    STOP sans écrire (on devra scinder le stockage).
//
// Usage : node scripts/snapshot-creer.mjs

import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';

const PROJET = 'primexpert-msss-registre';
const SRC = 'residences';
const DST = '_snapshots';
const REGIONS_ATTENDUES = 22;
const LIMITE_FIRESTORE = 1_048_576;      // 1 Mo/doc
const SEUIL_ABANDON = 950_000;           // marge de sécurité avant la limite

const db = new Firestore({ projectId: PROJET });

// Date du jour au format AAAA-MM-JJ, fuseau Montréal (id déterministe).
function dateJourMontreal() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montreal', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// Lecture de chemin pointé, sans fabriquer de valeur (undefined si absent).
function lire(doc, chemin) {
  let cur = doc;
  for (const k of chemin.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(k in cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

// Normalisation vide-stable de nomCompagnie : undefined/null/"" → null.
function normNomCompagnie(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  return v;
}

// Estimateur de taille Firestore (documenté) : chaînes = octets UTF-8 + 1 ;
// nombres/dates = 8 ; bool = 1 ; null = 1 ; map = Σ(len(clé)+1 + taille(valeur)) ;
// array = Σ taille(élément). Doc = Σ(len(champ)+1 + taille) + 32.
function tailleValeur(v) {
  if (v === null || v === undefined) return 1;
  if (typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 8;
  if (v instanceof Timestamp || v instanceof Date) return 8;
  if (typeof v === 'string') return Buffer.byteLength(v, 'utf8') + 1;
  if (Array.isArray(v)) return v.reduce((s, el) => s + tailleValeur(el), 0);
  if (typeof v === 'object') {
    let s = 0;
    for (const [k, val] of Object.entries(v)) s += Buffer.byteLength(k, 'utf8') + 1 + tailleValeur(val);
    return s;
  }
  return 8;
}
function tailleDocument(obj) {
  let s = 32;
  for (const [k, val] of Object.entries(obj)) s += Buffer.byteLength(k, 'utf8') + 1 + tailleValeur(val);
  return s;
}

async function main() {
  const jour = dateJourMontreal();
  const id = `snapshot_${jour}`;
  console.log(`# Projet     : ${PROJET}`);
  console.log(`# Source     : ${SRC}  →  Destination : ${DST}/${id}`);
  console.log(`# Mode       : UNE écriture autorisée — sourcing EXCLU`);
  console.log('');

  // GARDE-FOU 1 : ne pas écraser un snapshot du même jour.
  const dejaLa = await db.collection(DST).doc(id).get();
  if (dejaLa.exists) {
    console.log(`STOP : ${DST}/${id} existe déjà (créé le ${dejaLa.get('_cree_le') ? 'antérieurement' : '?'}).`);
    console.log('Aucune écriture effectuée — on n\'écrase pas un snapshot existant.');
    return;
  }

  // 1-2. Full scan + extraction légère normalisée.
  const snap = await db.collection(SRC).get();
  const docs = snap.docs;

  const fiches = [];
  const regionsSet = new Set();
  for (const doc of docs) {
    const d = doc.data();

    const cdRSS = d._regionCdRSS;
    if (cdRSS !== undefined && cdRSS !== null) regionsSet.add(cdRSS);

    const respBrut = lire(d, 'section4_personneResponsable');
    const personneResponsable = Array.isArray(respBrut)
      ? respBrut.map((r) => ({ nom: r?.nom ?? null, prenom: r?.prenom ?? null }))
      : [];

    const assocBrut = lire(d, 'section8_reconnaissance.associations');
    const associations = Array.isArray(assocBrut) ? assocBrut.slice() : [];

    fiches.push({
      noForm: lire(d, 'noForm') ?? doc.id,
      nomResidence: lire(d, 'section1_identification.nomResidence') ?? null,
      categorieRPA: lire(d, 'section1_identification.categorieRPA') ?? null,
      nombreTotalUnites: lire(d, 'section1_identification.nombreTotalUnitesImmeubles') ?? null,
      nomCompagnie: normNomCompagnie(lire(d, 'section2_titulaires.personneMorale.nomCompagnie')),
      nombreAutresResidences: lire(d, 'section3_autresRPA.nombreAutresResidences') ?? null,
      personneResponsable,
      associations,
    });
  }

  const regionsVues = [...regionsSet].sort();
  const cycleComplet = regionsVues.length === REGIONS_ATTENDUES;

  // 3. Objet document (avec serverTimestamp pour l'écriture réelle).
  const document = {
    _cree_le: FieldValue.serverTimestamp(),
    _nb_fiches: fiches.length,
    _cycle_complet: cycleComplet,
    _regions_vues: regionsVues,
    fiches,
  };

  // GARDE-FOU 2 : estimer la taille AVANT d'écrire (timestamp compté comme 8 o).
  const pourTaille = { ...document, _cree_le: new Date() };
  const tailleEstimee = tailleDocument(pourTaille);
  const pct = ((tailleEstimee / LIMITE_FIRESTORE) * 100).toFixed(1);
  console.log(`Fiches extraites          : ${fiches.length}`);
  console.log(`Régions distinctes vues   : ${regionsVues.length} → cycle complet : ${cycleComplet ? 'OUI' : 'NON'}`);
  console.log(`Taille Firestore estimée  : ${tailleEstimee.toLocaleString('fr-CA')} octets (${pct} % de 1 Mo)`);
  console.log('');

  if (tailleEstimee >= SEUIL_ABANDON) {
    console.log(`STOP : la taille estimée (${tailleEstimee} o) approche la limite de 1 Mo`);
    console.log(`(seuil d'abandon ${SEUIL_ABANDON} o). AUCUNE écriture — il faut scinder le stockage.`);
    return;
  }

  // 4. Écriture — UNE seule opération.
  await db.collection(DST).doc(id).set(document);
  console.log(`✓ Écrit : ${DST}/${id}`);

  // 5. Relecture + compte-rendu.
  const relu = await db.collection(DST).doc(id).get();
  const r = relu.data();
  const tailleRelue = tailleDocument(r);
  const creeLe = r._cree_le instanceof Timestamp ? r._cree_le.toDate().toISOString() : String(r._cree_le);

  console.log('');
  console.log('===== COMPTE-RENDU (relecture) =====');
  console.log(`id                 : ${relu.id}`);
  console.log(`_cree_le           : ${creeLe}`);
  console.log(`_nb_fiches         : ${r._nb_fiches}`);
  console.log(`_cycle_complet     : ${r._cycle_complet}`);
  console.log(`_regions_vues (nb) : ${r._regions_vues.length}  [${r._regions_vues.join(', ')}]`);
  console.log(`taille relue       : ${tailleRelue.toLocaleString('fr-CA')} octets ` +
    `(${((tailleRelue / LIMITE_FIRESTORE) * 100).toFixed(1)} % de 1 Mo) — ` +
    (tailleRelue < SEUIL_ABANDON ? 'OK, loin de la limite' : '⚠ proche de la limite'));
  console.log('');
  console.log('2 entrées fiches en exemple :');
  console.log(JSON.stringify(r.fiches.slice(0, 2), null, 2));

  console.log('');
  console.log(`(FIN — 1 écriture, doc ${DST}/${id})`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });
