// exporter-registre-ndjson.mjs — EXPORT LECTURE SEULE de la collection `residences`
//
// Produit un dump NDJSON local (une fiche par ligne) + un manifeste. Aucune
// écriture Firestore. Réutilise le client déjà en place (@google-cloud/firestore
// + ADC), comme scripts/verifier-derniers-scrapes.mjs (Règle #0).
//
// Décision PO tracée : export veille + REQ ENTREPRISE, mais adresses de domicile
// personnel du sourcing inversé EXCLUES (gel Zone Rouge, en attente juridique).
// Seul champ retiré : enrichissement.sourcingInverse.administrateurs[].adresseResidentielle.
//
// ⚠️ Node 20 obligatoire (piège Node 18 : firebase-admin/undici crashe) :
//   ~/.nvm/versions/node/v20.19.4/bin/node scripts/exporter-registre-ndjson.mjs
//
// Fail-safe : sort les champs BRUTS tels quels ; n'invente aucune valeur. Une
// fiche sans `_regionCdRSS` est comptée sous "regionInconnue", jamais sautée.

import { Firestore } from '@google-cloud/firestore';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const PROJET = 'primexpert-msss-registre';
const COLLECTION = 'residences';

// Atterrissage LOCAL uniquement : exports/ à la racine du repo (disque interne),
// jamais directement sur /Volumes.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const exportsDir = path.join(repoRoot, 'exports');
fs.mkdirSync(exportsDir, { recursive: true });

// Date YYYY-MM-DD (Montréal), cohérente avec le reste du projet.
const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montreal' }).format(new Date());
const ndjsonPath = path.join(exportsDir, `export-registre-SANS-domiciles-${dateStr}.ndjson`);
const manifestPath = path.join(exportsDir, `export-registre-SANS-domiciles-${dateStr}.manifest.json`);

const db = new Firestore({ projectId: PROJET });

const out = fs.createWriteStream(ndjsonPath, { encoding: 'utf-8' });
let nbFiches = 0;
let nbAdmins = 0;                 // administrateurs (sourcingInverse) au total
const repartitionParRegion = {}; // cdRSS -> compte ; inclut "regionInconnue"
const echantillon = [];          // 2 premières lignes, pour vérification

// Purge chirurgicale : retire UNIQUEMENT adresseResidentielle sur chaque
// administrateur du sourcing inversé. Ne touche à rien d'autre (nom, fonction,
// NEQ, données d'entreprise conservés). Renvoie le nb d'admins de la fiche.
// Fail-safe : si pas d'administrateurs ou pas d'adresseResidentielle, no-op.
function retirerAdressesResidentielles(fiche) {
  const admins = fiche?.enrichissement?.sourcingInverse?.administrateurs;
  if (!Array.isArray(admins)) return 0;
  for (const a of admins) {
    if (a && typeof a === 'object' && 'adresseResidentielle' in a) {
      delete a.adresseResidentielle;
    }
  }
  return admins.length;
}

// Streaming (.stream()) — jamais .get() en bloc : la base peut contenir des
// milliers de fiches, on ne charge pas tout en mémoire.
await new Promise((resolve, reject) => {
  const stream = db.collection(COLLECTION).stream();
  stream.on('error', reject);
  stream.on('data', (doc) => {
    const data = doc.data();
    const region = (data && typeof data._regionCdRSS === 'string' && data._regionCdRSS)
      ? data._regionCdRSS : 'regionInconnue';
    repartitionParRegion[region] = (repartitionParRegion[region] || 0) + 1;

    // Purge du seul champ adresseResidentielle AVANT écriture de la ligne.
    nbAdmins += retirerAdressesResidentielles(data);

    // Champs bruts tels quels + _docId (= noForm) faisant autorité, pour un merge
    // idempotent côté réception. doc.id placé en dernier = source de vérité.
    const ligne = JSON.stringify({ ...data, _docId: doc.id });
    out.write(ligne + '\n');
    nbFiches += 1;
    if (echantillon.length < 2) echantillon.push(ligne);
  });
  stream.on('end', resolve);
});

await new Promise((r) => out.end(r));

const regionsCouvertes = Object.keys(repartitionParRegion)
  .filter((k) => k !== 'regionInconnue').sort();

const manifest = {
  dateExport: new Date().toISOString(),
  projet: PROJET,
  collection: COLLECTION,
  nbFiches,
  regionsCouvertes,
  repartitionParRegion, // fail-safe : rend visible "regionInconnue" si présent
  champExclu: 'enrichissement.sourcingInverse.administrateurs[].adresseResidentielle',
  contientNominatif: true,
  note: 'Export veille + REQ entreprise. Adresses résidentielles du sourcing inversé EXCLUES (gel Zone Rouge, en attente validation juridique).',
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

// CONTRÔLE DE PURGE : re-scan du fichier RÉELLEMENT écrit (pas la mémoire) —
// compte les occurrences résiduelles de la clé adresseResidentielle. Doit = 0.
let nbAdressesRestantes = 0;
const rl = readline.createInterface({
  input: fs.createReadStream(ndjsonPath, 'utf-8'), crlfDelay: Infinity,
});
for await (const line of rl) {
  const m = line.match(/"adresseResidentielle"/g);
  if (m) nbAdressesRestantes += m.length;
}

// Sortie console pour vérification.
console.log(`NDJSON             : ${ndjsonPath}`);
console.log(`Manifeste          : ${manifestPath}`);
console.log(`regionsCouvertes   : ${regionsCouvertes.join(', ') || '(aucune)'}`);
if (repartitionParRegion.regionInconnue) {
  console.log(`⚠️ regionInconnue  : ${repartitionParRegion.regionInconnue} fiche(s) sans _regionCdRSS (comptées, non sautées)`);
}
console.log('\n--- CONTRÔLE DE PURGE ---');
console.log(`nb fiches total                          : ${nbFiches}`);
console.log(`nb administrateurs (sourcingInverse)     : ${nbAdmins}`);
if (nbAdressesRestantes === 0) {
  console.log(`nb adresseResidentielle restantes        : 0 ✅`);
} else {
  console.error(`\x1b[31mnb adresseResidentielle restantes        : ${nbAdressesRestantes} ❌ PURGE INCOMPLÈTE — NE PAS TRANSFÉRER\x1b[0m`);
}
console.log('\n--- échantillon (2 premières lignes NDJSON) ---');
echantillon.forEach((l, i) => console.log(`[${i + 1}] ${l}`));

process.exit(0);
