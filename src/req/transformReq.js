// Structure brute (extractReq) → JSON de sortie final `section_req`.
//
// C'est le champ que la fiche PrimExpert / l'onglet « Sourcing REQ » lira sur le
// document `residences` (bloc « STRUCTURE JURIDIQUE & ORGANES DE DIRECTION »).
// Schéma stable et documenté ci-dessous ; les valeurs restent nulles tant que
// extractReq est un stub — mais la FORME est définitive.
//
// Schéma `section_req` :
// {
//   neq:                 string|null,   // NEQ normalisé (10 chiffres)
//   raisonSociale:       string|null,   // nom légal
//   autresNoms:          string[],      // autres noms utilisés au Québec
//   formeJuridique:      string|null,   // « Société par actions », etc.
//   statutImmatriculation: string|null, // « Immatriculée » / « Radiée »
//   dateImmatriculation: string|null,
//   dateMiseAJourEtat:   string|null,
//   adresseSiege:        string|null,
//   administrateurs:     [{ nom, prenom, fonction, dateDebut, dateFin }],
//   dirigeants:          [{ nom, prenom, fonction }],
//   actionnaires:        [{ nom, prenom, mention }],
//   fondeDePouvoir:      [{ nom, prenom }],
//   activitesEconomiques:[{ code, description }],
//   _source:             'REQ',
//   _incomplete?:        true           // posé si le parseur n'a rien extrait
// }

const strOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};

// Un NEQ québécois normalisé = exactement 10 chiffres, sinon null (même règle
// que transform.js pour la fiche K10).
function neqNormalise(neq) {
  if (!neq) return null;
  const chiffres = String(neq).replace(/\D/g, '');
  return chiffres.length === 10 ? chiffres : null;
}

// Découpe « Nom, Prénom » → { nom, prenom }. Tolérant : si un seul segment,
// tout va dans `nom`. (À affiner sur fixture selon l'ordre réel des colonnes.)
function nomPrenom(cellules = []) {
  const nom = strOrNull(cellules[0]);
  const prenom = strOrNull(cellules[1]);
  return { nom, prenom };
}

export function transformReq(raw = {}) {
  const administrateurs = (raw.administrateurs || []).map((r) => ({
    ...nomPrenom(r.cellules),
    fonction: strOrNull(r.cellules?.[2]),
    dateDebut: strOrNull(r.cellules?.[3]),
    dateFin: strOrNull(r.cellules?.[4]),
  }));

  const dirigeants = (raw.dirigeants || []).map((r) => ({
    ...nomPrenom(r.cellules),
    fonction: strOrNull(r.cellules?.[2]),
  }));

  const actionnaires = (raw.actionnaires || []).map((r) => ({
    ...nomPrenom(r.cellules),
    mention: strOrNull(r.cellules?.[2]),
  }));

  const fondeDePouvoir = (raw.fondeDePouvoir || []).map((r) => nomPrenom(r.cellules));

  const activitesEconomiques = (raw.activitesEconomiques || []).map((r) => ({
    code: strOrNull(r.cellules?.[0]),
    description: strOrNull(r.cellules?.[1]),
  }));

  const autresNoms = (raw.identification?.autresNoms || [])
    .map((r) => strOrNull(r.cellules?.[0]))
    .filter(Boolean);

  const section = {
    neq: neqNormalise(raw.neq),
    raisonSociale: strOrNull(raw.identification?.nom),
    autresNoms,
    formeJuridique: strOrNull(raw.formeJuridique),
    statutImmatriculation: strOrNull(raw.statut?.immatriculation),
    dateImmatriculation: strOrNull(raw.statut?.dateImmatriculation),
    dateMiseAJourEtat: strOrNull(raw.statut?.dateMiseAJour),
    adresseSiege: strOrNull(raw.adresseSiege),
    administrateurs,
    dirigeants,
    actionnaires,
    fondeDePouvoir,
    activitesEconomiques,
    _source: 'REQ',
  };

  // Rien d'exploitable extrait (stub, ou fiche vide/anti-bot) → on le rend visible
  // au lieu de faire croire à une collecte réussie (même esprit que _incomplete
  // dans la collecte K10).
  const aDuContenu = section.raisonSociale
    || section.formeJuridique
    || administrateurs.length
    || actionnaires.length;
  if (raw._stub || !aDuContenu) section._incomplete = true;

  return section;
}
