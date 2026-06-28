// Collecte d'UNE région (cdRSS) : recherche → fiches → extract+transform.
//
// Réutilise STRICTEMENT le parseur validé (fetch/extract/transform), sans le
// modifier (Règle #0). N'écrit pas lui-même : il appelle un callback `writeFiche`
// (Firestore en prod, console en mesure locale).
//
// Scraping doux : délai configurable entre chaque requête + back-off si le
// serveur MSSS se met à rediriger vers l'accueil (soft-block anti-scraping).

import { fetchFiche } from '../fetch.js';
import { extract } from '../extract.js';
import { transform } from '../transform.js';
import { chercherRegion } from './regionSearch.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Une vraie fiche détail contient l'ancre de section 1 ; sinon c'est une
// redirection accueil / page « Objet déplacé » / fiche non consultable.
function estDetailValide(html) {
  return typeof html === 'string' && /name="lien_1"/i.test(html);
}

/**
 * @param {string} cdRSS
 * @param {object} opts
 * @param {(fiche:object, meta:object)=>Promise<void>} opts.writeFiche
 * @param {number} [opts.throttleMs=1500]
 * @param {number} [opts.seuilBlocage=10]  arrêt après N redirections consécutives
 * @param {number} [opts.maxFiches]        limite (mesure locale)
 * @param {(p:object)=>void} [opts.onProgress]
 * @param {(m:string)=>void} [opts.logger]
 */
export async function collectRegion(cdRSS, opts = {}) {
  const {
    writeFiche,
    throttleMs = 1500,
    seuilBlocage = 10,
    maxFiches = Infinity,
    onProgress = () => {},
    logger = () => {},
  } = opts;

  const debut = Date.now();
  const stats = {
    cdRSS,
    nbListe: 0,
    nbVues: 0,
    nbEcrites: 0,
    nbErreurs: 0,
    skips: [],          // Registres non consultables (accueil/redirection/dead)
    erreurs: [],        // { registre, msg } erreurs réseau/parsing
    bloque: false,
    statut: 'ok',
  };

  // 1. Lister la région
  const recherche = await chercherRegion(cdRSS).catch((e) => {
    stats.erreurs.push({ registre: null, msg: `recherche: ${e.message}` });
    return { bloque: false, residences: [] };
  });
  if (recherche.bloque) {
    stats.bloque = true;
    stats.statut = 'bloque';
    stats.dureeMs = Date.now() - debut;
    logger(`[${cdRSS}] recherche bloquée (redirection accueil).`);
    return stats;
  }
  stats.nbListe = recherche.residences.length;
  logger(`[${cdRSS}] ${stats.nbListe} résidence(s) listée(s).`);

  // 2. Récupérer chaque fiche (noForm == Registre)
  let blocagesConsec = 0;
  for (const r of recherche.residences) {
    if (stats.nbVues >= maxFiches) { stats.statut = 'partiel'; break; }
    await sleep(throttleMs);
    stats.nbVues += 1;

    let html;
    try {
      html = await fetchFiche(r.registre);
    } catch (e) {
      stats.nbErreurs += 1;
      stats.erreurs.push({ registre: r.registre, msg: e.message });
      blocagesConsec = 0;
      continue;
    }

    if (!estDetailValide(html)) {
      stats.skips.push(r.registre);
      blocagesConsec += 1;
      if (blocagesConsec >= seuilBlocage) {
        stats.bloque = true;
        stats.statut = 'partiel';
        logger(`[${cdRSS}] arrêt : ${blocagesConsec} redirections consécutives (soft-block présumé).`);
        break;
      }
      continue;
    }

    blocagesConsec = 0;
    try {
      const fiche = transform(extract(html, { noForm: r.registre }));
      await writeFiche(fiche, { cdRSS, registre: r.registre });
      stats.nbEcrites += 1;
    } catch (e) {
      stats.nbErreurs += 1;
      stats.erreurs.push({ registre: r.registre, msg: `parse/write: ${e.message}` });
    }

    if (stats.nbVues % 20 === 0) {
      onProgress({ ...stats, dureeMs: Date.now() - debut });
    }
  }

  if (stats.statut === 'ok' && stats.nbErreurs > 0) stats.statut = 'ok_avec_erreurs';
  stats.dureeMs = Date.now() - debut;
  return stats;
}
