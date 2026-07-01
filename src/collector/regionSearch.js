// Liste les résidences d'une région (cdRSS) via le moteur de recherche du site.
//
// Les résultats ne contiennent que des liens « K10ConsFormAbg.asp?Registre=N ».
// Pour les fiches consultables, noForm == Registre (vérifié), donc on renvoie
// directement le numéro à utiliser comme noForm.

import * as cheerio from 'cheerio';
import { BASE, decodeCp1252 } from '../fetch.js';

function searchUrl(cdRSS) {
  return `${BASE}/public/K10FormRecherche.asp`
    + `?hidPasseParFormulaireRecherche=1&cert=&act=Rechercher&cdRSS=${encodeURIComponent(cdRSS)}`;
}

// Détecte la page d'accueil / redirection (« Objet déplacé ») = soft-block.
function estAccueil(html) {
  return /Objet d[ée]plac|K10accueil\.asp/i.test(html) && !/name="lien_1"/i.test(html)
    && !/act=Rechercher/i.test(html);
}

// Renvoie { bloque, residences:[{registre, nom, municipalite}] }.
export async function chercherRegion(cdRSS, { timeoutMs = 40000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let html;
  try {
    const res = await fetch(searchUrl(cdRSS), { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur la recherche ${cdRSS}`);
    html = decodeCp1252(Buffer.from(await res.arrayBuffer()));
  } finally {
    clearTimeout(t);
  }

  // F8 : si blocage détecté, conserver un extrait du HTML pour traçabilité
  // (distinguer un vrai soft-block d'un faux positif dû à un changement de page).
  if (estAccueil(html)) {
    // Extraction ciblée des marqueurs diagnostiques — jamais un curseur positionnel
    // qui pourrait glisser dans le corps des tables. Trois patterns :
    //   1. <title> (dans <head>) : « Objet déplacé » sur les redirections IIS.
    //   2. Texte « Objet déplacé » suivi du texte brut jusqu'au prochain tag HTML.
    //   3. URL K10accueil.asp extraite de son attribut href (valeur entre guillemets,
    //      impossible de traverser un <td> ou une valeur nominative).
    const markers = [];
    const mTitle = html.match(/<title[^>]*>([^<]{0,100})<\/title>/i);
    if (mTitle) markers.push(`title:"${mTitle[1].trim()}"`);
    const mObj = html.match(/Objet\s+d[ée]plac[ée][^<]{0,80}/i);
    if (mObj) markers.push(mObj[0].trim());
    const mRef = html.match(/href=["']([^"']*K10accueil\.asp[^"']{0,60})/i);
    if (mRef) markers.push(`href:${mRef[1]}`);
    return {
      bloque: true,
      residences: [],
      htmlExcerpt: (markers.join(' | ') || '(aucun marqueur extrait)').slice(0, 300),
    };
  }
  return { bloque: false, residences: parseResultats(html) };
}

// Parse la page de résultats → [{registre, nom, municipalite}] (testable hors-ligne).
export function parseResultats(html) {
  const $ = cheerio.load(html);
  const parRegistre = new Map();

  $('a[href*="K10ConsFormAbg.asp?Registre="]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/Registre=(\d+)/);
    if (!m) return;
    const registre = m[1];
    const txt = $(a).text().replace(/\s+/g, ' ').trim();
    const row = $(a).closest('tr');
    const cells = row.children('td').toArray().map((td) => $(td).text().replace(/\s+/g, ' ').trim());
    const municipalite = cells.length ? cells[cells.length - 1] : '';
    // le nom est le libellé d'ancre qui n'est ni vide ni le simple numéro
    const nom = (txt && txt !== registre) ? txt : null;

    const prev = parRegistre.get(registre) || { registre, nom: null, municipalite: '' };
    parRegistre.set(registre, {
      registre,
      nom: prev.nom || nom,
      municipalite: prev.municipalite || municipalite,
    });
  });

  return [...parRegistre.values()];
}
