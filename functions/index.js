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
import { defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { collectRegion } from './lib/scraper/collector/collectRegion.js';
import {
  regionsPourJour, jourDuMoisMontreal, dateMontreal, LIBELLES,
} from './lib/scraper/collector/regions.js';

initializeApp();
const db = getFirestore();

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
    const writeFiche = async (fiche, meta) => {
      await db.collection('residences').doc(String(fiche.noForm)).set({
        ...fiche,
        _regionCdRSS: meta.cdRSS,
        _collecteLe: FieldValue.serverTimestamp(),
      }, { merge: true });
    };

    const parRegion = [];
    let totVues = 0, totEcrites = 0, totErreurs = 0, totSkips = 0, bloque = false;

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
        bloque: s.bloque, dureeMs: s.dureeMs,
      });
      totVues += s.nbVues; totEcrites += s.nbEcrites;
      totErreurs += s.nbErreurs; totSkips += (s.skips || []).length;
      bloque = bloque || s.bloque;
    }

    const statut = bloque ? 'partiel' : (totErreurs > 0 ? 'ok_avec_erreurs' : 'ok');
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
const TEST_TOKEN = defineString('COLLECTE_TEST_TOKEN'); // défini dans functions/.env

export const collecteTest = onRequest(
  { region: 'northamerica-northeast1', timeoutSeconds: 540, memory: '512MiB' },
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
      await db.collection('residences').doc(String(fiche.noForm)).set({
        ...fiche, _regionCdRSS: meta.cdRSS, _collecteLe: FieldValue.serverTimestamp(),
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
      });
    } catch (e) {
      await logRef.set({ statut: 'erreur', message: e.message, enCours: FieldValue.delete(), maj: FieldValue.serverTimestamp() }, { merge: true });
      res.status(500).json({ erreur: e.message });
      return;
    }

    await logRef.set({
      mode: 'test', date, cdRSS, libelle: LIBELLES[cdRSS] || null, limit, throttleMs,
      nbListe: stats.nbListe, nbVues: stats.nbVues, nbEcrites: stats.nbEcrites,
      nbErreurs: stats.nbErreurs, nbSkips: stats.skips.length, bloque: stats.bloque,
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
