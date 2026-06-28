/* Consultation du registre — logique client (lecture seule).
 * Données : window.REGISTRE (généré par build-data.js). */

(function () {
  'use strict';

  const REGISTRE = Array.isArray(window.REGISTRE) ? window.REGISTRE : [];

  // --- Raccourcis d'accès aux champs servant à la liste/aux filtres ---
  const get = {
    nom: (f) => f.section1_identification?.nomResidence || '(sans nom)',
    municipalite: (f) => f.section1_identification?.municipalite || '—',
    cat: (f) => f.section1_identification?.categorieRPA,
    unites: (f) => f.section1_identification?.nombreTotalUnitesImmeubles,
    esss: (f) => f.section1_identification?.esss || '—',
  };

  // ============================ FILTRES =============================
  const elESSS = document.getElementById('f-esss');
  const elCat = document.getElementById('f-cat');
  const elMin = document.getElementById('f-min');
  const elMax = document.getElementById('f-max');
  const elReset = document.getElementById('f-reset');
  const elCompteur = document.getElementById('compteur');
  const elCorps = document.getElementById('corps');

  // Remplit la déroulante ÉSSS à partir des données présentes.
  function peuplerESSS() {
    const vues = [...new Set(REGISTRE.map(get.esss).filter((v) => v && v !== '—'))].sort();
    for (const v of vues) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      elESSS.appendChild(opt);
    }
  }

  function fichesFiltrees() {
    const esss = elESSS.value;
    const cat = elCat.value;
    const min = elMin.value === '' ? null : Number(elMin.value);
    const max = elMax.value === '' ? null : Number(elMax.value);

    return REGISTRE.filter((f) => {
      if (esss && get.esss(f) !== esss) return false;
      if (cat && String(get.cat(f)) !== cat) return false;
      const u = get.unites(f);
      if (min !== null && (u == null || u < min)) return false;
      if (max !== null && (u == null || u > max)) return false;
      return true;
    });
  }

  function rendreListe() {
    const fiches = fichesFiltrees();
    elCompteur.textContent = `${fiches.length} résidence${fiches.length > 1 ? 's' : ''}`
      + (fiches.length !== REGISTRE.length ? ` (sur ${REGISTRE.length})` : '');

    elCorps.innerHTML = '';
    if (!fiches.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="vide" colspan="5">Aucune résidence ne correspond aux filtres.</td>';
      elCorps.appendChild(tr);
      return;
    }

    for (const f of fiches) {
      const idx = REGISTRE.indexOf(f);
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.dataset.idx = String(idx);
      tr.innerHTML = `
        <td class="nom">${esc(get.nom(f))}</td>
        <td>${esc(get.municipalite(f))}</td>
        <td class="num">${get.cat(f) ?? '—'}</td>
        <td class="num">${get.unites(f) ?? '—'}</td>
        <td>${esc(get.esss(f))}</td>`;
      tr.addEventListener('click', () => ouvrirDetail(idx));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') ouvrirDetail(idx); });
      elCorps.appendChild(tr);
    }
  }

  [elESSS, elCat].forEach((el) => el.addEventListener('change', rendreListe));
  [elMin, elMax].forEach((el) => el.addEventListener('input', rendreListe));
  elReset.addEventListener('click', () => {
    elESSS.value = ''; elCat.value = ''; elMin.value = ''; elMax.value = '';
    rendreListe();
  });

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

  function ouvrirDetail(idx) {
    const f = REGISTRE[idx];
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

    // En-tête : champs hors sections
    const enteteKeys = Object.keys(f).filter((k) => !k.startsWith('section') && k !== '_source');
    elDetail.appendChild(carteSection('Informations générales',
      Object.fromEntries(enteteKeys.map((k) => [k, f[k]]))));

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

  // ============================ INIT ===============================
  if (!REGISTRE.length) {
    elCompteur.textContent = 'Aucune donnée chargée. Lancez : node app-consultation/build-data.js';
  } else {
    peuplerESSS();
    rendreListe();
  }
})();
