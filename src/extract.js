// Extraction du HTML d'une fiche détail K10 vers une structure brute.
//
// Méthodes de parsing (cf. MAPPING.md) :
//   LV  = paire label/valeur (span.libelleLecture)
//   QR  = question numérotée Oui/Non/valeur (ligne « n° | libellé | réponse »)
//   TBL = tableaux dédiés (#tableauAdm, #tableauExp, sous-tableaux 6.x…)

import * as cheerio from 'cheerio';

// --- helpers généraux -----------------------------------------------------

// Normalise un texte : espaces compactés, &nbsp; → espace, trim.
function clean(s) {
  if (s == null) return '';
  return s
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalise pour comparaison « tolérante » : minuscules, sans accents,
// sans apostrophes/guillemets (le source mélange ' droit, ' typographique, et
// des apostrophes parfois absentes à cause de l'encodage cp1252).
function norm(s) {
  return clean(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['‘’‚‛`´"“”]/g, '');
}

export function load(html) {
  return cheerio.load(html);
}

// --- LV : label/valeur via span.libelleLecture ---------------------------

// Renvoie la valeur associée à un label (préfixe, comparaison tolérante).
// Gère 3 dispositions :
//   1. valeur dans le même <td>, après <br/>  (cas majoritaire)
//   2. valeur dans le <td> voisin de la même ligne (territoire CLSC/RLS)
//   3. valeur dans la ligne suivante d'un formTableauVide (type de résidence)
function getLV($, labelPrefix) {
  const target = norm(labelPrefix);
  let value = null;
  $('span.libelleLecture').each((_, el) => {
    if (value !== null) return;
    const label = norm($(el).text().replace(/:\s*$/, ''));
    if (!label.startsWith(target)) return;

    const td = $(el).closest('td');

    // 1. texte restant dans le td après avoir retiré le span
    const tdClone = td.clone();
    tdClone.find('span.libelleLecture').remove();
    const inline = clean(tdClone.text());
    if (inline) { value = inline; return; }

    // 2. td voisin de la même ligne
    const sibling = clean(td.next('td').text());
    if (sibling) { value = sibling; return; }

    // 3. ligne suivante (formTableauVide : label sur une ligne, valeur dessous)
    if (td.closest('table').hasClass('formTableauVide')) {
      const nextRowVal = clean(td.closest('tr').next('tr').find('td').first().text());
      if (nextRowVal) { value = nextRowVal; return; }
    }
    value = ''; // label trouvé mais aucune valeur
  });
  return value; // null si label absent, '' si présent mais vide
}

// --- QR : questions numérotées -------------------------------------------

// Trouve la ligne dont une cellule vaut exactement le numéro donné.
// Renvoie l'objet cheerio <tr>, ou null.
function rowByNumber($, number) {
  let row = null;
  $('tr').each((_, tr) => {
    if (row) return;
    $(tr).children('td').each((__, td) => {
      if (clean($(td).text()) === number) { row = $(tr); }
    });
  });
  return row;
}

// Dernière cellule non vide d'une ligne, en excluant la cellule « numéro ».
function lastAnswer($, row, number) {
  if (!row) return null;
  const cells = row.children('td').toArray()
    .map((td) => clean($(td).text()))
    .filter((t) => t && t !== number);
  return cells.length ? cells[cells.length - 1] : '';
}

// Réponse d'une question numérotée inline (n° | libellé | réponse).
function qNum($, number) {
  return lastAnswer($, rowByNumber($, number), number);
}

// Réponse située dans la LIGNE SUIVANTE du numéro (9.3, 9.4, 9.5…).
function qNumNextRow($, number) {
  const row = rowByNumber($, number);
  if (!row) return null;
  const next = row.next('tr');
  return lastAnswer($, next, number);
}

// Réponse d'une ligne repérée par un fragment de texte de la question.
// Le formulaire est un grand tableau imbriqué : plusieurs <tr> englobants
// contiennent le fragment. On retient la ligne la PLUS SPÉCIFIQUE (texte le
// plus court parmi celles qui correspondent), c.-à-d. la ligne « feuille ».
function qText($, fragment) {
  const target = norm(fragment);
  let best = null;
  let bestLen = Infinity;
  $('tr').each((_, tr) => {
    const full = norm($(tr).text());
    if (!full.includes(target)) return;
    if (full.length < bestLen) { bestLen = full.length; best = $(tr); }
  });
  if (!best) return null;
  const nonEmpty = best.children('td').toArray()
    .map((td) => clean($(td).text())).filter(Boolean);
  return nonEmpty.length ? nonEmpty[nonEmpty.length - 1] : '';
}

// Items <li> d'une liste dont le <td> parent contient un fragment de texte.
function liByParentText($, fragment) {
  const target = norm(fragment);
  let items = [];
  $('ul').each((_, ul) => {
    if (items.length) return;
    const td = $(ul).closest('td');
    const tdClone = td.clone();
    tdClone.find('ul').remove();
    if (norm(tdClone.text()).includes(target)) {
      items = $(ul).find('li').toArray().map((li) => clean($(li).text())).filter(Boolean);
    }
  });
  return items;
}

// --- extraction par section ----------------------------------------------

function extractHeader($) {
  const titre = clean($('h1 a[name="haut"]').first().text()); // « Résidence Murray (395-1) »
  const regMatch = titre.match(/\((\d+-\d+)\)/);

  const interneTxt = clean($('h1').filter((_, el) => /Num[ée]ro interne/i.test($(el).text())).first().text());
  const interneMatch = interneTxt.match(/(\d+)/);

  // résidences liées : tous les jetons « n-n » dans le bloc « est liée aux résidences »
  let residencesLiees = [];
  $('p').each((_, p) => {
    const t = clean($(p).text());
    if (/li[ée]e?\s+aux?\s+r[ée]sidences/i.test(t)) {
      residencesLiees = (t.match(/\d+-\d+/g) || []);
    }
  });

  // statut : le <h2> sans ancre de section (Active / Inactive…)
  let statut = null;
  $('h2').each((_, el) => {
    if ($(el).find('a[name^="lien_"]').length) return;
    const t = clean($(el).text());
    if (t && statut === null) statut = t;
  });

  return {
    numeroRegistre: regMatch ? regMatch[1] : null,
    numeroInterne: interneMatch ? interneMatch[1] : null,
    residencesLiees,
    statut,
  };
}

function extractSection1($) {
  const courrielsRaw = getLV($, 'adresse courriel');
  return {
    nomResidence: getLV($, 'nom de la residence'),
    adresse: getLV($, 'adresse de la residence'),
    codePostal: getLV($, 'code postal'),
    esss: getLV($, 'etablissement de sante et de services sociaux'),
    municipalite: getLV($, 'municipalite'),
    territoireCLSC: getLV($, 'territoire clsc'),
    territoireRLS: getLV($, 'territoire rls'),
    territoireMRC: getLV($, 'territoire mrc'), // absent sur Murray → null
    courriels: courrielsRaw ? courrielsRaw.split(/\s*;\s*/).filter(Boolean) : [],
    telephone: getLV($, 'telephone de la residence'),
    telecopieur: getLV($, 'telecopieur de la residence'),
    dateOuverture: getLV($, "date d'ouverture de la residence"),
    typeResidence: getLV($, 'type de la residence'),
    categorieRPA: getLV($, 'categorie de la rpa'),
    nombreTotalUnitesImmeubles: getLV($, "nombre total d'unites du ou des immeubles"),
    appartenanceGroupeReseau: getLV($, 'appartenance a un groupe ou un reseau'),
    immeublesAssocies: parseSousTableau($, '#tableauImmeubles'),
  };
}

// Lignes utiles d'un sous-tableau (#tableauXxx), hors thead/tfoot et hors
// lignes « Aucun/Aucune ».
function rowsOfSousTableau($, selector) {
  const table = $(selector).first();
  if (!table.length) return [];
  return table.find('tbody > tr').toArray()
    .map((tr) => $(tr).children('td').toArray().map((td) => clean($(td).text())))
    .filter((cells) => {
      const joined = norm(cells.join(' '));
      return joined && !/^aucune?$/.test(joined.replace(/\s/g, ''));
    });
}

function parseSousTableau($, selector) {
  // Générique : renvoie les lignes brutes (utilisé pour immeubles/autres RPA,
  // vides sur Murray).
  return rowsOfSousTableau($, selector).map((cells) => cells.filter(Boolean));
}

function extractSection2($) {
  // 1er #tableauExp = actionnaires ; le 2e (section 4) = personne responsable.
  const rows = rowsOfSousTableau($, '#tableauExp');
  const actionnaires = rows.map((cells) => {
    const vals = cells.filter(Boolean);
    let nom = vals[0] || '';
    let prenom = vals[1] || null;
    let mention = null;
    const m = nom.match(/\(([^)]+)\)\s*$/);
    if (m) {
      mention = clean(m[1]);
      nom = clean(nom.replace(/\([^)]+\)\s*$/, ''));
    }
    return { nom, prenom: prenom || null, mention };
  });
  return {
    personneMorale: {
      nomCompagnie: getLV($, 'nom de la compagnie'),
      neq: getLV($, 'numero au registre des entreprises'),
      datePrisePossession: getLV($, 'date de prise de possession'),
    },
    actionnaires,
  };
}

function extractSection3($) {
  return {
    proprietaireAutresRPA: qNum($, '3.1'),
    nombreAutresResidences: qNum($, '3.2'),
    liste: parseSousTableau($, '#tableauResid'),
  };
}

function extractSection4($) {
  // 2e occurrence de #tableauExp
  const tables = $('#tableauExp');
  const table = tables.eq(1).length ? tables.eq(1) : tables.eq(0);
  const rows = table.find('tbody > tr').toArray()
    .map((tr) => $(tr).children('td').toArray().map((td) => clean($(td).text())).filter(Boolean))
    .filter((c) => c.length);
  return rows.map((cells) => ({ nom: cells[0] || '', prenom: cells[1] || null }));
}

function extractSection5($) {
  const rows = rowsOfSousTableau($, '#tableauAdm');
  return rows.map((cells) => {
    const v = cells.filter((c) => c !== '');
    // colonnes : Nom | prénom | Occupation | Fonction (occupation peut manquer)
    return {
      nom: v[0] || '',
      prenom: v[1] || '',
      occupation: null, // vide sur Murray ; non distinguable de façon fiable ici
      fonction: cells.slice(3).filter(Boolean).join(' ') || (v[2] || null),
    };
  });
}

// Parse un sous-tableau « formTableauVide » dont les libellés de ligne
// commencent par un préfixe numéroté (6.3.x, 6.4.x). Renvoie une map
// { '6.3.1': [valeurs...], ... }.
function parseNumberedVide($, prefix) {
  const map = {};
  $('table.formTableauVide tr').each((_, tr) => {
    const cells = $(tr).children('td').toArray().map((td) => clean($(td).text()));
    if (!cells.length) return;
    const m = cells[0].match(new RegExp('^(' + prefix.replace('.', '\\.') + '\\d+(?:\\.\\d+)?)'));
    if (!m) return;
    map[m[1]] = cells.slice(1);
  });
  return map;
}

function toIntCell(s) {
  if (s == null) return null;
  const m = clean(s).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function extractSection6($) {
  // 6.3 répartition par âge
  const ages = parseNumberedVide($, '6.3.');
  const ageVal = (k) => toIntCell((ages[k] || []).filter(Boolean)[0]);

  // 6.4 unités par mission
  const um = parseNumberedVide($, '6.4.');
  const missionRow = (k) => {
    const cells = (um[k] || []);
    // cells = [chambresSimples, chambresDoubles, logements, total, clientele]
    const clientele = cells[4] != null && clean(cells[4]) !== '' ? clean(cells[4]) : null;
    return {
      chambresSimples: toIntCell(cells[0]),
      chambresDoubles: toIntCell(cells[1]),
      logements: toIntCell(cells[2]),
      total: toIntCell(cells[3]),
      clientelePersonnesAgees: clientele,
    };
  };

  // total des unités locatives : ligne « Nombre total dunités locatives … »
  let totalUnites = null;
  $('table.formTableauVide tr').each((_, tr) => {
    const cells = $(tr).children('td').toArray().map((td) => clean($(td).text()));
    if (cells.some((c) => /nombre total d.?unit/i.test(c))) {
      const nums = cells.map(toIntCell).filter((n) => n != null);
      if (nums.length) totalUnites = nums[nums.length - 1];
    }
  });

  // 6.6 tableaux de personnel (formTableauSaisie)
  const saisie = parseSaisieTables($);

  return {
    capaciteTotaleImmeubles: toIntCell(qNum($, '6.1')),
    capaciteRPA: toIntCell(qNum($, '6.2')),
    repartitionAges: {
      moins65: ageVal('6.3.1'),
      de65a74: ageVal('6.3.2'),
      de75a84: ageVal('6.3.3'),
      de85plus: ageVal('6.3.4'),
      totalResidents: ageVal('6.3.5'),
    },
    unitesParMission: {
      rpa: missionRow('6.4.1'),
      ri: missionRow('6.4.2'),
      rtf: missionRow('6.4.3'),
      chsld: missionRow('6.4.4'),
      autres: missionRow('6.4.5'),
    },
    totalUnitesLocatives: totalUnites,
    entente108: qText($, 'entente 108 avec'),
    employes: saisie.employes,
    personnelAssistance: saisie.assistance,
    personnelInfirmier: saisie.infirmier,
  };
}

// Lit les tableaux 6.6.1 / 6.6.2 / 6.6.3 (class formTableauSaisie).
function parseSaisieTables($) {
  const result = { employes: null, assistance: null, infirmier: [] };
  $('table.formTableauSaisie').each((_, tbl) => {
    const $t = $(tbl);
    const head = norm($t.text());
    const dataRows = $t.find('tr').toArray().filter((tr) =>
      $(tr).children('td.formTableauSaisieDonnee').length > 0);

    const parseRow = (tr) => {
      const donnees = $(tr).children('td.formTableauSaisieDonnee').toArray()
        .map((td) => clean($(td).text()));
      // 6 premières = jour/soir/nuit (semaine puis fin de semaine), reste = précisions
      const nums = donnees.slice(0, 6).map(toIntCell);
      const precisions = clean(donnees.slice(6).join(' ')) || null;
      const labelEntete = clean($(tr).children('td.formTableauSaisEntete').last().text());
      return {
        labelEntete,
        semaine: { jour: nums[0], soir: nums[1], nuit: nums[2] },
        finDeSemaine: { jour: nums[3], soir: nums[4], nuit: nums[5] },
        precisions,
      };
    };

    if (head.includes('6.6.1')) {
      const r = parseRow(dataRows[0]);
      result.employes = { semaine: r.semaine, finDeSemaine: r.finDeSemaine };
    } else if (head.includes('6.6.2')) {
      const r = parseRow(dataRows[0]);
      result.assistance = { semaine: r.semaine, finDeSemaine: r.finDeSemaine };
    } else if (head.includes('6.6.3')) {
      result.infirmier = dataRows.map((tr) => {
        const r = parseRow(tr);
        const type = norm(r.labelEntete).includes('auxiliaire')
          ? 'Infirmier(ère) auxiliaire'
          : 'Infirmier(ère)';
        return { type, semaine: r.semaine, finDeSemaine: r.finDeSemaine, precisions: r.precisions };
      });
    }
  });
  return result;
}

function extractSection7($) {
  // 7.1.1 : valeur après le « ? » de la question
  let typeAppel = null;
  const r711 = rowByNumber($, '7.1.1');
  if (r711) {
    const txt = clean(r711.children('td').last().text());
    const parts = txt.split('?');
    typeAppel = clean(parts[parts.length - 1]) || null;
  }
  return {
    securite: {
      typeAppelAide: typeAppel,
      clienteleErrance: qNum($, '7.1.2'),
      dispositifSecuriteSortie: qNum($, '7.1.3'),
    },
    loisirs: qNum($, '7.2'),
    repas: qNum($, '7.3'),
    aideDomestique: qNum($, '7.4'),
    assistancePersonnelle: qNum($, '7.5'),
    soinsInfirmiers: qNum($, '7.6'),
  };
}

function extractSection8($) {
  // associations : items <li> du bloc dont le td contient « Associations : »
  const associations = liByParentText($, 'associations');
  return {
    membreAssociation: qNum($, '8.1'),
    associations,
    permisMAPAQ: qText($, 'mapaq'),
    permisRBQ: qText($, '- rbq'),
  };
}

function extractSection9($) {
  // 9.6 : équipements (liste). Nettoyage : retrait du préfixe « D' » / « De  »
  // et du suffixe « (n) » (renvoi de note), puis majuscule initiale.
  const equipements = liByParentText($, 'equipements suivants')
    .map((s) => s.replace(/^de\s+/i, '').replace(/^d['']/i, ''))
    .map((s) => s.replace(/\s*\(\d+\)\s*$/, ''))
    .map((s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .filter(Boolean);

  return {
    typeConstruction: qNum($, '9.1'),
    sousSol: {
      present: qText($, "dispose-t-il d'un sous-sol"),
      porteExterieure: qText($, 'porte a ce niveau menant directement'),
      residentsHeberges: qText($, 'residents heberges au sous-sol'),
      nombreEtagesHorsSousSol: toIntCell(qText($, "combien d'etages comporte votre immeuble")),
    },
    rampeAcces: qNumNextRow($, '9.3'),
    nombreAscenseurs: toIntCell(qNumNextRow($, '9.4')),
    mitigeurEauChaude: qNumNextRow($, '9.5'),
    equipementsDetectionAlarme: equipements,
    systemeGicleurs: qNum($, '9.7'),
    sourceEauPotable: qNum($, '9.8'),
    generatrice: qNum($, '9.9'),
    climatisation: {
      ensembleImmeubles: qText($, "dans lensemble du ou des immeubles"),
      lieuxCommuns: qText($, 'dans les lieux communs'),
      chambresLogements: qText($, 'dans les chambres ou logements'),
      controleIndependant: qText($, 'controle de la climatisation est-il independant'),
    },
  };
}

// Extraction complète → structure brute (valeurs encore en chaînes Oui/Non).
export function extract(html, { noForm } = {}) {
  const $ = load(html);
  return {
    noForm: noForm != null ? String(noForm) : null,
    header: extractHeader($),
    section1: extractSection1($),
    section2: extractSection2($),
    section3: extractSection3($),
    section4: extractSection4($),
    section5: extractSection5($),
    section6: extractSection6($),
    section7: extractSection7($),
    section8: extractSection8($),
    section9: extractSection9($),
  };
}
