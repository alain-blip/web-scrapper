// Parseur HTML → structure brute de la fiche « État des renseignements » (REQ).
//
// Calé sur le vrai balisage (fixture fixtures/req-1141016072.html, CHÂTEAU
// PIERREFONDS INC.). Le REQ présente toute l'information sous la même forme :
//
//   <h4>Titre de section</h4>
//   <ul class="kx-synthese">
//     <li class="kx-display">
//       <span class="kx-display-label">Libellé</span>
//       <span class="kx-display-field">Valeur</span>
//     </li> …
//   </ul>
//
// Une section peut avoir PLUSIEURS <ul> consécutifs (ex. un <ul> par
// administrateur). blocsSous() renvoie donc un tableau de blocs {libellé:valeur}.
// Les sections « vides » sont rendues par un <div class="alert"> à la place du
// <ul> (« Aucun … déclaré ») — naturellement ignoré (0 bloc).

import { load } from 'cheerio';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

// Extrait les paires libellé→valeur d'un <ul class="kx-synthese">.
function paires($, ul) {
  const o = {};
  $(ul).find('li.kx-display').each((_, li) => {
    const label = norm($(li).find('.kx-display-label').text());
    // <br> → séparateur : « Président<br> » et listes de fonctions.
    const field = norm($(li).find('.kx-display-field').html()?.replace(/<br\s*\/?>/gi, ' | ') || '');
    // on repasse le HTML nettoyé dans cheerio pour retirer d'éventuelles balises
    const valeur = norm(load(`<x>${field}</x>`)('x').text());
    if (label) o[label] = valeur;
  });
  return o;
}

// Tous les blocs <ul class="kx-synthese"> qui suivent un titre donné, jusqu'au
// prochain titre (h1..h6). Match par égalité normalisée du texte du titre.
function blocsSous($, titre) {
  const heading = $('h1,h2,h3,h4,h5,h6').filter((_, el) => norm($(el).text()) === titre).first();
  if (!heading.length) return [];
  const blocs = [];
  let node = heading.next();
  while (node.length && !/^h[1-6]$/i.test(node[0].tagName || '')) {
    if (node.is('ul.kx-synthese')) blocs.push(paires($, node));
    node = node.next();
  }
  return blocs;
}

// Premier bloc sous un titre (sections à valeurs uniques).
function blocSous($, titre) {
  return blocsSous($, titre)[0] || {};
}

export function extractReq(html, meta = {}) {
  const $ = load(html);

  const identification = blocSous($, "Identification de l'entreprise");
  const immatriculation = blocSous($, 'Immatriculation');
  const formeJuridique = blocSous($, 'Forme juridique');
  const datesMAJ = blocSous($, 'Dates des mises à jour');

  // Adresse du domicile : premier bloc, libellé « Adresse ».
  const adresseDomicile = blocSous($, 'Adresse du domicile')['Adresse'] || null;

  // Activités économiques : 1er secteur (CAE / Activité / Précisions) + salariés.
  const secteur1 = blocSous($, "1er secteur d'activité");
  const salaries = blocSous($, 'Nombre de salariés');

  // Organes de direction.
  const actionnaires = blocsSous($, 'Actionnaires');
  const administrateurs = blocsSous($, 'Liste des administrateurs');
  const dirigeants = blocsSous($, 'Dirigeants non membres du conseil d’administration');
  const beneficiairesUltimes = blocsSous($, 'Listes des bénéficiaires ultimes');
  const fondeDePouvoir = blocsSous($, 'Fondé de pouvoir');

  // Autres noms utilisés au Québec.
  const autresNoms = blocsSous($, 'Autres noms utilisés au Québec')
    .map((b) => b['Autre nom'])
    .filter(Boolean);

  // « Renseignements en date du AAAA-MM-JJ … » (paragraphe hors kx-synthese).
  const dateRensParagraphe = norm(
    $('p').filter((_, el) => /Renseignements en date du/i.test($(el).text())).first().text(),
  );
  const dateRenseignements = (dateRensParagraphe.match(/\d{4}-\d{2}-\d{2}/) || [null])[0];

  return {
    neq: identification["Numéro d'entreprise du Québec (NEQ)"] || meta.neq || null,
    nom: identification['Nom'] || null,
    adresseDomicile,
    autresNoms,

    immatriculation,       // { "Date d'immatriculation", "Statut", "Date de mise à jour du statut", … }
    formeJuridique,        // { "Forme juridique", "Date de la constitution", "Régime courant", … }
    datesMAJ,

    secteur1,              // { "Code d'activité économique (CAE)", "Activité", "Précisions (facultatives)" }
    salaries,              // { "Nombre de salariés au Québec", … }

    actionnaires,          // [{ … }]
    administrateurs,       // [{ "Nom de famille", "Prénom", "Date du début de la charge", "Fonctions actuelles", … }]
    dirigeants,
    beneficiairesUltimes,
    fondeDePouvoir,

    dateRenseignements,    // AAAA-MM-JJ
    _stub: false,
  };
}
