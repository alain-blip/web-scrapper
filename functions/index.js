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

// Backend de lecture pour l'appli de consultation — fichier séparé, lecture
// seule stricte, n'importe rien du collecteur (voir consultationApi.js).
export { consultationApi } from './consultationApi.js';

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
        erreursDetail: (s.erreurs || []).slice(0, 200), // même patron que skipsNoForm
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
// snapshotMensuel — veille des changements structurels du registre.
// ---------------------------------------------------------------------------
// 1×/mois (le 1er à 04:00 Montréal, décalé de collecteQuotidienne à 03:00).
// Assemble la logique DÉJÀ PROUVÉE hors ligne (scripts/snapshot-creer.mjs +
// scripts/snapshot-diff.mjs) : construit un snapshot léger des 7 champs
// surveillés (+ noForm) de `residences`, l'écrit dans `_snapshots`, puis diffe
// contre le snapshot précédent et écrit le résultat dans `_changements`.
//
// SOURCING EXCLU : on ne lit jamais enrichissement.* — uniquement les 7 champs.
// Garde-fous : (c) refuse de snapshoter un cycle incomplet (<22 régions) ;
// (d) ne réécrit pas un snapshot du jour existant ; (e) pas de diff au tout
// premier passage ; (g) rétention : ne conserve que les 2 snapshots les plus
// récents (l'historique des `_changements`, léger, est conservé).
// ===========================================================================

const SNAP_REGIONS_ATTENDUES = 22;
const SNAP_RETENTION = 3;
const SNAP_PLANCHER_PREMIER = 1000; // plancher absolu de fiches au tout premier passage
const SNAP_RATIO_SEUIL = 0.95;      // seuil = 95 % du _nb_fiches du snapshot précédent

// Les 7 champs surveillés pour le diff. kind: 'scalaire' | 'tableau'.
const SNAP_CHAMPS = [
  { cle: 'nomResidence', kind: 'scalaire' },
  { cle: 'categorieRPA', kind: 'scalaire' },
  { cle: 'nombreTotalUnites', kind: 'scalaire' },
  { cle: 'nomCompagnie', kind: 'scalaire' },
  { cle: 'nombreAutresResidences', kind: 'scalaire' },
  { cle: 'personneResponsable', kind: 'tableau' },
  { cle: 'associations', kind: 'tableau' },
];

// Lecture de chemin pointé, sans fabriquer de valeur (undefined si absent).
function snapLire(doc, chemin) {
  let cur = doc;
  for (const k of chemin.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(k in cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

// Normalisation vide-stable de nomCompagnie : undefined/null/"" → null.
function snapNormNomCompagnie(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  return v;
}

// Objet léger normalisé (identique à snapshot-creer.mjs) pour une fiche brute.
function snapFicheLegere(d, docId) {
  const respBrut = snapLire(d, 'section4_personneResponsable');
  const personneResponsable = Array.isArray(respBrut)
    ? respBrut.map((r) => ({ nom: r?.nom ?? null, prenom: r?.prenom ?? null }))
    : [];
  const assocBrut = snapLire(d, 'section8_reconnaissance.associations');
  const associations = Array.isArray(assocBrut) ? assocBrut.slice() : [];
  return {
    noForm: snapLire(d, 'noForm') ?? docId,
    nomResidence: snapLire(d, 'section1_identification.nomResidence') ?? null,
    categorieRPA: snapLire(d, 'section1_identification.categorieRPA') ?? null,
    nombreTotalUnites: snapLire(d, 'section1_identification.nombreTotalUnitesImmeubles') ?? null,
    nomCompagnie: snapNormNomCompagnie(snapLire(d, 'section2_titulaires.personneMorale.nomCompagnie')),
    nombreAutresResidences: snapLire(d, 'section3_autresRPA.nombreAutresResidences') ?? null,
    personneResponsable,
    associations,
  };
}

// Règles de diff (identiques à snapshot-diff.mjs).
const snapEstVide = (v) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function snapCleTableau(arr) {
  if (!Array.isArray(arr)) return '[]';
  return JSON.stringify(
    arr.map((el) => (el && typeof el === 'object' ? `${el.nom ?? ''}|${el.prenom ?? ''}` : String(el)))
       .sort(),
  );
}

// Compare un champ. Renvoie null si pas de changement, sinon {avant, apres}.
function snapComparerChamp(champ, a, b) {
  if (champ.kind === 'tableau') {
    if (snapEstVide(a) && snapEstVide(b)) return null;             // vide→vide
    if (snapCleTableau(a) === snapCleTableau(b)) return null;      // même ensemble (réordre inclus)
    return { avant: a ?? [], apres: b ?? [] };
  }
  const av = snapEstVide(a), bv = snapEstVide(b);
  if (av && bv) return null;                                       // vide→vide
  if (!av && !bv && a === b) return null;                          // identique
  return { avant: a ?? null, apres: b ?? null };                  // vide→contenu | contenu→vide | contenu≠contenu
}

// Diff complet entre deux listes de fiches légères → {apparues, disparues, modifiees}.
function snapDiff(fichesAncien, fichesRecent) {
  const ancien = new Map(fichesAncien.map((f) => [String(f.noForm), f]));
  const recent = new Map(fichesRecent.map((f) => [String(f.noForm), f]));
  const apparues = [];
  const disparues = [];
  const modifiees = [];
  for (const noForm of recent.keys()) if (!ancien.has(noForm)) apparues.push(noForm);
  for (const noForm of ancien.keys()) if (!recent.has(noForm)) disparues.push(noForm);
  for (const [noForm, fA] of ancien) {
    const fB = recent.get(noForm);
    if (!fB) continue;
    const champs = [];
    for (const champ of SNAP_CHAMPS) {
      const d = snapComparerChamp(champ, fA[champ.cle], fB[champ.cle]);
      if (d) champs.push({ champ: champ.cle, avant: d.avant, apres: d.apres });
    }
    if (champs.length) modifiees.push({ noForm, champs });
  }
  apparues.sort(); disparues.sort();
  modifiees.sort((x, y) => (x.noForm < y.noForm ? -1 : 1));
  return { apparues, disparues, modifiees };
}

export const snapshotMensuel = onSchedule(
  {
    schedule: '0 4 1 * *',        // le 1er de chaque mois à 04:00 (décalé de la collecte 03:00)
    timeZone: 'America/Montreal',
    region: 'northamerica-northeast1',
    timeoutSeconds: 540,          // lecture ~1596 fiches + 2 écritures : large
    memory: '512MiB',
    retryCount: 0,                // idempotent (garde du jour) ; pas de double run
  },
  async () => {
    const date = dateMontreal();
    const idSnap = `snapshot_${date}`;

    // a) Full scan residences → fiches légères + régions distinctes.
    const snap = await db.collection('residences').get();
    const fiches = [];
    const regionsSet = new Set();
    for (const doc of snap.docs) {
      const d = doc.data();
      const cd = d._regionCdRSS;
      if (cd !== undefined && cd !== null) regionsSet.add(cd);
      fiches.push(snapFicheLegere(d, doc.id));
    }
    const regionsVues = [...regionsSet].sort();
    const cycleComplet = regionsVues.length === SNAP_REGIONS_ATTENDUES;
    const nbLu = fiches.length;

    // Snapshots déjà en base (lus AVANT toute écriture) — servent au seuil
    // dynamique, à la garde anti-écrasement et au choix du précédent.
    const existants = (await db.collection('_snapshots').get()).docs
      .filter((d) => d.id.startsWith('snapshot_'))
      .sort((a, b) => (a.id < b.id ? 1 : -1)); // date desc (id = snapshot_AAAA-MM-JJ)
    const anterieurs = existants.filter((d) => d.id !== idSnap);
    const dejaAujourdhui = existants.some((d) => d.id === idSnap);
    const reference = anterieurs.length ? (anterieurs[0].data()._nb_fiches ?? null) : null;
    const seuil = reference != null
      ? Math.floor(reference * SNAP_RATIO_SEUIL)
      : SNAP_PLANCHER_PREMIER;

    // c) GARDE : cycle incomplet → on ne snapshote pas (jamais de diff amputé).
    if (!cycleComplet) {
      fnLogger.warn('snapshotMensuel : cycle incomplet, snapshot reporté', {
        regionsVues: regionsVues.length, attendu: SNAP_REGIONS_ATTENDUES, regions: regionsVues,
      });
      return;
    }

    // c-bis) GARDE anti-scan-incomplet : trop peu de fiches lues → on refuse.
    // Attrape un scan cassé même à 22 régions (ex. 1200 fiches au lieu de ~1596).
    // N'écrit NI snapshot NI changements.
    if (nbLu < seuil) {
      fnLogger.error('snapshotMensuel : snapshot avorté : scan incomplet', { nbLu, seuil, reference });
      return;
    }

    // d) GARDE anti-écrasement : snapshot du jour déjà présent → on n'y touche pas.
    const snapRef = db.collection('_snapshots').doc(idSnap);
    if (dejaAujourdhui) {
      fnLogger.info(`snapshotMensuel : ${idSnap} existe déjà, exécution ignorée (pas de réécriture).`);
      return;
    }

    // d) Écriture du snapshot du jour.
    await snapRef.set({
      _cree_le: FieldValue.serverTimestamp(),
      _nb_fiches: fiches.length,
      _cycle_complet: cycleComplet,
      _regions_vues: regionsVues,
      fiches,
    });
    fnLogger.info(`snapshotMensuel : snapshot écrit ${idSnap} (${fiches.length} fiches, ${regionsVues.length} régions).`);

    // e) Le snapshot précédent = le plus récent des snapshots antérieurs.
    if (!anterieurs.length) {
      fnLogger.info('snapshotMensuel : baseline seule, pas de diff possible (premier passage).');
      return; // rien à purger : ≤ 1 snapshot au total
    }
    const precedent = anterieurs[0];

    // e) Diff ancien → récent selon nos règles vide-stable / ensembles.
    const resultat = snapDiff(precedent.data().fiches ?? [], fiches);

    // f) Écriture du résultat dans _changements.
    const idChg = `changements_${date}`;
    await db.collection('_changements').doc(idChg).set({
      _cree_le: FieldValue.serverTimestamp(),
      _snapshot_ancien: precedent.id,
      _snapshot_recent: idSnap,
      apparues: resultat.apparues,
      disparues: resultat.disparues,
      modifiees: resultat.modifiees,
    });
    fnLogger.info(`snapshotMensuel : diff ${precedent.id} → ${idSnap} écrit dans _changements/${idChg} ` +
      `(apparues=${resultat.apparues.length}, disparues=${resultat.disparues.length}, modifiees=${resultat.modifiees.length}).`);

    // g) RÉTENTION : ne conserver que les 2 snapshots les plus récents.
    const apresEcriture = (await db.collection('_snapshots').get()).docs
      .filter((d) => d.id.startsWith('snapshot_'))
      .sort((a, b) => (a.id < b.id ? 1 : -1)); // date desc
    const aSupprimer = apresEcriture.slice(SNAP_RETENTION);
    if (aSupprimer.length) {
      await Promise.all(aSupprimer.map((d) => d.ref.delete()));
      fnLogger.info(`snapshotMensuel : rétention — ${aSupprimer.length} ancien(s) snapshot(s) supprimé(s) : ` +
        aSupprimer.map((d) => d.id).join(', '));
    }
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
      erreursDetail: stats.erreurs.slice(0, 200), // même patron que skipsNoForm
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
