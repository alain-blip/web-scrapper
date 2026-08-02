// Backend de lecture pour l'appli de consultation — étape 1 (fondation) +
// étape 2 (mur d'accès).
//
// READ-ONLY STRICT sur les fiches : ce fichier ne contient et ne doit jamais
// contenir aucun appel .set()/.update()/.add()/.delete() sur residences/ ou
// _accesAutorises/. Seules opérations : lire (.get()/.where()) et vérifier un
// ID token (verifyIdToken, lecture seule côté Firebase Auth). Fait auditable
// en grep, pas une promesse.
//
// Séparé de collecteQuotidienne/collecteTest (functions/index.js) : ce fichier
// n'importe rien du collecteur (Règle #0 — on étend le projet existant, on ne
// touche pas au code de collecte).
//
// Mur d'accès (couche 2, l'admin SDK contourne nativement les règles
// Firestore côté serveur — voir firestore.rules pour la couche 1) :
// défaut = refus. Toute condition non explicitement satisfaite → refus.
//   1. Pas de token Authorization: Bearer → 401.
//   2. Token invalide/expiré (verifyIdToken échoue) → 401.
//   3. Token valide mais email absent de _accesAutorises ou actif !== true → 403.
//   4. Token valide ET email autorisé actif → sert la donnée.
//
// Pas encore déployé publiquement. Preuve locale via l'émulateur Firebase
// Functions + Auth (voir DEPLOY.md).

import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Vérifie le token Bearer et l'appartenance à la liste blanche. Ne sert
// jamais la donnée elle-même — renvoie seulement une décision (ok/code/erreur).
async function verifierAcces(req) {
  const authHeader = req.get('Authorization') || '';
  const m = authHeader.match(/^Bearer (.+)$/);
  if (!m) return { ok: false, code: 401, erreur: 'Token manquant (en-tête Authorization: Bearer requis).' };

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(m[1]);
  } catch (e) {
    return { ok: false, code: 401, erreur: 'Token invalide ou expiré.' };
  }

  const email = decoded.email;
  if (!email) return { ok: false, code: 401, erreur: 'Token sans adresse courriel.' };

  const db = getFirestore();
  const entree = await db.collection('_accesAutorises').doc(email.toLowerCase()).get();
  if (!entree.exists || entree.data()?.actif !== true) {
    return { ok: false, code: 403, erreur: 'Accès refusé — adresse non autorisée.' };
  }

  return { ok: true, email };
}

// Champs résumé pour le mode liste — suffisants pour filtrer/afficher une
// ligne (mêmes champs que les filtres déjà utilisés dans app-consultation/app.js).
function resume(fiche) {
  const s1 = fiche.section1_identification || {};
  return {
    noForm: fiche.noForm,
    nomResidence: s1.nomResidence ?? null,
    municipalite: s1.municipalite ?? null,
    categorieRPA: s1.categorieRPA ?? null,
    nombreTotalUnitesImmeubles: s1.nombreTotalUnitesImmeubles ?? null,
    esss: s1.esss ?? null,
    statut: fiche.statut ?? null,
    _collecteLe: fiche._collecteLe ?? null,
  };
}

// --- Vue « Sourcing REQ & Contacts » : amalgame K10 + enrichissement REQ. ---
// Classification du courriel identique à src/local/server.ts (dupliquée ici à
// dessein : ce fichier n'importe rien du collecteur, cf. en-tête).
const PREFIXE_GENERIQUE = /^(info|admin|administration|reception|réception|contact|direction|bureau|rpa|residence|résidence|accueil|comptabilite|comptabilité|location|secretariat|secrétariat|service|dg)s?[0-9._-]*@/i;
const sansAccents = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function classifierCourriel(mail, admins) {
  if (!mail) return 'AUCUN';
  if (PREFIXE_GENERIQUE.test(mail)) return 'GENERALE';
  const local = sansAccents(mail.split('@')[0]);
  const match = (admins || []).some((a) => {
    const nom = sansAccents(a.nom), pre = sansAccents(a.prenom);
    return (nom.length > 2 && local.includes(nom)) || (pre.length > 2 && local.includes(pre));
  });
  return match ? 'DECIDEUR' : 'PERSO';
}

// Résumé enrichi : coordonnées K10 (section1) + dirigeants/adresses REQ
// (enrichissement.sourcingInverse). Full parity avec la console locale.
function resumeSourcing(fiche) {
  const s1 = fiche.section1_identification || {};
  const p6 = fiche.section6_portraits || {};
  const si = fiche.enrichissement?.sourcingInverse || {};
  const admins = Array.isArray(si.administrateurs) ? si.administrateurs : [];
  const courriels = Array.isArray(s1.courriels) ? s1.courriels : [];
  const courriel = courriels[0] ?? null;
  return {
    noForm: fiche.noForm,
    nom: s1.nomResidence ?? null,
    esss: s1.esssNom ?? s1.esss ?? null,
    cdRSS: fiche._regionCdRSS ?? null,
    categorieRPA: s1.categorieRPA ?? null,
    capacite: p6.capaciteRPA ?? null,
    neq: fiche.section2_titulaires?.personneMorale?.neqNormalise ?? null,
    telephone: s1.telephone ?? null,
    telecopieur: s1.telecopieur ?? null,
    courriel,
    courriels,
    courrielQualite: classifierCourriel(courriel, admins),
    sourcingStatus: si.status ?? 'NON_TRAITE',
    administrateurs: admins,
    erreurREQ: si.erreur ?? null,
  };
}

const MAX_LIMIT = 500; // plafond de sécurité ; la plus grosse région mesurée à ce jour (03) fait 166 écrites / 388 vues

export const consultationApi = onRequest(
  // cors:true : nécessaire pour que le navigateur (origine différente de
  // l'émulateur/de la fonction) accepte de lire la réponse. Ça ne change rien
  // à la sécurité réelle — le mur (token + liste blanche) reste l'unique
  // barrière qui décide si la donnée sort ; CORS ne fait que permettre au
  // navigateur de LIRE une réponse déjà autorisée ou déjà refusée.
  { region: 'northamerica-northeast1', memory: '256MiB', cors: true },
  async (req, res) => {
    // Mur d'accès en premier, avant toute lecture de donnée — aucun chemin
    // ne sert quoi que ce soit avant une décision explicite d'autorisation.
    const acces = await verifierAcces(req);
    if (!acces.ok) {
      res.status(acces.code).json({ erreur: acces.erreur });
      return;
    }

    const db = getFirestore();

    // Mode changements : ?vue=changements → un doc _changements (diff mensuel).
    //   - sans ?date : le plus récent des changements_AAAA-MM-JJ (tri id desc =
    //     chronologique) ; le doc de test changements_TEST est ignoré ici.
    //   - avec ?date=AAAA-MM-JJ ou ?date=TEST : lit ce doc précis.
    // L'objet _changements ne contient que des noForm + champs K10 publics
    // (aucun nominatif sensible) → renvoyé tel quel, enrichi du nom de résidence
    // pour chaque noForm listé (sinon l'écran n'affiche que des numéros).
    if (String(req.query.vue || '') === 'changements') {
      const date = req.query.date ? String(req.query.date) : null;

      let docChg;
      if (date) {
        docChg = await db.collection('_changements').doc(`changements_${date}`).get();
        if (!docChg.exists) {
          res.status(404).json({ erreur: `Aucun changements_${date}.` });
          return;
        }
      } else {
        // Plus récent parmi les seuls ids datés (exclut changements_TEST).
        const tous = (await db.collection('_changements').get()).docs
          .filter((d) => /^changements_\d{4}-\d{2}-\d{2}$/.test(d.id))
          .sort((a, b) => (a.id < b.id ? 1 : -1));
        if (!tous.length) {
          res.status(404).json({ erreur: 'Aucun diff de changements disponible pour l’instant.' });
          return;
        }
        docChg = tous[0];
      }

      const chg = docChg.data();
      const apparues = Array.isArray(chg.apparues) ? chg.apparues : [];
      const disparues = Array.isArray(chg.disparues) ? chg.disparues : [];
      const modifiees = Array.isArray(chg.modifiees) ? chg.modifiees : [];

      // Résolution des noms : un seul batch get sur residences pour tous les
      // noForm cités. Un noForm disparu n'existe plus → nom = null (normal).
      const noForms = [...new Set([
        ...apparues.map(String),
        ...disparues.map(String),
        ...modifiees.map((m) => String(m.noForm)),
      ])];
      const nomParNoForm = new Map();
      if (noForms.length) {
        const refs = noForms.map((nf) => db.collection('residences').doc(nf));
        const snaps = await db.getAll(...refs);
        for (const s of snaps) {
          nomParNoForm.set(s.id, s.exists ? (s.data().section1_identification?.nomResidence ?? null) : null);
        }
      }
      const nom = (nf) => nomParNoForm.get(String(nf)) ?? null;

      // Disparues : elles n'existent plus dans residences → nom résolu depuis le
      // snapshot ANCIEN (une seule lecture), qui contient fiches[].nomResidence.
      // Garde-fou : si la rétention a purgé ce snapshot, on ne plante pas — les
      // noms des disparues restent null.
      const nomDisparueParNoForm = new Map();
      if (disparues.length && chg._snapshot_ancien) {
        const snapAncien = await db.collection('_snapshots').doc(String(chg._snapshot_ancien)).get();
        if (snapAncien.exists) {
          for (const f of (snapAncien.data().fiches ?? [])) {
            nomDisparueParNoForm.set(String(f.noForm), f.nomResidence ?? null);
          }
        } else {
          console.warn(`consultationApi/changements : snapshot ancien ${chg._snapshot_ancien} absent (purgé ?) — noms des disparues = null.`);
        }
      }
      const nomDisparue = (nf) => nomDisparueParNoForm.get(String(nf)) ?? null;

      res.status(200).json({
        vue: 'changements',
        id: docChg.id,
        _cree_le: chg._cree_le ?? null,
        _snapshot_ancien: chg._snapshot_ancien ?? null,
        _snapshot_recent: chg._snapshot_recent ?? null,
        apparues: apparues.map((nf) => ({ noForm: String(nf), nom: nom(nf) })),
        disparues: disparues.map((nf) => ({ noForm: String(nf), nom: nomDisparue(nf) })),
        modifiees: modifiees.map((m) => ({ noForm: String(m.noForm), nom: nom(m.noForm), champs: m.champs ?? [] })),
      });
      return;
    }

    // Mode détail : ?noForm=2316 → fiche complète, toutes sections.
    if (req.query.noForm) {
      const noForm = String(req.query.noForm);
      const doc = await db.collection('residences').doc(noForm).get();
      if (!doc.exists) {
        res.status(404).json({ erreur: `Fiche noForm=${noForm} introuvable.` });
        return;
      }
      res.status(200).json(doc.data());
      return;
    }

    // Mode liste : ?cdRSS=03 → fiches résumé de la région.
    const cdRSS = req.query.cdRSS ? String(req.query.cdRSS) : null;
    if (!cdRSS) {
      res.status(400).json({
        erreur: 'Paramètre requis : ?cdRSS=NN (liste résumé) ou ?noForm=N (fiche complète).',
      });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || MAX_LIMIT, MAX_LIMIT);
    const offset = parseInt(req.query.offset, 10) || 0;

    let query = db.collection('residences').where('_regionCdRSS', '==', cdRSS);
    if (offset > 0) query = query.offset(offset);
    query = query.limit(limit);

    const snap = await query.get();
    // ?vue=sourcing → amalgame enrichi (K10 + REQ + contacts) ; sinon résumé K10.
    const vueSourcing = String(req.query.vue || '') === 'sourcing';
    const fiches = snap.docs.map((d) => (vueSourcing ? resumeSourcing(d.data()) : resume(d.data())));

    res.status(200).json({ cdRSS, vue: vueSourcing ? 'sourcing' : 'k10', total: fiches.length, limit, offset, fiches });
  },
);
