// Structure brute (extractReq) → JSON de sortie final `section_req`.
//
// C'est le champ que la fiche PrimExpert / l'onglet « Sourcing REQ » lira sur le
// document `residences` (bloc « STRUCTURE JURIDIQUE & ORGANES DE DIRECTION »).
// Mapping calé sur le vrai balisage (fixtures/req-1141016072.html).
//
// Schéma `section_req` :
// {
//   neq, raisonSociale, autresNoms[], adresseDomicile,
//   formeJuridique, regimeCourant, dateConstitution,
//   statutImmatriculation, dateImmatriculation, dateMiseAJourStatut,
//   dateMiseAJourEtat, dateDerniereDeclaration,
//   activiteEconomique: { cae, activite, precisions },
//   nombreSalaries,
//   actionnaires:        [{ nom, adresse, mention }],
//   administrateurs:     [{ nom, prenom, dateDebut, fonctions[], adresse }],
//   dirigeants:          [{ nom, prenom, fonctions[] }],
//   beneficiairesUltimes:[{ nom, prenom, dateDebut, situations }],
//   fondeDePouvoir:      [{ nom, prenom }],
//   dateRenseignements,  // AAAA-MM-JJ (fraîcheur de la fiche REQ)
//   _source: 'REQ',
//   _incomplete?: true
// }

const strOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};

// NEQ normalisé = exactement 10 chiffres, sinon null (même règle que transform.js K10).
function neqNormalise(neq) {
  if (!neq) return null;
  const chiffres = String(neq).replace(/\D/g, '');
  return chiffres.length === 10 ? chiffres : null;
}

// « Président | Trésorier » → ['Président', 'Trésorier'] (le parseur a déjà
// converti les <br> en « | »).
function fonctions(v) {
  return strOrNull(v) ? v.split('|').map((s) => s.trim()).filter(Boolean) : [];
}

// Le REQ colle parfois un libellé après la date (« 1986-10-27 Constitution ») :
// on isole la date AAAA-MM-JJ pour un champ propre.
function dateSeule(v) {
  const m = strOrNull(v) && v.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : strOrNull(v);
}

export function transformReq(raw = {}) {
  const imm = raw.immatriculation || {};
  const forme = raw.formeJuridique || {};
  const maj = raw.datesMAJ || {};
  const sect = raw.secteur1 || {};
  const sal = raw.salaries || {};

  const administrateurs = (raw.administrateurs || []).map((a) => ({
    nom: strOrNull(a['Nom de famille'] || a['Nom']),
    prenom: strOrNull(a['Prénom']),
    dateDebut: strOrNull(a['Date du début de la charge']),
    fonctions: fonctions(a['Fonctions actuelles']),
    adresse: strOrNull(a['Adresse professionnelle'] || a['Adresse du domicile']),
  }));

  const dirigeants = (raw.dirigeants || []).map((d) => ({
    nom: strOrNull(d['Nom de famille'] || d['Nom']),
    prenom: strOrNull(d['Prénom']),
    fonctions: fonctions(d['Fonctions actuelles']),
  }));

  const actionnaires = (raw.actionnaires || []).map((a) => ({
    nom: strOrNull(a['Nom']),
    adresse: strOrNull(a['Adresse du domicile'] || a['Adresse']),
    mention: strOrNull(a['Premier actionnaire']),
  }));

  const beneficiairesUltimes = (raw.beneficiairesUltimes || []).map((b) => ({
    nom: strOrNull(b['Nom de famille'] || b['Nom']),
    prenom: strOrNull(b['Prénom']),
    dateDebut: strOrNull(b['Date du début du statut']),
    situations: strOrNull(b['Situations applicables au bénéficiaire ultime']),
  }));

  const fondeDePouvoir = (raw.fondeDePouvoir || []).map((f) => ({
    nom: strOrNull(f['Nom de famille'] || f['Nom']),
    prenom: strOrNull(f['Prénom']),
  }));

  const section = {
    neq: neqNormalise(raw.neq),
    raisonSociale: strOrNull(raw.nom),
    autresNoms: (raw.autresNoms || []).map(strOrNull).filter(Boolean),
    adresseDomicile: strOrNull(raw.adresseDomicile),

    formeJuridique: strOrNull(forme['Forme juridique']),
    regimeCourant: strOrNull(forme['Régime courant']),
    dateConstitution: dateSeule(forme['Date de la constitution']),

    fusions: (raw.fusions || []).map((f) => ({
      type: strOrNull(f.cellules?.[0]),
      loi: strOrNull(f.cellules?.[1]),
      date: strOrNull(f.cellules?.[2]),
      nomDomicile: strOrNull(f.cellules?.[3]),
      composante: strOrNull(f.cellules?.[4]),
      resultante: strOrNull(f.cellules?.[5]),
    })),

    statutImmatriculation: strOrNull(imm['Statut']),
    dateImmatriculation: strOrNull(imm["Date d'immatriculation"]),
    dateMiseAJourStatut: strOrNull(imm['Date de mise à jour du statut']),
    dateMiseAJourEtat: strOrNull(maj["Date de mise à jour de l'état de renseignements"]),
    dateDerniereDeclaration: strOrNull(maj['Date de la dernière déclaration de mise à jour annuelle']),

    activiteEconomique: {
      cae: strOrNull(sect["Code d'activité économique (CAE)"]),
      activite: strOrNull(sect['Activité']),
      precisions: strOrNull(sect['Précisions (facultatives)']),
    },
    nombreSalaries: strOrNull(sal['Nombre de salariés au Québec']),

    actionnaires,
    administrateurs,
    dirigeants,
    beneficiairesUltimes,
    fondeDePouvoir,

    dateRenseignements: strOrNull(raw.dateRenseignements),
    _source: 'REQ',
  };

  // Rien d'exploitable (stub, fiche vide, ou page anti-bot Cloudflare captée par
  // erreur) → on le rend visible plutôt que de simuler une collecte réussie.
  const aDuContenu = section.raisonSociale
    || section.formeJuridique
    || administrateurs.length
    || actionnaires.length;
  if (raw._stub || !aDuContenu) section._incomplete = true;

  return section;
}

// Mappe l'objet REQ riche vers les CHAMPS CANONIQUES du document `residences`
// (project_canonical_fields.md:382-417). C'est ce payload — et lui seul — qui
// sera écrit en base (barrière 4, après signature PO). Aucun champ inventé :
// chaque clé racine ci-dessous figure au canonique.
//
// ⚠️ À CONFIRMER avant écriture (sous-shapes des tableaux, non figés au canonique) :
//   - éléments de `administrateursREQ` : quelles clés exactes le front lit-il ?
//     (identitySections.ts ~L.130-139) — ici {nom, prenom, fonction, dateDebut}.
//   - éléments de `legal.actionnaires` (identitySections.ts ~L.148-157).
//   - éléments de `historiqueFusionREQ`.
// Ne pas écrire ces tableaux tant que leurs clés ne sont pas confirmées.
export function toResidenceCanonical(section) {
  const administrateursREQ = (section.administrateurs || []).map((a) => ({
    nom: a.prenom ? `${a.prenom} ${a.nom}`.trim() : a.nom,
    fonction: (a.fonctions || []).join(', ') || null,
    dateDebut: a.dateDebut || null,
  }));

  // historiqueFusionREQ : le front sérialise l'array via String().join(', ') —
  // donc chaque élément DOIT être une chaîne lisible (sinon « [object Object] »).
  const historiqueFusionREQ = (section.fusions || []).map((f) => {
    const tete = [f.type, f.date].filter(Boolean).join(' — ');
    const flux = f.composante && f.resultante ? `${f.composante} → ${f.resultante}` : '';
    return [tete, flux].filter(Boolean).join(' — ');
  });

  // legal.actionnaires : le front lit `nom` (affiché) et `pourcentage` (absent au
  // REQ, qui ne donne qu'un qualitatif « majoritaire »). On garde `nom` + `mention`
  // (conservée au dossier, non affichée aujourd'hui) ; on n'INVENTE pas de %.
  const actionnaires = (section.actionnaires || []).map((a) => ({
    nom: a.nom, mention: a.mention,
  }));

  return {
    // scalaires — noms canoniques confirmés, prêts à écrire
    raisonSociale: section.raisonSociale,
    formeJuridique: section.formeJuridique,
    neq: section.neq,
    dateConstitution: section.dateConstitution,
    trancheSalariesREQ: section.nombreSalaries,

    historiqueFusionREQ,                          // array de chaînes lisibles
    administrateursREQ,                           // {nom, fonction, dateDebut}
    structureJuridique: { administrateursREQ },   // miroir attendu par le front
    legal: { actionnaires },                      // {nom, mention}
  };
}
