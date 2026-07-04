/* Consultation du registre — logique client (lecture seule).
 * Données : consultationApi (Firestore en direct, via la fonction gardée).
 * Plus jamais data.js/window.REGISTRE — voir index.html. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { firebaseConfig, AUTH_EMULATOR, CONSULTATION_API_URL } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
if (AUTH_EMULATOR) connectAuthEmulator(auth, AUTH_EMULATOR, { disableWarnings: true });

let REGISTRE = []; // fiches résumé de la région actuellement chargée (mode liste)
let idTokenActuel = null;

// --- éléments DOM : connexion ---
const vueConnexion = document.getElementById('vue-connexion');
const elEtatConnexion = document.getElementById('etat-connexion');
const elUtilisateurInfo = document.getElementById('utilisateur-info');
const elBtnConnexion = document.getElementById('btn-connexion');
const elBtnDeconnexion = document.getElementById('btn-deconnexion');
const elConnexionMessage = document.getElementById('connexion-message');

// --- raccourcis d'accès aux champs du résumé (mode liste — champs plats,
// pas nichés sous section1_identification comme la fiche complète) ---
const get = {
  nom: (f) => f.nomResidence || '(sans nom)',
  municipalite: (f) => f.municipalite || '—',
  cat: (f) => f.categorieRPA,
  unites: (f) => f.nombreTotalUnitesImmeubles,
  esss: (f) => f.esss || '—',
};

// ============================ FILTRES =============================
const elRegion = document.getElementById('f-region');
const elCat = document.getElementById('f-cat');
const elMin = document.getElementById('f-min');
const elMax = document.getElementById('f-max');
const elReset = document.getElementById('f-reset');
const elCompteur = document.getElementById('compteur');
const elCorps = document.getElementById('corps');
const elEntetes = document.querySelectorAll('#tableau th.triable');

// Peuple la déroulante des régions à partir d'un asset statique local
// (regions-actives.json, généré par functions/regions-actives.mjs — lecture
// seule sur Firestore, réutilise LIBELLES de regions.js). N'affiche que les
// régions qui ont déjà des fiches, pas la liste complète du Québec.
async function peuplerRegions() {
  let regions = [];
  try {
    const res = await fetch('./regions-actives.json');
    regions = await res.json();
  } catch (e) {
    return;
  }
  // Remplit les deux déroulantes région (onglet K10 + onglet Sourcing).
  for (const sel of [document.getElementById('f-region'), document.getElementById('s-region')]) {
    if (!sel || sel.options.length > 1) continue;
    for (const r of regions) {
      const opt = document.createElement('option');
      opt.value = r.cdRSS;
      opt.textContent = `${r.cdRSS} - ${r.libelle || '(région inconnue)'}`;
      sel.appendChild(opt);
    }
  }
}

// --- tri des colonnes (client, sur les données déjà chargées) ---
let triColonne = null; // 'nom' | 'municipalite' | 'cat' | 'unites'
let triDirection = 'asc';

function comparerValeurs(a, b, numerique) {
  const aVide = a == null || a === '';
  const bVide = b == null || b === '';
  if (aVide && bVide) return 0;
  if (aVide) return 1; // valeurs vides toujours en fin de tri
  if (bVide) return -1;
  const cmp = numerique
    ? Number(a) - Number(b)
    : String(a).localeCompare(String(b), 'fr', { sensitivity: 'base' });
  return triDirection === 'desc' ? -cmp : cmp;
}

function fichesTriees(fiches) {
  if (!triColonne) return fiches;
  const numerique = triColonne === 'cat' || triColonne === 'unites';
  return [...fiches].sort((x, y) => comparerValeurs(get[triColonne](x), get[triColonne](y), numerique));
}

function majFlechesEntetes() {
  for (const th of elEntetes) {
    const fleche = th.querySelector('.fleche-tri');
    if (th.dataset.key === triColonne) fleche.textContent = triDirection === 'asc' ? '▲' : '▼';
    else fleche.textContent = '';
  }
}

for (const th of elEntetes) {
  th.addEventListener('click', () => {
    const cle = th.dataset.key;
    if (triColonne === cle) triDirection = triDirection === 'asc' ? 'desc' : 'asc';
    else { triColonne = cle; triDirection = 'asc'; }
    majFlechesEntetes();
    rendreListe();
  });
}

function fichesFiltrees() {
  const cat = elCat.value;
  const min = elMin.value === '' ? null : Number(elMin.value);
  const max = elMax.value === '' ? null : Number(elMax.value);

  const filtrees = REGISTRE.filter((f) => {
    if (cat && String(get.cat(f)) !== cat) return false;
    const u = get.unites(f);
    if (min !== null && (u == null || u < min)) return false;
    if (max !== null && (u == null || u > max)) return false;
    return true;
  });
  return fichesTriees(filtrees);
}

function rendreListe() {
  const fiches = fichesFiltrees();
  elCompteur.textContent = `${fiches.length} résidence${fiches.length > 1 ? 's' : ''}`
    + (fiches.length !== REGISTRE.length ? ` (sur ${REGISTRE.length})` : '');

  elCorps.innerHTML = '';
  if (!fiches.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="vide" colspan="5">Aucune résidence — choisis une région ci-dessus.</td>';
    elCorps.appendChild(tr);
    return;
  }

  for (const f of fiches) {
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.innerHTML = `
      <td class="nom">${esc(get.nom(f))}</td>
      <td>${esc(get.municipalite(f))}</td>
      <td class="num">${get.cat(f) ?? '—'}</td>
      <td class="num">${get.unites(f) ?? '—'}</td>
      <td>${esc(get.esss(f))}</td>`;
    tr.addEventListener('click', () => ouvrirDetail(f.noForm));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') ouvrirDetail(f.noForm); });
    elCorps.appendChild(tr);
  }
}

[elCat].forEach((el) => el.addEventListener('change', rendreListe));
[elMin, elMax].forEach((el) => el.addEventListener('input', rendreListe));
elReset.addEventListener('click', () => {
  elCat.value = ''; elMin.value = ''; elMax.value = '';
  rendreListe();
});

elRegion.addEventListener('change', () => chargerRegion());

async function chargerRegion() {
  const cd = elRegion.value;
  if (!cd) { REGISTRE = []; rendreListe(); return; }
  elCompteur.textContent = 'Chargement…';
  let data;
  try {
    data = await appelApi(`?cdRSS=${encodeURIComponent(cd)}`);
  } catch (e) {
    return; // message déjà géré par appelApi
  }
  REGISTRE = data.fiches || [];
  rendreListe();
}

// ============================ DÉTAIL ==============================
const vueListe = document.getElementById('vue-liste');
const vueDetail = document.getElementById('vue-detail');
const elDetail = document.getElementById('detail');
document.getElementById('retour').addEventListener('click', fermerDetail);

// Libellés lisibles (sections + champs courants). Fallback : humanize().
const LABELS = {
  // en-tête
  noForm: 'N° de formulaire', numeroInterne: 'Numéro interne',
  numeroRegistre: 'Numéro de registre', residencesLiees: 'Résidences liées',
  statut: 'Statut', detailUrl: 'Fiche source', _source: 'Fichier local',
  _collecteLe: 'Collecté le',
  // section 1
  nomResidence: 'Nom de la résidence', adresse: 'Adresse', codePostal: 'Code postal',
  esss: 'ÉSSS', esssCode: 'Code ÉSSS', esssNom: 'Nom ÉSSS', municipalite: 'Municipalité',
  territoireCLSC: 'Territoire CLSC', territoireRLS: 'Territoire RLS', territoireMRC: 'Territoire MRC',
  courriels: 'Courriels', telephone: 'Téléphone', telecopieur: 'Télécopieur',
  dateOuverture: "Date d'ouverture", typeResidence: 'Type de résidence',
  categorieRPA: 'Catégorie RPA', nombreTotalUnitesImmeubles: "Nombre total d'unités",
  appartenanceGroupeReseau: 'Appartenance à un groupe', immeublesAssocies: 'Immeubles associés',
  // section 2
  personneMorale: 'Personne morale', nomCompagnie: 'Nom de la compagnie', neq: 'NEQ',
  datePrisePossession: 'Date de prise de possession', actionnaires: 'Actionnaires',
  nom: 'Nom', prenom: 'Prénom', mention: 'Mention',
  // section 3
  proprietaireAutresRPA: "Propriétaire d'autres RPA", nombreAutresResidences: 'Nombre autres résidences', liste: 'Liste',
  // section 5
  occupation: 'Occupation', fonction: 'Fonction',
  // section 6
  capaciteTotaleImmeubles: 'Capacité totale immeubles', capaciteRPA: 'Capacité RPA',
  repartitionAges: 'Répartition par âge', moins65: 'Moins de 65 ans', de65a74: '65–74 ans',
  de75a84: '75–84 ans', de85plus: '85 ans et +', totalResidents: 'Total résidents',
  unitesParMission: 'Unités par mission', rpa: 'RPA', ri: 'RI', rtf: 'RTF', chsld: 'CHSLD', autres: 'Autres',
  chambresSimples: 'Chambres simples', chambresDoubles: 'Chambres doubles', logements: 'Logements',
  total: 'Total', clientelePersonnesAgees: 'Clientèle pers. âgées',
  totalUnitesLocatives: 'Total unités locatives', entente108: 'Entente 108',
  employes: 'Employés', personnelAssistance: "Personnel d'assistance", personnelInfirmier: 'Personnel infirmier',
  semaine: 'Semaine', finDeSemaine: 'Fin de semaine', jour: 'Jour', soir: 'Soir', nuit: 'Nuit',
  precisions: 'Précisions', type: 'Type',
  // section 7
  securite: 'Sécurité', typeAppelAide: "Type d'appel à l'aide", clienteleErrance: 'Clientèle errance',
  dispositifSecuriteSortie: 'Dispositif sécurité sortie', loisirs: 'Loisirs', repas: 'Repas',
  aideDomestique: 'Aide domestique', assistancePersonnelle: 'Assistance personnelle', soinsInfirmiers: 'Soins infirmiers',
  // section 8
  membreAssociation: "Membre d'association", associations: 'Associations',
  permisMAPAQ: 'Permis MAPAQ', permisRBQ: 'Permis RBQ',
  // section 9
  typeConstruction: 'Type de construction', sousSol: 'Sous-sol', present: 'Présent',
  porteExterieure: 'Porte extérieure', residentsHeberges: 'Résidents hébergés',
  nombreEtagesHorsSousSol: "Nombre d'étages (hors sous-sol)", rampeAcces: "Rampe d'accès",
  nombreAscenseurs: "Nombre d'ascenseurs", mitigeurEauChaude: 'Mitigeur eau chaude',
  equipementsDetectionAlarme: 'Équipements détection/alarme', systemeGicleurs: 'Système de gicleurs',
  sourceEauPotable: 'Source eau potable', generatrice: 'Génératrice', climatisation: 'Climatisation',
  ensembleImmeubles: 'Ensemble des immeubles', lieuxCommuns: 'Lieux communs',
  chambresLogements: 'Chambres/logements', controleIndependant: 'Contrôle indépendant',
};

const SECTIONS = {
  section1_identification: '1 · Identification',
  section2_titulaires: '2 · Titulaires',
  section3_autresRPA: '3 · Autres RPA',
  section4_personneResponsable: '4 · Personne responsable',
  section5_administrateurs: '5 · Administrateurs',
  section6_portraits: '6 · Portraits',
  section7_services: '7 · Services',
  section8_reconnaissance: '8 · Reconnaissance',
  section9_immeuble: "9 · Caractéristiques de l'immeuble",
};

function label(key) {
  return LABELS[key] || humanize(key);
}

async function ouvrirDetail(noForm) {
  let f;
  try {
    f = await appelApi(`?noForm=${encodeURIComponent(noForm)}`);
  } catch (e) {
    return; // message déjà géré par appelApi
  }
  if (!f) return;
  elDetail.innerHTML = '';

  const s1 = f.section1_identification || {};
  const titre = document.createElement('h2');
  titre.className = 'fiche-titre';
  titre.textContent = s1.nomResidence || '(sans nom)';
  elDetail.appendChild(titre);

  const meta = document.createElement('p');
  meta.className = 'fiche-meta';
  const badges = [
    s1.categorieRPA != null ? `Catégorie ${s1.categorieRPA}` : null,
    f.statut || null,
  ].filter(Boolean).map((b) => `<span class="badge">${esc(b)}</span>`).join('');
  meta.innerHTML = `${badges}${esc([s1.adresse, s1.municipalite, s1.codePostal].filter(Boolean).join(', '))}`;
  elDetail.appendChild(meta);

  // En-tête : champs hors sections. On masque la plomberie (tout champ `_...`
  // sauf la date de collecte, reformatée en date lisible) et le doublon
  // numeroInterne quand il est identique à numeroRegistre — le contenu
  // métier reste intact, on ne masque que ce qui n'apporte rien à la lecture.
  const enteteKeys = Object.keys(f).filter((k) => {
    if (k.startsWith('section')) return false;
    if (k === '_source') return false;
    if (k.startsWith('_') && k !== '_collecteLe') return false;
    if (k === 'numeroInterne' && String(f.numeroInterne) === String(f.numeroRegistre)) return false;
    return true;
  });
  const entete = Object.fromEntries(enteteKeys.map((k) =>
    [k, k === '_collecteLe' ? formatCollecteLe(f._collecteLe) : f[k]]));
  elDetail.appendChild(carteSection('Informations générales', entete));

  // Une carte par section, dans l'ordre 1→9
  for (const key of Object.keys(SECTIONS)) {
    if (f[key] != null) elDetail.appendChild(carteSection(SECTIONS[key], f[key]));
  }

  vueListe.hidden = true;
  vueDetail.hidden = false;
  window.scrollTo(0, 0);
}

function fermerDetail() {
  vueDetail.hidden = true;
  vueListe.hidden = false;
}

// Construit une carte <section> à partir d'un objet.
function carteSection(titre, obj) {
  const sec = document.createElement('section');
  sec.className = 'section';
  const h = document.createElement('h2');
  h.textContent = titre;
  sec.appendChild(h);
  const corps = document.createElement('div');
  corps.className = 'corps';
  corps.appendChild(rendreObjet(obj));
  sec.appendChild(corps);
  return sec;
}

// Rend un objet en liste de champs clé/valeur (récursif).
function rendreObjet(obj) {
  const frag = document.createDocumentFragment();
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      // tableau d'objets → mini-table
      const t = document.createElement('div');
      t.className = 'sous-titre';
      t.textContent = label(k);
      frag.appendChild(t);
      frag.appendChild(miniTable(v));
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      // sous-objet → bloc indenté
      const t = document.createElement('div');
      t.className = 'sous-titre';
      t.textContent = label(k);
      frag.appendChild(t);
      const box = document.createElement('div');
      box.className = 'sous-objet';
      box.appendChild(rendreObjet(v));
      frag.appendChild(box);
    } else {
      frag.appendChild(champ(label(k), v));
    }
  }
  return frag;
}

// Ligne clé/valeur.
function champ(k, v) {
  const row = document.createElement('div');
  row.className = 'champ';
  const ck = document.createElement('div');
  ck.className = 'k';
  ck.textContent = k;
  const cv = document.createElement('div');
  cv.className = 'v ' + classeValeur(v);
  cv.innerHTML = formatValeur(v);
  row.append(ck, cv);
  return row;
}

function miniTable(arr) {
  const cols = [...new Set(arr.flatMap((o) => Object.keys(o)))];
  const t = document.createElement('table');
  t.className = 'mini-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr>' + cols.map((c) => `<th>${esc(label(c))}</th>`).join('') + '</tr>';
  const tbody = document.createElement('tbody');
  for (const o of arr) {
    tbody.innerHTML += '<tr>' + cols.map((c) => `<td>${formatValeur(o[c])}</td>`).join('') + '</tr>';
  }
  t.append(thead, tbody);
  return t;
}

// --- formatage des valeurs ---
function classeValeur(v) {
  if (v === true) return 'oui';
  if (v === false) return 'non';
  if (v === null || v === '' || (Array.isArray(v) && !v.length)) return 'nul';
  return '';
}
function formatValeur(v) {
  if (v === true) return 'Oui';
  if (v === false) return 'Non';
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map((x) => esc(String(x))).join('<br>') : '—';
  if (typeof v === 'object') {
    // objet imbriqué dans une cellule (ex. semaine {jour,soir,nuit}) → compact
    const parts = Object.entries(v).map(([k, val]) => `${esc(label(k))} ${formatValeur(val)}`);
    return parts.length ? parts.join(' · ') : '—';
  }
  const s = String(v);
  if (/^https?:\/\//.test(s)) return `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s)}</a>`;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return `<a href="mailto:${esc(s)}">${esc(s)}</a>`;
  return esc(s);
}

// Timestamp Firestore {_seconds, _nanoseconds} → date lisible française
// (fuseau America/Montreal), ex. « 3 juillet 2026 à 03h12 ».
function formatCollecteLe(ts) {
  if (!ts || ts._seconds == null) return null;
  const date = new Date(ts._seconds * 1000);
  const jour = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'America/Montreal', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
  // formatToParts plutôt qu'un format+replace : le séparateur « h/m » varie
  // selon la locale (fr-CA rend « 03 h 06 », espaces incluses) — on construit
  // « 03h06 » nous-mêmes pour un résultat prévisible, indépendant de la locale.
  const parts = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'America/Montreal', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const heures = parts.find((p) => p.type === 'hour').value;
  const minutes = parts.find((p) => p.type === 'minute').value;
  return `${jour} à ${heures}h${minutes}`;
}

function humanize(key) {
  return key
    .replace(/^section\d+_/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ==================== SOURCING REQ & CONTACTS ====================
const vueSourcing = document.getElementById('vue-sourcing');
const elSRegion = document.getElementById('s-region');
const elSContact = document.getElementById('s-contact');
const elSStatut = document.getElementById('s-statut');
const elSSearch = document.getElementById('s-search');
const elSExport = document.getElementById('s-export');
const elSCompteur = document.getElementById('s-compteur');
const elSCartes = document.getElementById('s-cartes');

let SOURCING = [];          // amalgame de la région chargée
let sourcingFiltrees = [];  // sous-ensemble après filtres (base de l'export)

async function chargerRegionSourcing() {
  const cd = elSRegion.value;
  if (!cd) {
    SOURCING = [];
    elSCompteur.textContent = 'Choisis une région pour charger l’amalgame K10 + REQ.';
    elSCartes.innerHTML = '';
    return;
  }
  elSCompteur.textContent = 'Chargement…';
  elSCartes.innerHTML = '';
  let data;
  try {
    data = await appelApi(`?vue=sourcing&cdRSS=${encodeURIComponent(cd)}`);
  } catch (e) {
    return; // 401/403 déjà géré par appelApi
  }
  SOURCING = data.fiches || [];
  rendreSourcing();
}

function badgeStatut(s) {
  if (s === 'REQ_DONE') return '<span class="badge b-ok">Enrichi REQ</span>';
  if (s === 'A_REVISER') return '<span class="badge b-warn">À réviser</span>';
  return '<span class="badge b-neutre">Non traité</span>';
}
function badgeQualite(q) {
  if (q === 'DECIDEUR') return '<span class="badge b-ok">🎯 Décideur</span>';
  if (q === 'GENERALE') return '<span class="badge b-neutre">🏢 Ligne générale</span>';
  if (q === 'PERSO') return '<span class="badge b-info">❓ Perso à confirmer</span>';
  return '';
}

function sourcingFiltre() {
  const c = elSContact.value;
  const st = elSStatut.value;
  const q = elSSearch.value.trim().toLowerCase();
  return SOURCING.filter((r) => {
    if (c && r.courrielQualite !== c) return false;
    if (st && (r.sourcingStatus || 'NON_TRAITE') !== st) return false;
    if (q) {
      const foin = [r.nom, r.neq, r.telephone, r.courriel].map((x) => String(x || '').toLowerCase());
      if (!foin.some((x) => x.includes(q))) return false;
    }
    return true;
  });
}

function rendreSourcing() {
  const fiches = sourcingFiltre();
  sourcingFiltrees = fiches;
  elSCompteur.textContent = `${fiches.length} résidence${fiches.length > 1 ? 's' : ''}`
    + (fiches.length !== SOURCING.length ? ` (sur ${SOURCING.length})` : '');
  if (!fiches.length) {
    elSCartes.innerHTML = '<p class="vide">Aucune fiche pour ces critères.</p>';
    return;
  }
  elSCartes.innerHTML = fiches.map(carteSourcing).join('');
}

function carteSourcing(r) {
  const admins = Array.isArray(r.administrateurs) ? r.administrateurs : [];
  let blocAdmins = '<p class="cs-vide">Aucune donnée corporative associée.</p>';
  if (admins.length) {
    blocAdmins = '<table class="cs-admins"><thead><tr><th>Dirigeant</th><th>Fonction</th><th>Adresse résidentielle</th></tr></thead><tbody>'
      + admins.map((a) => `<tr><td class="cs-dir">${esc(`${a.prenom || ''} ${a.nom || ''}`.trim())}</td><td>${esc(a.fonction || '—')}</td><td>${esc(a.adresseResidentielle || '—')}</td></tr>`).join('')
      + '</tbody></table>';
  }
  const contacts = [];
  if (r.telephone) contacts.push(`<a href="tel:${esc(r.telephone)}">📞 ${esc(r.telephone)}</a>`);
  if (r.courriel) contacts.push(`<span>✉️ <a href="mailto:${esc(r.courriel)}">${esc(r.courriel)}</a> ${badgeQualite(r.courrielQualite)}</span>`);
  if (r.telecopieur) contacts.push(`<span class="cs-vide">📠 ${esc(r.telecopieur)}</span>`);
  if (!r.telephone && !r.courriel) contacts.push('<span class="cs-vide">Aucune coordonnée au registre K10</span>');

  return `<div class="carte-sourcing">
    <div class="cs-tete">
      <div>
        <h3 class="cs-nom">${esc(r.nom || '(sans nom)')} ${badgeStatut(r.sourcingStatus)}</h3>
        <p class="cs-sous">${esc(r.esss || '—')}</p>
      </div>
      <div class="cs-droite">
        <span class="badge">Catégorie ${r.categorieRPA ?? '—'}</span>
        <p class="cs-neq">NEQ : ${esc(r.neq || 'Aucun')} · ${r.capacite ?? '—'} places</p>
      </div>
    </div>
    <div class="cs-contacts">${contacts.join('')}</div>
    <div class="cs-titre-bloc">Structure juridique &amp; organes de direction (REQ)</div>
    ${blocAdmins}
  </div>`;
}

// Export CSV des adresses de domicile des dirigeants (publipostage).
// Respecte les filtres courants et dédoublonne par foyer.
function exporterAdresses() {
  const source = sourcingFiltrees.length ? sourcingFiltrees : SOURCING;
  const CP = /([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)/;
  const foyers = new Map();
  source.forEach((r) => (r.administrateurs || []).forEach((a) => {
    const adr = (a.adresseResidentielle || '').trim();
    if (!adr) return;
    const cle = adr.toLowerCase().replace(/\s+/g, ' ');
    if (!foyers.has(cle)) foyers.set(cle, { adresse: adr, noms: new Set(), fonctions: new Set(), residences: new Set(), neqs: new Set() });
    const f = foyers.get(cle);
    f.noms.add(`${a.prenom || ''} ${a.nom || ''}`.trim());
    if (a.fonction) f.fonctions.add(a.fonction);
    if (r.nom) f.residences.add(r.nom);
    if (r.neq && r.neq !== 'Aucun') f.neqs.add(r.neq);
  }));
  if (!foyers.size) {
    alert('Aucune adresse de dirigeant dans la sélection courante (région non enrichie REQ, ou filtre trop restrictif).');
    return;
  }
  const cpDe = (adr) => { const m = adr.match(CP); return m ? m[1].toUpperCase() : ''; };
  const nettoyer = (adr) => adr.replace(/\s*Canada\s*$/i, '').trim();
  const escCsv = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lignes = [['Dirigeant(s)', 'Fonction(s)', 'Adresse', 'Code postal', 'Résidence(s)', 'NEQ']];
  [...foyers.values()].forEach((f) => lignes.push([
    [...f.noms].join(' ; '), [...f.fonctions].join(' ; '), nettoyer(f.adresse), cpDe(f.adresse), [...f.residences].join(' ; '), [...f.neqs].join(' ; '),
  ]));
  const csv = '﻿' + lignes.map((l) => l.map(escCsv).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = `adresses_dirigeants_${foyers.size}_foyers.csv`;
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}

elSRegion.addEventListener('change', chargerRegionSourcing);
[elSContact, elSStatut].forEach((el) => el.addEventListener('change', rendreSourcing));
elSSearch.addEventListener('input', rendreSourcing);
elSExport.addEventListener('click', exporterAdresses);

// --- Onglets ---
const elOnglets = document.getElementById('onglets');
const elBoutonsOnglet = document.querySelectorAll('.onglet');
let ongletActif = 'k10';

function activerOnglet(tab) {
  ongletActif = tab;
  for (const b of elBoutonsOnglet) b.classList.toggle('actif', b.dataset.tab === tab);
  vueListe.hidden = tab !== 'k10';
  vueDetail.hidden = true; // le détail K10 ne s'ouvre que via un clic de ligne
  vueSourcing.hidden = tab !== 'sourcing';
}
for (const b of elBoutonsOnglet) b.addEventListener('click', () => activerOnglet(b.dataset.tab));

// ============================ AUTH / MUR ==========================

function afficherEcranConnexion(message) {
  vueConnexion.hidden = false;
  elOnglets.hidden = true;
  vueListe.hidden = true;
  vueDetail.hidden = true;
  vueSourcing.hidden = true;
  elBtnConnexion.hidden = false;
  elConnexionMessage.textContent = message || '';
}

// Connecté à Google mais pas dans _accesAutorises (403) : pas de bouton
// « se connecter » (déjà connecté) — juste le message + « se déconnecter »
// dans l'en-tête pour essayer un autre compte.
function afficherAccesRefuse(message) {
  vueConnexion.hidden = false;
  elOnglets.hidden = true;
  vueListe.hidden = true;
  vueDetail.hidden = true;
  vueSourcing.hidden = true;
  elBtnConnexion.hidden = true;
  elConnexionMessage.textContent = message;
}

function afficherApp() {
  vueConnexion.hidden = true;
  elOnglets.hidden = false;
  activerOnglet(ongletActif); // affiche la vue de l'onglet courant (K10 par défaut)
}

// Appel centralisé à consultationApi : porte le token, gère 401/403.
// Ne sert jamais de donnée avant d'avoir vérifié la réponse — le mur décide,
// cette fonction ne fait qu'obéir.
async function appelApi(queryString) {
  if (!idTokenActuel) throw new Error('non-connecte');
  const res = await fetch(`${CONSULTATION_API_URL}${queryString}`, {
    headers: { Authorization: `Bearer ${idTokenActuel}` },
  });
  if (res.status === 401) {
    await signOut(auth);
    afficherEcranConnexion('Session expirée ou invalide — reconnecte-toi.');
    throw new Error('401');
  }
  if (res.status === 403) {
    afficherAccesRefuse('Accès refusé — cette adresse Google n’est pas autorisée.');
    throw new Error('403');
  }
  if (!res.ok) {
    elConnexionMessage.textContent = '';
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

elBtnConnexion.addEventListener('click', async () => {
  elConnexionMessage.textContent = '';
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    elConnexionMessage.textContent = 'Connexion annulée ou en échec.';
  }
});

elBtnDeconnexion.addEventListener('click', () => signOut(auth));

// Aucune donnée n'est chargée avant ce callback ET une action explicite de
// la personne (Charger une région / cliquer une fiche) : REGISTRE reste vide,
// rendreListe() n'affiche rien tant qu'aucun fetch n'a réussi.
//
// Sonde d'accès immédiate : on ne veut pas attendre le premier clic sur
// « Charger » pour révéler un 403 — ?cdRSS=00 est un appel légitime au sens
// du contrat de l'API (aucun cdRSS réel ne vaut « 00 »), qui traverse le mur
// (token + liste blanche) sans dépendre d'une vraie région. 200 → autorisé
// (même si 0 résultat) ; 403 → geré par appelApi (écran refus), sans jamais
// avoir affiché la moindre donnée.
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    idTokenActuel = null;
    elEtatConnexion.hidden = true;
    REGISTRE = [];
    afficherEcranConnexion();
    return;
  }
  idTokenActuel = await user.getIdToken();
  elEtatConnexion.hidden = false;
  elUtilisateurInfo.textContent = user.email || '(connecté)';
  REGISTRE = [];

  try {
    await appelApi('?cdRSS=00');
  } catch (e) {
    return; // 401/403 déjà géré (écran approprié affiché) par appelApi
  }

  afficherApp();
  if (elRegion.options.length <= 1) await peuplerRegions(); // une seule fois
  rendreListe();
});
