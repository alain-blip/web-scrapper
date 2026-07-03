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
    const fiches = snap.docs.map((d) => resume(d.data()));

    res.status(200).json({ cdRSS, total: fiches.length, limit, offset, fiches });
  },
);
