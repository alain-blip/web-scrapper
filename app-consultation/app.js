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

let REGISTRE = []; // index léger de toutes les régions, publié seulement une fois complet
let indexEtat = 'chargement';
let versionSession = 0;
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
const elRecherche = document.getElementById('f-search');
const elCat = document.getElementById('f-cat');
const elMin = document.getElementById('f-min');
const elMax = document.getElementById('f-max');
const elReset = document.getElementById('f-reset');
const elCompteur = document.getElementById('compteur');
const elCorps = document.getElementById('corps');
const elEntetes = document.querySelectorAll('#tableau th.triable');
const libellesRegions = new Map();

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
  for (const r of regions) libellesRegions.set(r.cdRSS, r.libelle || '');
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
  if (sourcingEtat === 'pret') rendreSourcing();
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

function normaliserRecherche(v) {
  return String(v ?? '').trim().toLowerCase();
}

function fichesFiltrees() {
  const region = elRegion.value;
  const recherche = normaliserRecherche(elRecherche.value);
  const cat = elCat.value;
  const min = elMin.value === '' ? null : Number(elMin.value);
  const max = elMax.value === '' ? null : Number(elMax.value);

  const filtrees = REGISTRE.filter((f) => {
    if (region && f.cdRSS !== region) return false;
    if (recherche && ![f.nomResidence, f.municipalite, f.nomCompagnie,
      f.noForm, f.numeroRegistre, f.neq, f.neqNormalise]
      .some((v) => normaliserRecherche(v).includes(recherche))) return false;
    if (cat && String(get.cat(f)) !== cat) return false;
    const u = get.unites(f);
    if (min !== null && (u == null || u < min)) return false;
    if (max !== null && (u == null || u > max)) return false;
    return true;
  });
  return fichesTriees(filtrees);
}

function rendreListe() {
  if (indexEtat !== 'pret') {
    elCorps.replaceChildren();
    elCompteur.textContent = indexEtat === 'erreur'
      ? 'Index indisponible ou incomplet. Rechargez la page pour réessayer.'
      : 'Chargement de l’index toutes régions…';
    return;
  }
  const fiches = fichesFiltrees();
  elCompteur.textContent = `${fiches.length} résidence${fiches.length > 1 ? 's trouvées' : ' trouvée'}`
    + (fiches.length !== REGISTRE.length ? ` (sur ${REGISTRE.length})` : '');

  elCorps.innerHTML = '';
  if (!fiches.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="vide" colspan="6">Aucune résidence pour ces critères.</td>';
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
      <td>${esc(get.esss(f))}</td>
      <td>${formatCollecteLe(f._collecteLe) ?? '—'}</td>`;
    tr.addEventListener('click', () => ouvrirDetail(f.noForm));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') ouvrirDetail(f.noForm); });
    elCorps.appendChild(tr);
  }
}

[elCat].forEach((el) => el.addEventListener('change', rendreListe));
[elMin, elMax].forEach((el) => el.addEventListener('input', rendreListe));
elReset.addEventListener('click', () => {
  elRegion.value = ''; elRecherche.value = '';
  elCat.value = ''; elMin.value = ''; elMax.value = '';
  rendreListe();
});

elRegion.addEventListener('change', rendreListe);
elRecherche.addEventListener('input', rendreListe);

async function chargerPages(vue, session) {
  const fiches = [];
  const curseurs = new Set();
  let cursor = null;
  do {
    const data = await appelApi(`?vue=${vue}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
    if (session !== versionSession) throw new Error('session-modifiee');
    if (data.vue !== vue || !Array.isArray(data.fiches) || data.fiches.length > 500
      || (data.nextCursor !== null && (typeof data.nextCursor !== 'string' || !data.nextCursor))) {
      throw new Error('index-invalide');
    }
    if (data.nextCursor !== null && !data.fiches.length) throw new Error('page-vide');
    fiches.push(...data.fiches);
    cursor = data.nextCursor;
    if (cursor !== null) {
      if (curseurs.has(cursor)) throw new Error('curseur-repete');
      curseurs.add(cursor);
    }
  } while (cursor !== null);

  return fiches;
}

async function chargerIndex() {
  const session = versionSession;
  indexEtat = 'chargement';
  REGISTRE = [];
  rendreListe();
  try {
    const fiches = await chargerPages('index', session);
    if (session !== versionSession) return;
    REGISTRE = fiches;
    // L'asset apporte les libellés; il ne détermine pas la couverture de l'index.
    const connues = new Set([...elRegion.options].map((o) => o.value));
    const regions = [...new Set(fiches.map((f) => f.cdRSS).filter(Boolean))].sort();
    for (const cd of regions) {
      if (!connues.has(cd)) elRegion.add(new Option(`Région ${cd}`, cd));
    }
    indexEtat = 'pret';
  } catch (e) {
    if (session !== versionSession) return;
    REGISTRE = [];
    indexEtat = 'erreur';
  }
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
  noForm: 'noForm MSSS', numeroInterne: 'Numéro interne',
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
  personneMorale: 'Personne morale déclarée', nomCompagnie: 'Nom de compagnie déclaré', neq: 'NEQ déclaré',
  neqNormalise: 'NEQ normalisé (dérivé du MSSS)', nombreTotalUnites: 'Nombre total d’unités',
  personneResponsable: 'Personnes responsables déclarées',
  adresseResidentielle: 'Adresse extraite du REQ (type non distingué)',
  datePrisePossession: 'Date déclarée de prise de possession', actionnaires: 'Actionnaires déclarés',
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
  section2_titulaires: '2 · Exploitant/titulaire déclaré au registre MSSS',
  section3_autresRPA: '3 · Autres RPA',
  section4_personneResponsable: '4 · Personnes responsables déclarées au MSSS',
  section5_administrateurs: '5 · Administrateurs déclarés au MSSS',
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
    if (!['401', '403', 'non-connecte'].includes(e.message)) {
      const compteur = ongletActif === 'sourcing' ? elSCompteur
        : ongletActif === 'changements' ? elChgCompteur : elCompteur;
      compteur.textContent = e.message === 'HTTP 404'
        ? 'Fiche courante indisponible. Cela ne confirme pas une fermeture.'
        : 'Lecture de la fiche impossible. Réessayer ultérieurement.';
    }
    return;
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

  const si = f.enrichissement?.sourcingInverse || {};
  const collecte = formatCollecteLe(f._collecteLe);
  const avis = [];
  if (!collecte) avis.push('Date de collecte inconnue ou illisible');
  if (f._incomplete) avis.push('Fiche signalée incomplète par la collecte');
  if (Array.isArray(f._champsManquants)) avis.push(...f._champsManquants);
  if (s1._categorieARevoir != null) avis.push('Catégorie MSSS à vérifier');
  if (f.section2_titulaires?.personneMorale?._neqARevoir != null) avis.push('NEQ déclaré non normalisable — à vérifier');
  if (si.status === 'A_REVISER' || si.erreur) avis.push('Enrichissement REQ à vérifier');
  elDetail.appendChild(carteSection('Source, observation et qualité', {
    Source: 'Registre MSSS (K10)',
    'noForm MSSS': f.noForm ?? null,
    'Numéro de registre': f.numeroRegistre ?? null,
    'Région de collecte (code)': f._regionCdRSS ?? null,
    'Fiche collectée le': collecte || 'Date inconnue',
    'Fraîcheur': collecte ? 'Non classée — seuil à approuver' : 'Date inconnue',
    'Avertissements disponibles': avis.length ? avis : 'Aucun signalement disponible; qualité non certifiée',
  }));

  // En-tête : champs hors sections. On masque la plomberie (tout champ `_...`
  // sauf la date de collecte, reformatée en date lisible) et le doublon
  // numeroInterne quand il est identique à numeroRegistre — le contenu
  // métier reste intact, on ne masque que ce qui n'apporte rien à la lecture.
  const enteteKeys = Object.keys(f).filter((k) => {
    if (k.startsWith('section')) return false;
    if (k === '_source' || k === 'enrichissement') return false;
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

  elDetail.appendChild(carteSection('Enrichissement REQ — identité non confirmée', {
    'Statut': libelleStatutREQ(si.status),
    'Mise à jour de l’enrichissement': formatCollecteLe(si.updatedAt) || 'Date inconnue',
    'Limite': 'Cette date peut correspondre à une réutilisation du cache REQ, pas à une consultation du registre.',
    'Administrateurs extraits': si.administrateurs ?? [],
    'Erreur signalée': si.erreur ?? 'Aucune erreur renseignée',
  }));
  const autres = Object.fromEntries(Object.entries(f.enrichissement || {})
    .filter(([k]) => k !== 'sourcingInverse'));
  if (Object.keys(autres).length) elDetail.appendChild(carteSection('Autres enrichissements', autres));
  elDetail.appendChild(historiqueObserve(noForm));

  vueListe.hidden = true;
  vueSourcing.hidden = true;
  vueChangements.hidden = true;
  vueDetail.hidden = false;
  window.scrollTo(0, 0);
}

function fermerDetail() {
  activerOnglet(ongletActif);
}

// Réutilise uniquement le dernier comparatif disponible, sans inventer une chronologie.
function historiqueObserve(noForm) {
  const sec = carteSection('Historique observé', {
    'Périmètre': 'Dernier comparatif disponible seulement, sur les champs surveillés. Ce n’est pas un historique complet.',
  });
  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'reset';
  bouton.textContent = 'Lire le dernier comparatif pour cette RPA';
  const compteur = document.createElement('p');
  compteur.className = 'compteur';
  compteur.setAttribute('aria-live', 'polite');
  const contenu = document.createElement('div');
  bouton.addEventListener('click', async () => {
    bouton.disabled = true;
    compteur.textContent = 'Chargement…';
    contenu.replaceChildren();
    try {
      const data = await appelApi('?vue=changements');
      if (!sec.isConnected) return;
      const filtre = { ...data };
      for (const cle of ['apparues', 'disparues', 'modifiees']) {
        filtre[cle] = (Array.isArray(data[cle]) ? data[cle] : [])
          .filter((e) => String(e.noForm) === String(noForm));
      }
      rendreChangements(filtre, contenu, compteur, false);
    } catch (e) {
      compteur.textContent = e.message === 'HTTP 404'
        ? 'Aucun comparatif disponible; historique non vérifiable.'
        : 'Lecture du comparatif impossible; aucune conclusion sur l’historique.';
    } finally {
      bouton.disabled = false;
    }
  });
  sec.append(bouton, compteur, contenu);
  return sec;
}

function boutonFiche(noForm) {
  return `<button type="button" class="reset" data-fiche="${esc(noForm)}">Ouvrir la fiche courante</button>`;
}

function relierFiches(conteneur) {
  conteneur.querySelectorAll('[data-fiche]').forEach((bouton) => {
    bouton.addEventListener('click', () => ouvrirDetail(bouton.dataset.fiche));
  });
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

// Timestamp Firestore ou horodatage ISO avec fuseau → date lisible française
// (fuseau America/Montreal), ex. « 3 juillet 2026 à 03h12 ».
function formatCollecteLe(ts) {
  const millis = ts && Number.isFinite(ts._seconds) ? ts._seconds * 1000
    : typeof ts === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(ts) ? Date.parse(ts) : NaN;
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime())) return null;
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
const elSReset = document.getElementById('s-reset');
const elSSuite = document.getElementById('s-suite');
const elSCompteur = document.getElementById('s-compteur');
const elSCartes = document.getElementById('s-cartes');

let SOURCING = []; // projection REQ toutes régions, publiée seulement une fois complète
let sourcingFiltrees = []; // sélection complète, jamais limitée à la page affichée
let sourcingEtat = 'initial';
let sourcingAffiches = 50;

// ==================== CHANGEMENTS (veille mensuelle) ====================
const vueChangements = document.getElementById('vue-changements');
const elChgCompteur = document.getElementById('chg-compteur');
const elChgContenu = document.getElementById('chg-contenu');
let changementsCharges = false; // garde anti-refetch (rechargé une fois par session)

// Formate une valeur de champ pour l'affichage (null → "(non renseigné)", tableaux
// lisibles : associations = liste ; personneResponsable = "Prénom Nom").
function formaterValeurChangement(champ, v) {
  if (v === null || v === undefined || v === '') return '(non renseigné)';
  if (Array.isArray(v)) {
    if (!v.length) return '(non renseigné)';
    if (champ === 'personneResponsable') {
      return v.map((p) => `${p?.prenom || ''} ${p?.nom || ''}`.trim() || '(sans nom)').join(', ');
    }
    return v.join(', '); // associations et autres tableaux de chaînes
  }
  return String(v);
}

async function chargerChangements() {
  elChgCompteur.textContent = 'Chargement…';
  elChgContenu.innerHTML = '';
  let data;
  try {
    data = await appelApi('?vue=changements'); // mode réel : dernier diff daté
  } catch (e) {
    // appelApi lève Error('HTTP 404') sur !res.ok — le 404 (aucun diff) est
    // ainsi distinguable du 401/403 (déjà gérés/redirigés par appelApi).
    if (String(e.message).includes('404')) {
      elChgCompteur.textContent = 'Aucun comparatif disponible; aucune conclusion sur les changements.';
      elChgContenu.innerHTML = '';
      changementsCharges = true; // rien à recharger tant qu'on reste connecté
      return;
    }
    elChgCompteur.textContent = 'Lecture du comparatif impossible. Réessayer ultérieurement.';
    return; // 401/403 : écran déjà basculé par appelApi
  }
  changementsCharges = true;
  rendreChangements(data);
}

function rendreChangements(data, contenu = elChgContenu, compteur = elChgCompteur, liens = true) {
  const apparues = Array.isArray(data.apparues) ? data.apparues : [];
  const disparues = Array.isArray(data.disparues) ? data.disparues : [];
  const modifiees = Array.isArray(data.modifiees) ? data.modifiees : [];
  const total = apparues.length + disparues.length + modifiees.length;

  // Compteur récap + provenance (quels snapshots ont été comparés).
  compteur.textContent =
    `${total} changement${total > 1 ? 's' : ''} — `
    + `${apparues.length} apparue${apparues.length > 1 ? 's' : ''}, `
    + `${disparues.length} disparue${disparues.length > 1 ? 's' : ''}, `
    + `${modifiees.length} modifiée${modifiees.length > 1 ? 's' : ''} · `
    + 'dans ce comparatif uniquement.';
  const dateSnapshot = (id) => /^snapshot_\d{4}-\d{2}-\d{2}$/.test(id || '')
    ? id.slice('snapshot_'.length) : 'Date inconnue';
  const provenance = `<p class="cs-sous">Source : observations MSSS · Comparatif ${esc(data.id || 'non renseigné')}<br>
    Snapshot ancien : ${esc(data._snapshot_ancien || 'non renseigné')} (${esc(dateSnapshot(data._snapshot_ancien))})<br>
    Snapshot récent : ${esc(data._snapshot_recent || 'non renseigné')} (${esc(dateSnapshot(data._snapshot_recent))})<br>
    Comparatif produit le : ${esc(formatCollecteLe(data._cree_le) || 'Date inconnue')}<br>
    Dates d’observation, pas dates effectives des changements. Noms : fiche courante pour apparitions/modifications; snapshot ancien pour absences, si conservé.</p>`;
  const acces = (e) => liens ? boutonFiche(e.noForm) : '';

  // Carte APPARUE : nom (ou libellé "nouvelle fiche" si nom null) + noForm.
  const carteApparue = (e) => {
    const nom = e.nom ? esc(e.nom) : `— (nouvelle fiche ${esc(e.noForm)})`;
    return `<div class="carte-sourcing">
      <div class="cs-tete">
        <div><h3 class="cs-nom">${nom} <span class="badge b-ok">Apparition observée</span></h3>
          <p class="cs-sous">noForm MSSS ${esc(e.noForm)}</p>${acces(e)}</div>
      </div>
    </div>`;
  };

  // Carte DISPARUE : absence entre deux observations, sans conclusion de fermeture.
  const carteDisparue = (e) => `<div class="carte-sourcing">
      <div class="cs-tete">
        <div><h3 class="cs-nom">${esc(e.nom || '(sans nom)')} <span class="badge b-warn">Absence observée au registre</span></h3>
          <p class="cs-sous">noForm MSSS ${esc(e.noForm)} · Cette observation ne confirme pas la fermeture de la résidence.</p>${acces(e)}</div>
      </div>
    </div>`;

  // Carte MODIFIÉE : nom + noForm, puis une ligne par champ (avant → après).
  const carteModifiee = (e) => {
    const champs = Array.isArray(e.champs) ? e.champs : [];
    const lignes = champs.map((c) =>
      `<p class="cs-sous">${esc(c.champ === 'nomCompagnie' ? 'Nom de compagnie déclaré modifié' : label(c.champ))} : avant ${esc(formaterValeurChangement(c.champ, c.avant))} → après ${esc(formaterValeurChangement(c.champ, c.apres))}</p>`
    ).join('');
    return `<div class="carte-sourcing">
      <div class="cs-tete">
        <div><h3 class="cs-nom">${esc(e.nom || '(sans nom)')} <span class="badge b-info">Modification observée</span></h3>
          <p class="cs-sous">noForm MSSS ${esc(e.noForm)}</p>${acces(e)}</div>
      </div>
      ${lignes}
    </div>`;
  };

  // Une section titrée ; 0 entrée → "Aucune" discret plutôt qu'une carte vide.
  const section = (titre, entrees, renduCarte) =>
    `<h2 class="cs-titre-bloc">${esc(titre)} (${entrees.length})</h2>`
    + (entrees.length ? entrees.map(renduCarte).join('') : '<p class="vide">Aucune</p>');

  contenu.innerHTML = provenance
    + section('Apparitions observées', apparues, carteApparue)
    + section('Absences observées', disparues, carteDisparue)
    + section('Modifications observées', modifiees, carteModifiee);
  if (liens) relierFiches(contenu);
}

async function chargerSourcing() {
  if (sourcingEtat !== 'initial') return;
  const session = versionSession;
  sourcingEtat = 'chargement';
  SOURCING = [];
  rendreSourcing();
  try {
    const fiches = await chargerPages('sourcing', session);
    if (session !== versionSession) return;
    SOURCING = fiches;
    const connues = new Set([...elSRegion.options].map((o) => o.value));
    for (const cd of [...new Set(fiches.map((f) => f.cdRSS).filter(Boolean))].sort()) {
      if (!connues.has(cd)) elSRegion.add(new Option(`Région ${cd}`, cd));
    }
    sourcingEtat = 'pret';
  } catch (e) {
    if (session !== versionSession) return;
    SOURCING = [];
    sourcingEtat = 'erreur';
  }
  rendreSourcing();
}

function libelleStatutREQ(s) {
  if (s === 'REQ_DONE') return 'Enrichissement REQ effectué';
  if (s === 'A_REVISER') return 'À vérifier';
  if (!s || s === 'NON_TRAITE') return 'Non traité';
  return `Statut non reconnu : ${s}`;
}
function badgeStatut(s) {
  return `<span class="badge ${s === 'A_REVISER' ? 'b-warn' : 'b-neutre'}">${esc(libelleStatutREQ(s))}</span>`;
}
function badgeQualite(q) {
  if (q === 'DECIDEUR') return '<span class="badge b-info">Indice : contact potentiellement pertinent</span>';
  if (q === 'GENERALE') return '<span class="badge b-neutre">Indice : courriel à préfixe générique</span>';
  if (q === 'PERSO') return '<span class="badge b-info">Indice : courriel à vérifier</span>';
  return '';
}

// Correspondances contextualisées, sans créer d'identité personne/entreprise.
function correspondancesSourcing(r) {
  const q = normaliserRecherche(elSSearch.value);
  if (!q) return [];
  const contient = (valeurs) => valeurs.some((v) => normaliserRecherche(v).includes(q));
  const resultats = [];
  if (contient([r.nom, r.noForm, r.numeroRegistre, r.municipalite, r.adresse,
    r.cdRSS, r.esss, libellesRegions.get(r.cdRSS), r.telephone, r.telecopieur,
    ...(r.courriels || [])])) resultats.push({ type: 'RPA', texte: r.nom || r.noForm });
  if (contient([r.nomCompagnie, r.neq, r.neqBrut]))
    resultats.push({ type: 'ENTREPRISE', texte: r.nomCompagnie || 'Nom non renseigné au MSSS' });
  for (const a of r.administrateurs || []) {
    const nom = `${a.prenom || ''} ${a.nom || ''}`.trim();
    if (contient([nom, `${a.nom || ''} ${a.prenom || ''}`, a.fonction, a.adresseResidentielle]))
      resultats.push({ type: 'PERSONNE', texte: nom || 'Nom non renseigné' });
  }
  return resultats;
}

function sourcingFiltre() {
  const c = elSContact.value;
  const st = elSStatut.value;
  const cd = elSRegion.value;
  const q = normaliserRecherche(elSSearch.value);
  return SOURCING.filter((r) =>
    (!cd || r.cdRSS === cd)
    && (!c || r.courrielQualite === c)
    && (!st || (r.sourcingStatus || 'NON_TRAITE') === st)
    && (!q || correspondancesSourcing(r).length > 0));
}

function rendreSourcing() {
  elSExport.disabled = sourcingEtat !== 'pret';
  elSSuite.hidden = true;
  if (sourcingEtat !== 'pret') {
    sourcingFiltrees = [];
    elSCartes.replaceChildren();
    elSCompteur.textContent = sourcingEtat === 'erreur'
      ? 'Recherche REQ indisponible ou incomplète. Rechargez la page pour réessayer.'
      : 'Chargement de la recherche REQ toutes régions…';
    return;
  }
  const fiches = sourcingFiltre();
  sourcingFiltrees = fiches;
  elSCompteur.textContent = `${fiches.length} résidence${fiches.length > 1 ? 's' : ''}`
    + (fiches.length !== SOURCING.length ? ` (sur ${SOURCING.length})` : '')
    + ` · ${Math.min(sourcingAffiches, fiches.length)} affichées; export sur toute la sélection`;
  if (!fiches.length) {
    elSExport.disabled = true;
    elSCartes.innerHTML = '<p class="vide">Aucune fiche pour ces critères.</p>';
    return;
  }
  elSExport.disabled = !fiches.length;
  elSSuite.hidden = fiches.length <= sourcingAffiches;
  elSCartes.innerHTML = fiches.slice(0, sourcingAffiches).map(carteSourcing).join('');
  relierFiches(elSCartes);
}

function carteSourcing(r) {
  const admins = Array.isArray(r.administrateurs) ? r.administrateurs : [];
  let blocAdmins = '<p class="cs-vide">Aucun administrateur REQ extrait disponible.</p>';
  if (admins.length) {
    blocAdmins = '<table class="cs-admins"><thead><tr><th>Personne extraite du REQ</th><th>Fonction extraite</th><th>Adresse extraite (type non distingué)</th></tr></thead><tbody>'
      + admins.map((a) => `<tr><td class="cs-dir">${esc(`${a.prenom || ''} ${a.nom || ''}`.trim())}</td><td>${esc(a.fonction || '—')}</td><td>${esc(a.adresseResidentielle || '—')}</td></tr>`).join('')
      + '</tbody></table>';
  }
  const contacts = [];
  if (r.telephone) contacts.push(`<a href="tel:${esc(r.telephone)}">📞 ${esc(r.telephone)}</a>`);
  for (const mail of r.courriels || []) {
    contacts.push(`<span>✉️ <a href="mailto:${esc(mail)}">${esc(mail)}</a>${mail === r.courriel ? ' ' + badgeQualite(r.courrielQualite) : ''}</span>`);
  }
  if (r.telecopieur) contacts.push(`<span class="cs-vide">📠 ${esc(r.telecopieur)}</span>`);
  if (!r.telephone && !r.courriel) contacts.push('<span class="cs-vide">Aucune coordonnée au registre K10</span>');

  const correspondances = correspondancesSourcing(r).map((m) =>
    `<li><strong>${esc(m.type)}</strong> : ${esc(m.texte)}</li>`).join('');
  return `<div class="carte-sourcing">
    <div class="cs-tete">
      <div>
        <h3 class="cs-nom">RPA : ${esc(r.nom || '(sans nom)')} ${badgeStatut(r.sourcingStatus)}</h3>
        <p class="cs-sous">${esc(r.esss || '—')}</p>
      </div>
      <div class="cs-droite">
        <span class="badge">Catégorie ${r.categorieRPA ?? '—'}</span>
        <p class="cs-neq">NEQ normalisé depuis le MSSS : ${esc(r.neq || 'non renseigné')} · Capacité RPA déclarée : ${esc(r.capacite ?? '—')}</p>
      </div>
    </div>
    <p class="cs-sous">Municipalité : ${esc(r.municipalite || '—')} · Adresse MSSS : ${esc(r.adresse || '—')}</p>
    <p class="cs-sous">Compagnie déclarée au MSSS : ${esc(r.nomCompagnie || '—')} · NEQ déclaré : ${esc(r.neqBrut || '—')}</p>
    <p class="cs-sous">noForm MSSS : ${esc(r.noForm)} · Numéro de registre : ${esc(r.numeroRegistre || '—')}</p>
    ${correspondances ? `<ul>${correspondances}</ul>` : ''}
    <p class="cs-sous">Personnes extraites lors du traitement du NEQ associé à cette fiche; relation technique, sans confirmation de propriété ni d’autorité.</p>
    ${boutonFiche(r.noForm)}
    <div class="cs-titre-bloc">Coordonnées déclarées au MSSS</div>
    <div class="cs-contacts">${contacts.join('')}</div>
    <p class="cs-sous">Indices heuristiques sur le courriel : aucune preuve d’autorité ni autorisation de communication.</p>
    <details><summary>Personnes et fonctions extraites du REQ</summary>
    <p class="cs-sous">Enrichissement REQ ≠ identité corporative confirmée.</p>
    ${r.erreurREQ ? `<p class="cs-sous">À vérifier : ${esc(r.erreurREQ)}</p>` : ''}
    ${blocAdmins}
    </details>
  </div>`;
}

// Export CSV des adresses de domicile des dirigeants (publipostage).
// Respecte les filtres courants et dédoublonne par foyer.
function exporterAdresses() {
  if (sourcingEtat !== 'pret') return;
  const source = sourcingFiltre(); // tous les résultats filtrés, même non affichés
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

function filtrerSourcing() {
  sourcingAffiches = 50;
  rendreSourcing();
}
[elSRegion, elSContact, elSStatut].forEach((el) => el.addEventListener('change', filtrerSourcing));
elSSearch.addEventListener('input', filtrerSourcing);
elSReset.addEventListener('click', () => {
  elSRegion.value = ''; elSContact.value = ''; elSStatut.value = ''; elSSearch.value = '';
  filtrerSourcing();
});
elSSuite.addEventListener('click', () => {
  sourcingAffiches += 50;
  rendreSourcing();
});
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
  vueChangements.hidden = tab !== 'changements';
  // Changements n'a pas de filtre région : on charge au premier affichage.
  if (tab === 'changements' && !changementsCharges) chargerChangements();
  if (tab === 'sourcing') chargerSourcing();
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
  vueChangements.hidden = true;
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
  vueChangements.hidden = true;
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
  const session = versionSession;
  const res = await fetch(`${CONSULTATION_API_URL}${queryString}`, {
    headers: { Authorization: `Bearer ${idTokenActuel}` },
  });
  if (session !== versionSession) throw new Error('session-modifiee');
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

// L'index léger est chargé après authentification et contrôle d'accès.
// Les fiches détaillées restent chargées uniquement à la demande.
//
// Sonde d'accès immédiate : on ne veut pas attendre le premier clic sur
// « Charger » pour révéler un 403 — ?cdRSS=00 est un appel légitime au sens
// du contrat de l'API (aucun cdRSS réel ne vaut « 00 »), qui traverse le mur
// (token + liste blanche) sans dépendre d'une vraie région. 200 → autorisé
// (même si 0 résultat) ; 403 → geré par appelApi (écran refus), sans jamais
// avoir affiché la moindre donnée.
onAuthStateChanged(auth, async (user) => {
  const session = ++versionSession;
  SOURCING = []; sourcingFiltrees = [];
  sourcingEtat = 'initial'; sourcingAffiches = 50;
  elSRegion.value = ''; elSContact.value = ''; elSStatut.value = ''; elSSearch.value = '';
  rendreSourcing();
  indexEtat = 'chargement';
  if (!user) {
    idTokenActuel = null;
    elEtatConnexion.hidden = true;
    REGISTRE = [];
    afficherEcranConnexion();
    return;
  }
  const token = await user.getIdToken();
  if (session !== versionSession) return;
  idTokenActuel = token;
  elEtatConnexion.hidden = false;
  elUtilisateurInfo.textContent = user.email || '(connecté)';
  REGISTRE = [];

  try {
    await appelApi('?cdRSS=00');
  } catch (e) {
    return; // 401/403 déjà géré (écran approprié affiché) par appelApi
  }

  if (session !== versionSession) return;
  elRegion.value = ''; elRecherche.value = '';
  elCat.value = ''; elMin.value = ''; elMax.value = '';
  afficherApp();
  rendreListe();
  if (elRegion.options.length <= 1) await peuplerRegions(); // libellés seulement
  if (session !== versionSession) return;
  await chargerIndex();
});
