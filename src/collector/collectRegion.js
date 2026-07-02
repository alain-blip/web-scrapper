// Collecte d'UNE région (cdRSS) : recherche → fiches → extract+transform.
//
// Réutilise STRICTEMENT le parseur validé (fetch/extract/transform), sans le
// modifier (Règle #0). N'écrit pas lui-même : il appelle un callback `writeFiche`
// (Firestore en prod, console en mesure locale).
//
// Scraping doux : délai configurable entre chaque requête + détection de vrai
// blocage par canary (voir plus bas — un skip individuel ne suffit pas comme
// signal : un noForm bidon jamais sollicité rend la même page octet pour octet
// qu'une vraie fiche non consultable, donc le contenu seul ne discrimine pas).

import { fetchFiche } from '../fetch.js';
import { extract } from '../extract.js';
import { transform } from '../transform.js';
import { chercherRegion } from './regionSearch.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Passé explicitement à fetchFiche (au lieu du défaut implicite de fetch.js)
// pour que le libellé « timeout (Xms) » ci-dessous soit toujours exact.
const FETCH_TIMEOUT_MS = 30000;

// Fiche stable de référence pour le canary de blocage réel (Murray, validée
// 142/142, toujours active) — jamais un ID de collecte, seulement une sonde
// « le serveur sert-il encore du contenu valide ? ».
const CANARY_NOFORM = '395';
const CANARY_APRES_N_SKIPS = 20;

// Une vraie fiche détail contient l'ancre de section 1 ; sinon c'est une
// redirection accueil / page « Objet déplacé » / fiche non consultable — ou,
// tout aussi bien, un noForm légitimement fermé/inexistant (~60 % du registre,
// le K10 indexe plus qu'il ne rend consultable). Le contenu seul ne distingue
// PAS les deux cas : c'est pourquoi ceci n'est plus utilisé pour décider d'un
// arrêt, seulement pour journaliser un skip et vérifier le canary.
function estDetailValide(html) {
  return typeof html === 'string' && /name="lien_1"/i.test(html);
}

// Message d'erreur exploitable : distingue timeout / échec réseau (cause réelle
// masquée par défaut derrière « fetch failed ») / HTTP. Plafonné à 300 caractères,
// même précaution que htmlExcerpt (F8/F9) — filet de sécurité Loi 25 même si aucun
// throw actuel n'embarque de contenu de fiche (extract.js ne lève jamais).
function detailErreur(e) {
  if (e.name === 'AbortError') return `timeout (${FETCH_TIMEOUT_MS}ms)`;
  if (e.cause?.message) return `${e.message}: ${e.cause.message}`;
  return e.message;
}

/**
 * @param {string} cdRSS
 * @param {object} opts
 * @param {(fiche:object, meta:object)=>Promise<void>} opts.writeFiche
 * @param {number} [opts.throttleMs=1500]
 * @param {number} [opts.canaryApresNSkips=20]  vérifie le canary tous les N skips consécutifs
 * @param {number} [opts.maxFiches]        limite (mesure locale)
 * @param {(p:object)=>void} [opts.onProgress]
 * @param {(m:string)=>void} [opts.logger]
 * @param {typeof fetchFiche} [opts.fetchFicheFn]      injectable pour les tests offline
 * @param {typeof chercherRegion} [opts.chercherRegionFn]  injectable pour les tests offline
 */
export async function collectRegion(cdRSS, opts = {}) {
  const {
    writeFiche,
    throttleMs = 1500,
    canaryApresNSkips = CANARY_APRES_N_SKIPS,
    maxFiches = Infinity,
    onProgress = () => {},
    logger = () => {},
    fetchFicheFn = fetchFiche,
    chercherRegionFn = chercherRegion,
  } = opts;

  const debut = Date.now();
  const stats = {
    cdRSS,
    nbListe: 0,
    nbVues: 0,
    nbEcrites: 0,
    nbErreurs: 0,
    skips: [],          // Registres non consultables (accueil/redirection/dead)
    erreurs: [],        // { noForm, message } erreurs réseau/parsing
    bloque: false,
    statut: 'ok',
  };

  // 1. Lister la région
  const recherche = await chercherRegionFn(cdRSS).catch((e) => {
    stats.erreurs.push({ noForm: null, message: `recherche: ${detailErreur(e)}`.slice(0, 300) });
    return { bloque: false, residences: [] };
  });
  if (recherche.bloque) {
    stats.bloque = true;
    stats.statut = 'bloque';
    stats.dureeMs = Date.now() - debut;
    // F9 : rattaché à stats (pas seulement au message logger) pour survivre à la
    // requête et être persisté dans _collectionLog — la preuve du faux-positif/
    // soft-block est alors dans le doc de collecte qu'on lit déjà.
    stats.htmlExcerpt = recherche.htmlExcerpt || null;
    // F8 : log l'extrait HTML pour traçabilité faux-positif (voir regionSearch.js).
    logger(`[${cdRSS}] recherche bloquée (redirection accueil détectée).`
      + (recherche.htmlExcerpt ? ` Extrait : ${recherche.htmlExcerpt}` : ''));
    return stats;
  }
  stats.nbListe = recherche.residences.length;
  logger(`[${cdRSS}] ${stats.nbListe} résidence(s) listée(s).`);

  // 2. Récupérer chaque fiche (noForm == Registre)
  //
  // Un skip individuel (ancre lien_1 absente) ne compte JAMAIS seul vers un
  // arrêt : ~60 % du registre est légitimement non consultable (K10 indexe
  // plus qu'il ne rend consultable), et un noForm bidon jamais sollicité rend
  // la même page, octet pour octet, qu'une vraie fiche bloquée — le contenu
  // seul ne discrimine pas. Le seul signal de vrai blocage : un canary (fiche
  // stable connue) qui cesse lui-même de charger.
  let skipsConsecutifs = 0;
  for (const r of recherche.residences) {
    if (stats.nbVues >= maxFiches) { stats.statut = 'partiel'; break; }
    await sleep(throttleMs);
    stats.nbVues += 1;

    let html;
    try {
      html = await fetchFicheFn(r.registre, { timeoutMs: FETCH_TIMEOUT_MS });
    } catch (e) {
      stats.nbErreurs += 1;
      stats.erreurs.push({ noForm: r.registre, message: detailErreur(e).slice(0, 300) });
      skipsConsecutifs = 0;
      continue;
    }

    if (!estDetailValide(html)) {
      stats.skips.push(r.registre);
      skipsConsecutifs += 1;
      // F7 : log explicite de chaque skip pour traçabilité (ancre lien_1 absente).
      logger(`[${cdRSS}] skip noForm=${r.registre} — ancre lien_1 absente`
        + ` (${skipsConsecutifs} consécutifs — légitime, ne compte pas seul vers un arrêt).`);

      if (skipsConsecutifs % canaryApresNSkips === 0) {
        await sleep(throttleMs);
        let canaryHtml = '';
        try {
          canaryHtml = await fetchFicheFn(CANARY_NOFORM, { timeoutMs: FETCH_TIMEOUT_MS });
        } catch (e) {
          canaryHtml = ''; // pas de réponse exploitable → traité comme un échec canary (fail-safe)
        }
        if (estDetailValide(canaryHtml)) {
          logger(`[${cdRSS}] canary noForm=${CANARY_NOFORM} OK après ${skipsConsecutifs} skips`
            + ` — le serveur sert toujours du contenu valide, on continue.`);
          skipsConsecutifs = 0;
        } else {
          stats.bloque = true;
          stats.statut = 'partiel';
          logger(`[${cdRSS}] ARRÊT : canary noForm=${CANARY_NOFORM} en échec après ${skipsConsecutifs} skips`
            + ` — vrai blocage présumé.`);
          break;
        }
      }
      continue;
    }

    skipsConsecutifs = 0;
    try {
      const fiche = transform(extract(html, { noForm: r.registre }));
      await writeFiche(fiche, { cdRSS, registre: r.registre });
      stats.nbEcrites += 1;
    } catch (e) {
      stats.nbErreurs += 1;
      stats.erreurs.push({ noForm: r.registre, message: `parse/write: ${detailErreur(e)}`.slice(0, 300) });
    }

    if (stats.nbVues % 20 === 0) {
      onProgress({ ...stats, dureeMs: Date.now() - debut });
    }
  }

  if (stats.statut === 'ok' && stats.nbErreurs > 0) stats.statut = 'ok_avec_erreurs';

  // F7 : détection d'un vrai bris structurel (ex. renommage de l'ancre K10, qui
  // casserait estDetailValide() partout). Un taux de skip élevé n'est PAS ce
  // signal — c'est la norme (K10 indexe ~3x le consultable) : Estrie mesurée à
  // 65 % de skip a quand même écrit 34 % de ses fiches. Un vrai bris produit
  // zéro écriture, pas un taux dégradé — c'est la signature qui discrimine.
  //
  // nbVues >= MIN_VUES_SUSPECT (pas nbListe) couvre déjà les régions 17/18
  // (0 résidence attendue, Charte) : nbVues n'incrémente que dans la boucle
  // par-fiche, donc une région vide reste à 0, sous le seuil — jamais suspecte,
  // aucune condition supplémentaire nécessaire.
  //
  // !stats.bloque est impératif : bloque (vrai blocage détecté par le canary)
  // reste strictement prioritaire. Ce label est cosmétique (_collectionLog
  // seulement, aucun consommateur n'agit dessus) ; il ne doit jamais écraser
  // 'partiel' — sinon on dégraderait le signal le plus fort qu'on a en une
  // simple étiquette.
  const MIN_VUES_SUSPECT = 5;
  // tauxSkip : gardé calculé et journalisé (utile en lecture de log), mais
  // n'est plus le déclencheur de 'suspect'.
  stats.tauxSkip = stats.nbVues > 0 ? stats.skips.length / stats.nbVues : 0;
  if (!stats.bloque && stats.nbEcrites === 0 && stats.nbVues >= MIN_VUES_SUSPECT) {
    stats.statut = 'suspect';
    logger(`[${cdRSS}] ALERTE zéro écriture sur ${stats.nbVues} fiches vues`
      + ` (taux skip ${Math.round(stats.tauxSkip * 100)}%) — possible renommage ancre K10.`);
  }

  stats.dureeMs = Date.now() - debut;
  return stats;
}
