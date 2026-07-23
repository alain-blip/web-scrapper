// Parseur HTML → structure brute de la fiche « État des renseignements » (REQ).
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  STUB — À REMPLIR SUR FIXTURE RÉELLE.                                     │
// │  Les sélecteurs ci-dessous sont des HYPOTHÈSES, pas des faits. Ils DOIVENT│
// │  être remplacés une fois `fixtures/req-<neq>.html` disponible, en lisant  │
// │  le vrai balisage — comme extract.js (K10) a été calé sur murray-395.html.│
// │  En l'état, extractReq() renvoie une structure de forme correcte mais aux │
// │  valeurs nulles : il NE prétend PAS extraire quoi que ce soit.            │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Méthode visée (même esprit que le K10) :
//   - LV  : label « Nom » / « Forme juridique » / « Statut » → valeur adjacente.
//   - TBL : tableaux « Administrateurs », « Actionnaires », « Dirigeants ».
// Le REQ « État des renseignements » présente typiquement, par section :
//   Identification (NEQ, nom, autres noms), Forme juridique, Statut
//   d'immatriculation + dates, Adresse du domicile/siège, Administrateurs,
//   Dirigeants, Actionnaires, Fondé de pouvoir, Activités économiques.

import { load } from 'cheerio';

// Renvoie la structure brute (avant normalisation par transformReq).
// @param {string} html   HTML de la page AfficherNeq
// @param {{neq?: string}} [meta]
export function extractReq(html, meta = {}) {
  const $ = load(html);

  // TODO(fixture) : remplacer chaque sélecteur par le vrai, mesuré sur le HTML.
  // Les helpers restent volontairement défensifs (jamais de throw) pour que la
  // couche de collecte journalise un `_incomplete` plutôt que de planter.
  const raw = {
    neq: meta.neq ?? null,

    identification: {
      nom: txt($, /* SEL */ null),               // raison sociale (nom légal)
      autresNoms: rows($, /* SEL */ null),        // noms/marques au Québec
    },
    formeJuridique: txt($, /* SEL */ null),
    statut: {
      immatriculation: txt($, /* SEL */ null),    // « Immatriculée » / « Radiée »…
      dateImmatriculation: txt($, /* SEL */ null),
      dateMiseAJour: txt($, /* SEL */ null),
    },
    adresseSiege: txt($, /* SEL */ null),

    administrateurs: rows($, /* SEL */ null),     // → [{ cellules:[…] }]
    dirigeants: rows($, /* SEL */ null),
    actionnaires: rows($, /* SEL */ null),
    fondeDePouvoir: rows($, /* SEL */ null),

    activitesEconomiques: rows($, /* SEL */ null),

    // Marqueur explicite tant que le parseur n'est pas calé sur une fixture :
    // transformReq / collectReq s'en servent pour poser _incomplete=true.
    _stub: true,
  };

  return raw;
}

// --- helpers (identiques en esprit à extract.js) -------------------------------

// Texte d'un sélecteur, trimé, ou null. `sel === null` → null (stub non câblé).
function txt($, sel) {
  if (!sel) return null;
  const el = $(sel).first();
  if (!el.length) return null;
  const v = el.text().replace(/\s+/g, ' ').trim();
  return v || null;
}

// Lignes d'un tableau → [{ cellules: [...] }], ou [] (stub non câblé).
function rows($, sel) {
  if (!sel) return [];
  const out = [];
  $(sel).find('tr').each((_, tr) => {
    const cellules = $(tr)
      .find('td,th')
      .map((__, td) => $(td).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean);
    if (cellules.length) out.push({ cellules });
  });
  return out;
}
