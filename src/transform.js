// Transformation : structure brute (extract.js) → JSON de sortie final,
// organisé par section (miroir de la fiche K10), conforme à l'oracle
// output/sample/murray-395.json.

import { detailUrl } from './fetch.js';

// « Oui » → true, « Non » → false, sinon null.
function bool(v) {
  if (v == null) return null;
  const t = String(v).trim().toLowerCase();
  if (t === 'oui') return true;
  if (t === 'non') return false;
  return null;
}

function intOrNull(v) {
  if (v == null || v === '') return null;
  const m = String(v).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function strOrNull(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

// Sépare un ÉSSS « 05 - CIUSSS de l'Estrie – CHUS » en code + nom.
function splitEsss(esss) {
  if (!esss) return { esssCode: null, esssNom: null };
  const m = esss.match(/^\s*(\d+)\s*-\s*(.+)$/);
  if (m) return { esssCode: m[1], esssNom: m[2].trim() };
  return { esssCode: null, esssNom: null };
}

export function transform(raw) {
  const h = raw.header;
  const s1 = raw.section1;
  const s2 = raw.section2;
  const s3 = raw.section3;
  const s6 = raw.section6;
  const s7 = raw.section7;
  const s8 = raw.section8;
  const s9 = raw.section9;

  const { esssCode, esssNom } = splitEsss(s1.esss);

  // neqNormalise : exactement 10 chiffres (NEQ québécois) ou null + _neqARevoir.
  // Règle stricte : on ne fabrique pas un identifiant qui a l'air valide.
  // Ce champ servira de clé de jointure REQ — tolérance zéro sur la longueur.
  const neqBrut = strOrNull(s2.personneMorale.neq);
  const neqChiffres = neqBrut ? neqBrut.replace(/\D/g, '') : '';
  const neqNormalise = neqChiffres.length === 10 ? neqChiffres : null;
  const neqARevoir = neqChiffres.length !== 10 && neqBrut !== null ? neqBrut : undefined;

  // categorieRPA : protection de la sémantique 1-4 (Charte IV).
  // intOrNull extrait le chiffre brut ; on valide la plage avant d'écrire.
  const catRaw = intOrNull(s1.categorieRPA);
  const CATS_VALIDES = [1, 2, 3, 4];
  const categorieRPA = CATS_VALIDES.includes(catRaw) ? catRaw : null;
  const categorieARevoir = catRaw !== null && !CATS_VALIDES.includes(catRaw)
    ? strOrNull(s1.categorieRPA) : undefined;

  return {
    noForm: strOrNull(raw.noForm),
    numeroInterne: strOrNull(h.numeroInterne),
    numeroRegistre: strOrNull(h.numeroRegistre),
    residencesLiees: h.residencesLiees || [],
    statut: strOrNull(h.statut),
    detailUrl: detailUrl(raw.noForm),

    section1_identification: {
      nomResidence: strOrNull(s1.nomResidence),
      adresse: strOrNull(s1.adresse),
      codePostal: strOrNull(s1.codePostal),
      esss: strOrNull(s1.esss),
      esssCode,
      esssNom,
      municipalite: strOrNull(s1.municipalite),
      territoireCLSC: strOrNull(s1.territoireCLSC),
      territoireRLS: strOrNull(s1.territoireRLS),
      territoireMRC: strOrNull(s1.territoireMRC),
      courriels: s1.courriels || [],
      telephone: strOrNull(s1.telephone),
      telecopieur: strOrNull(s1.telecopieur),
      dateOuverture: strOrNull(s1.dateOuverture),
      typeResidence: strOrNull(s1.typeResidence),
      categorieRPA,
      ...(categorieARevoir !== undefined ? { _categorieARevoir: categorieARevoir } : {}),
      nombreTotalUnitesImmeubles: intOrNull(s1.nombreTotalUnitesImmeubles),
      appartenanceGroupeReseau: strOrNull(s1.appartenanceGroupeReseau),
      immeublesAssocies: s1.immeublesAssocies || [],
    },

    section2_titulaires: {
      personneMorale: {
        nomCompagnie: strOrNull(s2.personneMorale.nomCompagnie),
        neq: neqBrut,
        neqNormalise,
        ...(neqARevoir !== undefined ? { _neqARevoir: neqARevoir } : {}),
        datePrisePossession: strOrNull(s2.personneMorale.datePrisePossession),
      },
      actionnaires: (s2.actionnaires || []).map((a) => ({
        nom: strOrNull(a.nom),
        prenom: strOrNull(a.prenom),
        mention: strOrNull(a.mention),
      })),
    },

    section3_autresRPA: {
      proprietaireAutresRPA: bool(s3.proprietaireAutresRPA),
      nombreAutresResidences: intOrNull(s3.nombreAutresResidences),
      liste: s3.liste || [],
    },

    section4_personneResponsable: (raw.section4 || []).map((p) => ({
      nom: strOrNull(p.nom),
      prenom: strOrNull(p.prenom),
    })),

    section5_administrateurs: (raw.section5 || []).map((a) => ({
      nom: strOrNull(a.nom),
      prenom: strOrNull(a.prenom),
      occupation: strOrNull(a.occupation),
      fonction: strOrNull(a.fonction),
    })),

    section6_portraits: {
      capaciteTotaleImmeubles: intOrNull(s6.capaciteTotaleImmeubles),
      capaciteRPA: intOrNull(s6.capaciteRPA),
      repartitionAges: {
        moins65: intOrNull(s6.repartitionAges.moins65),
        de65a74: intOrNull(s6.repartitionAges.de65a74),
        de75a84: intOrNull(s6.repartitionAges.de75a84),
        de85plus: intOrNull(s6.repartitionAges.de85plus),
        totalResidents: intOrNull(s6.repartitionAges.totalResidents),
      },
      unitesParMission: mapMissions(s6.unitesParMission),
      totalUnitesLocatives: intOrNull(s6.totalUnitesLocatives),
      entente108: bool(s6.entente108),
      employes: s6.employes,
      personnelAssistance: s6.personnelAssistance,
      personnelInfirmier: (s6.personnelInfirmier || []).map((p) => ({
        type: p.type,
        semaine: p.semaine,
        finDeSemaine: p.finDeSemaine,
        precisions: strOrNull(p.precisions),
      })),
    },

    section7_services: {
      securite: {
        typeAppelAide: strOrNull(s7.securite.typeAppelAide),
        clienteleErrance: bool(s7.securite.clienteleErrance),
        dispositifSecuriteSortie: bool(s7.securite.dispositifSecuriteSortie),
      },
      loisirs: bool(s7.loisirs),
      repas: bool(s7.repas),
      aideDomestique: bool(s7.aideDomestique),
      assistancePersonnelle: bool(s7.assistancePersonnelle),
      soinsInfirmiers: bool(s7.soinsInfirmiers),
    },

    section8_reconnaissance: {
      membreAssociation: bool(s8.membreAssociation),
      associations: s8.associations || [],
      permisMAPAQ: bool(s8.permisMAPAQ),
      permisRBQ: bool(s8.permisRBQ),
    },

    section9_immeuble: {
      typeConstruction: strOrNull(s9.typeConstruction),
      sousSol: {
        present: bool(s9.sousSol.present),
        porteExterieure: bool(s9.sousSol.porteExterieure),
        residentsHeberges: bool(s9.sousSol.residentsHeberges),
        nombreEtagesHorsSousSol: intOrNull(s9.sousSol.nombreEtagesHorsSousSol),
      },
      rampeAcces: bool(s9.rampeAcces),
      nombreAscenseurs: intOrNull(s9.nombreAscenseurs),
      mitigeurEauChaude: bool(s9.mitigeurEauChaude),
      equipementsDetectionAlarme: s9.equipementsDetectionAlarme || [],
      systemeGicleurs: strOrNull(s9.systemeGicleurs),
      sourceEauPotable: strOrNull(s9.sourceEauPotable),
      generatrice: bool(s9.generatrice),
      climatisation: {
        ensembleImmeubles: bool(s9.climatisation.ensembleImmeubles),
        lieuxCommuns: bool(s9.climatisation.lieuxCommuns),
        chambresLogements: bool(s9.climatisation.chambresLogements),
        controleIndependant: bool(s9.climatisation.controleIndependant),
      },
    },
  };
}

function mapMissions(um) {
  const m = (x) => ({
    chambresSimples: intOrNull(x.chambresSimples),
    chambresDoubles: intOrNull(x.chambresDoubles),
    logements: intOrNull(x.logements),
    total: intOrNull(x.total),
    clientelePersonnesAgees: x.clientelePersonnesAgees == null ? null : String(x.clientelePersonnesAgees),
  });
  return {
    rpa: m(um.rpa),
    ri: m(um.ri),
    rtf: m(um.rtf),
    chsld: m(um.chsld),
    autres: m(um.autres),
  };
}
