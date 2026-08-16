// Parseur du répertoire des établissements MSSS (M02) — liste + fiche détail.
//
// Site m02.pub.msss.rtss.qc.ca : classic ASP, HTML simple, iso-8859-1 (décoder
// en windows-1252 comme le K10, cf. src/fetch.js). Aucun anti-robot, GET pur.
//
// Cible métier : CHSLD PRIVÉS À BUT LUCRATIF (le filtre vit dans transformM02).

import { load } from 'cheerio';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

// --- Liste (M02ListeEtab.asp) : établissements groupés par région ---------------
// En-tête de région : <a href="#retour" class="titre02">Nom (NN)</a>
// Établissement      : <a href="M02Etablissement.asp?CdIntervSocSan=N">Nom (permis)</a>
export function extractM02List(html) {
  const $ = load(html);
  const etabs = [];
  let region = null;
  $('a').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    if ($el.hasClass('titre02')) {
      region = norm($el.text()) || region;
    } else if (href.includes('M02Etablissement.asp')) {
      const m = href.match(/CdIntervSocSan=(\d+)/);
      const texte = norm($el.text());
      if (m && texte) {
        const np = texte.match(/^(.*?)\s*\((\d{4}-\d{4})\)\s*$/);
        etabs.push({
          cdIntervSocSan: m[1],
          region,
          nom: np ? np[1] : texte,
          numeroPermis: np ? np[2] : null,
        });
      }
    }
  });
  return etabs;
}

// --- Fiche détail (M02Etablissement.asp?CdIntervSocSan=N) ------------------------
// Paires libellé/valeur : <span class="titreColonne">Libellé</span> dans un <td>,
// valeur dans le <td> voisin.
export function extractM02Detail(html, meta = {}) {
  const $ = load(html);

  const champ = (label) => {
    let val = null;
    $('span.titreColonne').each((_, el) => {
      if (val != null) return;
      if (norm($(el).text()) === label) {
        val = norm($(el).closest('td').next('td').text()) || null;
      }
    });
    return val;
  };

  // Capacité : ligne « <MISSION> N Lit(s) … » (ex. « CHSLD 66 Lit(s) d'hébergement… »).
  let capacite = null;
  $('td').each((_, el) => {
    if (capacite) return;
    const t = norm($(el).text());
    if (/^[A-Za-zÀ-ÿ]+\s+\d+\s+Lit\(s\)/.test(t)) capacite = t;
  });

  const installations = [];
  $('a[href*="M02Installation.asp"]').each((_, el) => {
    const t = norm($(el).attr('title') || $(el).text());
    if (t) installations.push(t);
  });

  return {
    cdIntervSocSan: meta.cdIntervSocSan ?? null,
    numeroPermis: champ('Numéro de permis'),
    nomLegal: champ('Nom légal'),
    nomAbrege: champ('Nom abrégé'),
    adresse: champ('Adresse'),
    municipalite: champ('Municipalité'),
    codePostal: champ('Code postal'),
    telephone: champ('Téléphone'),
    regionSociosanitaire: champ('Région sociosanitaire'),
    statut: champ('Statut'),
    loi: champ('Loi'),
    modeConstitution: champ('Mode de constitution'),
    modeFinancement: champ('Mode de financement'),
    mission: champ('Mission(s)'),
    capacite,
    installations,
    caHref: $('a[href*="M07ConsMembCa.asp"]').attr('href') || null,
  };
}
