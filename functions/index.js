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
    timeoutSeconds: 3600,   // 60 min : marge pour les grosses régions
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
