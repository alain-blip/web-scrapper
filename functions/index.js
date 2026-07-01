// Fonction planifiée de collecte du registre MSSS → Firestore.
// Projet : primexpert-msss-registre · Région : northamerica-northeast1.
//
// Déclenchement : 1×/jour à 03:00 America/Montreal. Le jour du mois détermine
// la (les) région(s) à collecter (voir collector/regions.js). Jours 19–31 :
// aucune collecte. Montréal (jour 6) et Montérégie (jour 16) sont éclatés.
//
// Le parseur validé (extract/transform) est embarqué tel quel sous lib/scraper/
// par functions/copy-scraper.mjs (lancé en predeploy). Il N'est PAS réécrit.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as fnLogger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { collectRegion } from './lib/scraper/collector/collectRegion.js';
import {
  regionsPourJour, jourDuMoisMontreal, dateMontreal, LIBELLES,
} from './lib/scraper/collector/regions.js';

initializeApp();
const db = getFirestore();

// Remplace récursivement toute valeur undefined par null et collecte les
// chemins concernés dans `manquants`. Prévient le rejet Firestore (qui refuse
// undefined) et rend la perte visible plutôt que destructrice (F15).
function sanitizeFirestore(obj, prefix, manquants) {
  if (obj === undefined) { manquants.push(prefix); return null; }
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((v, i) => sanitizeFirestore(v, `${prefix}[${i}]`, manquants));
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = sanitizeFirestore(v, prefix ? `${prefix}.${k}` : k, manquants);
  }
  return out;
}

export const collecteQuotidienne = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'America/Montreal',
    region: 'northamerica-northeast1',
    timeoutSeconds: 1800,   // 30 min : maximum autorisé pour onSchedule.
                            // Si une grosse région déborde : écriture incrémentale
                            // déjà persistée + statut "partiel" (on découpera plus
                            // tard si la mesure le montre nécessaire).
    memory: '1GiB',
    retryCount: 0,          // idempotent (merge par noForm) ; pas de double run
  },
  async () => {
    // F10 : au démarrage, clôturer tout _collectionLog resté 'en_cours' depuis
    // plus de 3h (symptôme d'un timeout 1800s non terminé proprement).
    // S'applique à TOUT document 'en_cours', y compris les logs de test (préfixe
    // TEST_) — aucun filtre par préfixe dans la requête ; comportement voulu et
    // bénin (un test resté bloqué >3h doit lui aussi être clôturé).
    const SEUIL_INTERRUPTION_MS = 3 * 60 * 60 * 1000;
    const maintenant = Date.now();
    const orphelins = await db.collection('_collectionLog')
      .where('statut', '==', 'en_cours').get();
    const clotureOrphelins = orphelins.docs
      .filter((doc) => {
        const majMs = doc.data().maj?.toMillis?.() ?? 0;
        return maintenant - majMs > SEUIL_INTERRUPTION_MS;
      })
      .map((doc) => doc.ref.set({
        statut: 'interrompu',
        enCours: FieldValue.delete(),
        clotureLe: FieldValue.serverTimestamp(),
      }, { merge: true }));
    if (clotureOrphelins.length) await Promise.all(clotureOrphelins);

    const jour = jourDuMoisMontreal();
    const date = dateMontreal();
    const codes = regionsPourJour(jour);
    const logRef = db.collection('_collectionLog')
      .doc(`${date}_j${String(jour).padStart(2, '0')}`);

    // Hors calendrier (jours 19–31) : on journalise et on s'arrête.
    if (!codes.length) {
      await logRef.set({
        date, jourDuMois: jour, regions: [], statut: 'hors_calendrier',
        message: 'Aucune collecte ce jour (les 18 régions sont déjà passées).',
        maj: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const debut = Date.now();
    await logRef.set({
      date, jourDuMois: jour, regions: codes, statut: 'en_cours',
      maj: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Écriture incrémentale d'une fiche (merge par noForm → idempotent).
    // sanitizeFirestore : tout undefined → null ; si champs manquants détectés,
    // _incomplete=true + _champsManquants[] rendent la lacune visible (F15).
    const writeFiche = async (fiche, meta) => {
      const manquants = [];
      const ficheClean = sanitizeFirestore(fiche, '', manquants);
      const flagsIncomplete = manquants.length > 0
        ? { _incomplete: true, _champsManquants: manquants } : {};
      await db.collection('residences').doc(String(fiche.noForm)).set({
        ...ficheClean,
        ...flagsIncomplete,
        _regionCdRSS: meta.cdRSS,
        _collecteLe: FieldValue.serverTimestamp(),
      }, { merge: true });
    };

    const parRegion = [];
    let totVues = 0, totEcrites = 0, totErreurs = 0, totSkips = 0, bloque = false, suspect = false;

    for (const cd of codes) {
      let s;
      try {
        s = await collectRegion(cd, {
          writeFiche,
          throttleMs: 1500,
          onProgress: async (p) => {
            // progression visible même si la fonction est coupée
            await logRef.set({
              enCours: { cdRSS: cd, ecrites: p.nbEcrites, vues: p.nbVues },
              maj: FieldValue.serverTimestamp(),
            }, { merge: true });
          },
          logger: (m) => fnLogger.info(m),
        });
      } catch (e) {
        s = {
          cdRSS: cd, statut: 'erreur', nbListe: 0, nbVues: 0, nbEcrites: 0,
          nbErreurs: 1, skips: [], bloque: false, dureeMs: 0,
        };
        await logRef.set({
          erreursRegion: FieldValue.arrayUnion({ cdRSS: cd, msg: e.message }),
        }, { merge: true });
      }

      parRegion.push({
        cdRSS: cd, libelle: LIBELLES[cd] || null, statut: s.statut,
        nbListe: s.nbListe, nbVues: s.nbVues, nbEcrites: s.nbEcrites,
        nbErreurs: s.nbErreurs, nbSkips: (s.skips || []).length,
        skipsNoForm: (s.skips || []).slice(0, 200), // cap 200 : F7, survit à la requête
        htmlExcerpt: s.htmlExcerpt || null, // F9 : preuve du blocage, survit à la requête
        bloque: s.bloque, dureeMs: s.dureeMs,
      });
      totVues += s.nbVues; totEcrites += s.nbEcrites;
      totErreurs += s.nbErreurs; totSkips += (s.skips || []).length;
      bloque = bloque || s.bloque;
      suspect = suspect || s.statut === 'suspect';
    }

    const statut = bloque ? 'partiel'
      : suspect ? 'suspect'
      : (totErreurs > 0 ? 'ok_avec_erreurs' : 'ok');
    await logRef.set({
      date, jourDuMois: jour, regions: codes, parRegion,
      nbFichesVues: totVues, nbEcrites: totEcrites,
      nbErreurs: totErreurs, nbSkips: totSkips,
      bloque, statut, dureeMs: Date.now() - debut,
      enCours: FieldValue.delete(),
      maj: FieldValue.serverTimestamp(),
    }, { merge: true });
  },
);

// ===========================================================================
// ⚠️  OUTIL DE TEST TEMPORAIRE — À RETIRER APRÈS VALIDATION (voir DEPLOY.md §7)
// ---------------------------------------------------------------------------
// Déclencheur HTTP manuel pour tester la chaîne complète (collecte → écriture
// Firestore → _collectionLog) À LA DEMANDE, sans attendre le bon jour du
// calendrier. Mêmes garde-fous que la fonction planifiée (throttle 1,5 s,
// détection soft-block + back-off, écriture incrémentale, journal).
// Protégé par un jeton (COLLECTE_TEST_TOKEN). --limit bas par défaut (doux).
// ===========================================================================
const TEST_TOKEN = defineSecret('COLLECTE_TEST_TOKEN');

export const collecteTest = onRequest(
  { region: 'northamerica-northeast1', timeoutSeconds: 540, memory: '512MiB', secrets: ['COLLECTE_TEST_TOKEN'] },
  async (req, res) => {
    // 1. Protection par jeton (endpoint désactivé si le jeton n'est pas défini)
    const attendu = TEST_TOKEN.value();
    const fourni = req.query.token || req.get('x-token');
    if (!attendu || fourni !== attendu) {
      res.status(403).json({ erreur: 'Jeton invalide, ou test désactivé (COLLECTE_TEST_TOKEN non défini).' });
      return;
    }

    // 2. Paramètres : cdRSS requis, limit bas par défaut + plafonné, throttle ≥ 1 s
    const cdRSS = String(req.query.cdRSS || '').trim();
    if (!/^\d{2}$/.test(cdRSS)) {
      res.status(400).json({ erreur: 'Paramètre cdRSS requis (2 chiffres). Ex. ?cdRSS=05' });
      return;
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 50);      // doux + plafond de sécurité
    const throttleMs = Math.max(parseInt(req.query.throttle, 10) || 1500, 1000);

    const date = dateMontreal();
    const logRef = db.collection('_collectionLog').doc(`TEST_${date}_${cdRSS}_${Date.now()}`);
    await logRef.set({
      mode: 'test', date, cdRSS, libelle: LIBELLES[cdRSS] || null, limit, throttleMs,
      statut: 'en_cours', maj: FieldValue.serverTimestamp(),
    }, { merge: true });

    const writeFiche = async (fiche, meta) => {
      const manquants = [];
      const ficheClean = sanitizeFirestore(fiche, '', manquants);
      const flagsIncomplete = manquants.length > 0
        ? { _incomplete: true, _champsManquants: manquants } : {};
      await db.collection('residences').doc(String(fiche.noForm)).set({
        ...ficheClean, ...flagsIncomplete,
        _regionCdRSS: meta.cdRSS, _collecteLe: FieldValue.serverTimestamp(),
      }, { merge: true });
    };

    // 3. Collecte (mêmes garde-fous, via le même collectRegion que la planifiée)
    let stats;
    try {
      stats = await collectRegion(cdRSS, {
        writeFiche,
        throttleMs,
        maxFiches: limit,
        onProgress: async (p) => {
          await logRef.set({ enCours: { ecrites: p.nbEcrites, vues: p.nbVues }, maj: FieldValue.serverTimestamp() }, { merge: true });
        },
        logger: (m) => fnLogger.info(m),
      });
    } catch (e) {
      await logRef.set({ statut: 'erreur', message: e.message, enCours: FieldValue.delete(), maj: FieldValue.serverTimestamp() }, { merge: true });
      res.status(500).json({ erreur: e.message });
      return;
    }

    await logRef.set({
      mode: 'test', date, cdRSS, libelle: LIBELLES[cdRSS] || null, limit, throttleMs,
      nbListe: stats.nbListe, nbVues: stats.nbVues, nbEcrites: stats.nbEcrites,
      nbErreurs: stats.nbErreurs, nbSkips: stats.skips.length,
      skipsNoForm: stats.skips.slice(0, 200), // cap 200 : F7, survit à la requête
      htmlExcerpt: stats.htmlExcerpt || null, // F9 : preuve du blocage, survit à la requête
      bloque: stats.bloque,
      statut: stats.statut, dureeMs: stats.dureeMs,
      enCours: FieldValue.delete(), maj: FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).json({
      ok: true, cdRSS, libelle: LIBELLES[cdRSS] || null, limit,
      nbListe: stats.nbListe, nbVues: stats.nbVues, nbEcrites: stats.nbEcrites,
      nbErreurs: stats.nbErreurs, nbSkips: stats.skips.length,
      bloque: stats.bloque, statut: stats.statut, dureeMs: stats.dureeMs,
    });
  },
);
