// Collecte REQ : enrichit les résidences par NEQ (structure juridique + organes
// de direction) au Registraire des entreprises du Québec.
//
// Calqué sur src/collector/collectRegion.js (Règle #0 : on réutilise le parseur
// unitaire fetchReq/extractReq/transformReq sans le dupliquer). N'écrit pas
// lui-même : appelle un callback `writeReq(section, meta)` (Firestore en prod,
// console en mesure locale) — même patron d'injection que collectRegion.
//
// Scraping doux : throttle configurable + canary de blocage réel (un NEQ stable
// connu qui cesse de charger = vrai blocage, contrairement à un NEQ radié/absent
// qui, lui, est une donnée légitime et non un signal d'arrêt).

import { fetchReq } from './fetchReq.js';
import { extractReq } from './extractReq.js';
import { transformReq } from './transformReq.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FETCH_TIMEOUT_MS = 30000;

// NEQ stable de référence pour le canary — À FIXER sur une entreprise réelle,
// active et pérenne, une fois une fixture validée (le rôle est identique au
// CANARY_NOFORM=395 du K10 : sonder « le serveur sert-il encore du contenu ? »).
const CANARY_NEQ = null; // TODO(fixture)
const CANARY_APRES_N_ECHECS = 10;

function detailErreur(e) {
  if (e.name === 'AbortError') return `timeout (${FETCH_TIMEOUT_MS}ms)`;
  if (e.cause?.message) return `${e.message}: ${e.cause.message}`;
  return e.message;
}

/**
 * @param {string[]} neqs   liste de NEQ à enrichir (déjà normalisés en amont)
 * @param {object} opts
 * @param {(section:object, meta:object)=>Promise<void>} opts.writeReq
 * @param {number} [opts.throttleMs=1500]
 * @param {number} [opts.maxFiches]
 * @param {(p:object)=>void} [opts.onProgress]
 * @param {(m:string)=>void} [opts.logger]
 * @param {typeof fetchReq} [opts.fetchReqFn]   injectable pour les tests offline
 */
export async function collectReq(neqs, opts = {}) {
  const {
    writeReq,
    throttleMs = 1500,
    maxFiches = Infinity,
    onProgress = () => {},
    logger = () => {},
    fetchReqFn = fetchReq,
  } = opts;

  const debut = Date.now();
  const stats = {
    nbListe: neqs.length,
    nbVues: 0,
    nbEcrites: 0,
    nbIncomplets: 0,   // fiche récupérée mais parseur non calé / fiche vide
    nbErreurs: 0,
    erreurs: [],       // { neq, message }
    bloque: false,
    statut: 'ok',
  };

  let echecsConsecutifs = 0;

  for (const neq of neqs) {
    if (stats.nbVues >= maxFiches) { stats.statut = 'partiel'; break; }
    await sleep(throttleMs);
    stats.nbVues += 1;

    let html;
    try {
      html = await fetchReqFn(neq, { timeoutMs: FETCH_TIMEOUT_MS });
    } catch (e) {
      stats.nbErreurs += 1;
      stats.erreurs.push({ neq, message: detailErreur(e).slice(0, 300) });
      echecsConsecutifs += 1;
      // Canary : après N échecs consécutifs, on vérifie qu'un NEQ stable charge
      // encore. S'il échoue aussi → vrai blocage, on s'arrête (pas de martèlement).
      if (CANARY_NEQ && echecsConsecutifs % CANARY_APRES_N_ECHECS === 0) {
        await sleep(throttleMs);
        const vivant = await fetchReqFn(CANARY_NEQ, { timeoutMs: FETCH_TIMEOUT_MS })
          .then((h) => typeof h === 'string' && h.length > 0)
          .catch(() => false);
        if (!vivant) {
          stats.bloque = true;
          stats.statut = 'partiel';
          logger(`ARRÊT : canary NEQ=${CANARY_NEQ} en échec après ${echecsConsecutifs}`
            + ' échecs — vrai blocage présumé.');
          break;
        }
        echecsConsecutifs = 0;
      }
      continue;
    }
    echecsConsecutifs = 0;

    try {
      const section = transformReq(extractReq(html, { neq }));
      await writeReq(section, { neq });
      stats.nbEcrites += 1;
      if (section._incomplete) stats.nbIncomplets += 1;
    } catch (e) {
      stats.nbErreurs += 1;
      stats.erreurs.push({ neq, message: `parse/write: ${detailErreur(e)}`.slice(0, 300) });
    }

    if (stats.nbVues % 20 === 0) {
      onProgress({ ...stats, dureeMs: Date.now() - debut });
    }
  }

  if (stats.statut === 'ok' && stats.nbErreurs > 0) stats.statut = 'ok_avec_erreurs';

  // Signature d'un bris structurel (ex. refonte du balisage REQ, ou stub jamais
  // câblé) : on récupère du HTML mais RIEN n'est extractible → tout _incomplete.
  // Même logique que le 'suspect' du K10 : zéro contenu utile, pas un simple taux.
  const MIN_VUES_SUSPECT = 5;
  const nbExploitables = stats.nbEcrites - stats.nbIncomplets;
  if (!stats.bloque && nbExploitables === 0 && stats.nbVues >= MIN_VUES_SUSPECT) {
    stats.statut = 'suspect';
    logger(`ALERTE : ${stats.nbVues} fiches vues, 0 exploitable`
      + ' — parseur REQ non calé (stub) ou refonte du balisage.');
  }

  stats.dureeMs = Date.now() - debut;
  return stats;
}
