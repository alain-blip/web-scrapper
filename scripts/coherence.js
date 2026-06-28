// Contrôle de cohérence d'une fiche produite + diff structurel vs une fiche de
// référence (Murray). Sans oracle, on vérifie : remplissage, sections vides,
// types, valeurs aberrantes, et écarts de structure.
//
// Usage : node scripts/coherence.js output/estrie/3629.json [refMurray.json]

import fs from 'node:fs';

const path = process.argv[2];
const refPath = process.argv[3] || 'output/sample/murray-395.json';
const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
const ref = JSON.parse(fs.readFileSync(refPath, 'utf-8'));
delete ref._note;

function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') { out[prefix] = obj; return out; }
  if (Array.isArray(obj)) {
    if (obj.length === 0) { out[prefix] = '[]'; return out; }
    obj.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
    return out;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) { out[prefix] = '{}'; return out; }
  keys.forEach((k) => flatten(obj[k], prefix ? `${prefix}.${k}` : k, out));
  return out;
}

const flat = flatten(data);
const isEmpty = (v) => v === null || v === '' || v === '[]';

// 1. Remplissage global
const leaves = Object.entries(flat);
const filled = leaves.filter(([, v]) => !isEmpty(v));
const empty = leaves.filter(([, v]) => isEmpty(v));

// 2. Sections anormalement vides (toutes les feuilles d'une section nulles)
const sections = {};
for (const [k, v] of leaves) {
  const sec = k.split('.')[0];
  (sections[sec] ||= []).push(isEmpty(v));
}
const emptySections = Object.entries(sections)
  .filter(([, arr]) => arr.every(Boolean))
  .map(([s]) => s);

// 3. Vérifs de type / format / valeurs aberrantes
const warn = [];
const s1 = data.section1_identification;
const s6 = data.section6_portraits;

if (s1.codePostal && !/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/.test(s1.codePostal)) warn.push(`code postal douteux: ${JSON.stringify(s1.codePostal)}`);
if (s1.telephone && !/\d{3}-\d{3}-\d{4}/.test(s1.telephone)) warn.push(`téléphone douteux: ${JSON.stringify(s1.telephone)}`);
for (const c of (s1.courriels || [])) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) warn.push(`courriel douteux: ${JSON.stringify(c)}`);
if (s1.dateOuverture && !/^\d{4}-\d{2}-\d{2}$/.test(s1.dateOuverture)) warn.push(`date d'ouverture douteuse: ${JSON.stringify(s1.dateOuverture)}`);
if (s1.categorieRPA != null && ![1, 2, 3, 4].includes(s1.categorieRPA)) warn.push(`catégorie RPA hors 1-4: ${s1.categorieRPA}`);

const ra = s6.repartitionAges || {};
const sommeAges = ['moins65', 'de65a74', 'de75a84', 'de85plus'].reduce((a, k) => a + (ra[k] || 0), 0);
if (ra.totalResidents != null && sommeAges !== ra.totalResidents) {
  warn.push(`répartition âges: somme(${sommeAges}) ≠ totalResidents(${ra.totalResidents})`);
}
if (s6.capaciteRPA != null && ra.totalResidents != null && ra.totalResidents > s6.capaciteRPA) {
  warn.push(`résidents(${ra.totalResidents}) > capacité RPA(${s6.capaciteRPA})`);
}
// somme des missions vs totalUnitesLocatives
const um = s6.unitesParMission || {};
const sommeTot = Object.values(um).reduce((a, m) => a + (m.total || 0), 0);
if (s6.totalUnitesLocatives != null && sommeTot !== s6.totalUnitesLocatives) {
  warn.push(`unités: somme missions(${sommeTot}) ≠ totalUnitesLocatives(${s6.totalUnitesLocatives})`);
}

// types attendus
const typeChecks = [
  ['categorieRPA', s1.categorieRPA, ['number', 'null']],
  ['nombreTotalUnitesImmeubles', s1.nombreTotalUnitesImmeubles, ['number', 'null']],
  ['capaciteRPA', s6.capaciteRPA, ['number', 'null']],
  ['loisirs', data.section7_services.loisirs, ['boolean', 'null']],
  ['membreAssociation', data.section8_reconnaissance.membreAssociation, ['boolean', 'null']],
  ['generatrice', data.section9_immeuble.generatrice, ['boolean', 'null']],
];
for (const [name, v, allowed] of typeChecks) {
  const t = v === null ? 'null' : typeof v;
  if (!allowed.includes(t)) warn.push(`type inattendu ${name}: ${t} (${JSON.stringify(v)})`);
}

// 4. Diff structurel vs Murray
const struct = [];
const cmp = (label, a, b) => { if (a !== b) struct.push(`${label}: cette fiche=${a} | Murray=${b}`); };
cmp('catégorieRPA', s1.categorieRPA, ref.section1_identification.categorieRPA);
cmp('nb immeubles associés', (s1.immeublesAssocies || []).length, (ref.section1_identification.immeublesAssocies || []).length);
cmp('nb résidences liées', (data.residencesLiees || []).length, (ref.residencesLiees || []).length);
cmp('nb actionnaires', (data.section2_titulaires.actionnaires || []).length, (ref.section2_titulaires.actionnaires || []).length);
cmp('nb administrateurs', (data.section5_administrateurs || []).length, (ref.section5_administrateurs || []).length);
cmp('nb personne(s) responsable(s)', (data.section4_personneResponsable || []).length, (ref.section4_personneResponsable || []).length);
cmp('propriétaire autres RPA', data.section3_autresRPA.proprietaireAutresRPA, ref.section3_autresRPA.proprietaireAutresRPA);
cmp('nb lignes personnel infirmier', (s6.personnelInfirmier || []).length, (ref.section6_portraits.personnelInfirmier || []).length);
cmp('soins infirmiers offerts', data.section7_services.soinsInfirmiers, ref.section7_services.soinsInfirmiers);
cmp('assistance personnelle', data.section7_services.assistancePersonnelle, ref.section7_services.assistancePersonnelle);
cmp('type personne morale', !!data.section2_titulaires.personneMorale.nomCompagnie, !!ref.section2_titulaires.personneMorale.nomCompagnie);

const out = {
  fiche: `${data.section1_identification.nomResidence} (noForm ${data.noForm}, registre ${data.numeroRegistre})`,
  remplissage: `${filled.length}/${leaves.length} champs remplis (${empty.length} vides)`,
  sectionsVides: emptySections,
  champsVides: empty.map(([k]) => k),
  alertes: warn,
  diffVsMurray: struct,
};
console.log(JSON.stringify(out, null, 2));
