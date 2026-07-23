// Récupération de la fiche « État des renseignements » d'une entreprise au
// Registraire des entreprises du Québec (REQ), par NEQ.
//
// ⚠️  RÉALITÉ MESURÉE (fixtures test_req.html vs stealth_req_*.html) :
//   Le site est derrière un challenge **Cloudflare « managed »**. Un `fetch()`
//   nu récupère la page « Just a moment… » (JS + cookies exigés), PAS les
//   données. Il faut donc un **vrai navigateur** (Playwright/Chromium, préinstallé
//   ici) — d'où le préfixe « stealth » des captures. De plus, l'accès à l'« État
//   des renseignements » d'une personne morale passe par un **flux multi-étapes**
//   avec jeton anti-forgery (__RequestVerificationToken) :
//
//     1. GET  /…/GR03A71                          → page « Rechercher une entreprise »
//     2. POST /…/GR03A71/RechercheParEntreprise/Rechercher
//              Domaines=1 (NEQ), Types=2, Etendues=4 (Tous),
//              Objet=<NEQ>, ConditionUtilisationCochee=true, __RequestVerificationToken
//     3. Dans les résultats, ouvrir le dossier → page « État des renseignements ».
//
//   Ce flux N'A PAS pu être exécuté ici : la politique réseau de l'environnement
//   refuse le domaine REQ (403 au CONNECT). fetchReqBrowser() ci-dessous est donc
//   écrit d'après les formulaires observés mais **reste à valider en local**, là
//   où le host est joignable. Le parseur (extractReq/transformReq), lui, est
//   validé sur fixture réelle — c'est le cœur stable.

export const BASE = 'https://www.registreentreprises.gouv.qc.ca';
export const RECHERCHE_ENTREPRISE_PATH =
  '/REQNA/GR/GR03/GR03A71.RechercheRegistre.MVC/GR03A71';

// Signature de la page de challenge Cloudflare (pour ne jamais confondre une
// interception anti-bot avec une vraie fiche).
export function estChallengeCloudflare(html) {
  return typeof html === 'string'
    && (/Just a moment/i.test(html) || /challenge-platform/i.test(html));
}

// Signature d'une vraie fiche « État des renseignements ».
export function estEtatRenseignements(html) {
  return typeof html === 'string' && /id="etatRenseignements"/i.test(html);
}

// --- Chemin « live » via navigateur (Playwright) -------------------------------
//
// À exécuter là où le domaine REQ est joignable. Playwright est importé
// dynamiquement pour que le reste du module (parseur, fixture) fonctionne sans
// lui. Chromium est déjà présent dans l'environnement (PLAYWRIGHT_BROWSERS_PATH).
//
// NB : non validé de bout en bout (réseau bloqué ici) — ajuster les sélecteurs
// de résultat si le site a changé. Renvoie le HTML de la page État, ou lève.
export async function fetchReqBrowser(neq, { timeoutMs = 45000, headless = true } = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    throw new Error(
      "playwright introuvable : `npm i -D playwright` puis relancer en local"
      + ` (Chromium préinstallé). Détail : ${e.message}`,
    );
  }

  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({
      locale: 'fr-CA',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        + ' (KHTML, like Gecko) Chrome/120 Safari/537.36',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    // 1. Page de recherche d'entreprise (laisse Cloudflare résoudre son challenge).
    await page.goto(`${BASE}${RECHERCHE_ENTREPRISE_PATH}`, { waitUntil: 'networkidle' });

    // 2. Recherche par NEQ (Objet = NEQ) + acceptation des conditions.
    await page.fill('#Objet', String(neq));
    await page.check('#ConditionUtilisationCochee');
    await Promise.all([
      page.waitForLoadState('networkidle'),
      page.click('button[type="submit"]'),
    ]);

    // 3. Ouvrir le premier dossier des résultats → « État des renseignements ».
    //    Sélecteur à confirmer sur le vrai rendu des résultats (lien du dossier).
    const lienDossier = page.locator('a[href*="EtatRenseignements"], #resultatRecherche a').first();
    if (await lienDossier.count()) {
      await Promise.all([
        page.waitForLoadState('networkidle'),
        lienDossier.click(),
      ]);
    }

    const html = await page.content();
    if (estChallengeCloudflare(html)) {
      throw new Error('bloqué par Cloudflare (challenge non résolu) — réessayer en mode non-headless.');
    }
    if (!estEtatRenseignements(html)) {
      throw new Error("page « État des renseignements » non atteinte (flux de résultats à ajuster).");
    }
    return html;
  } finally {
    await browser.close();
  }
}

// Alias : le point d'entrée « fetch » du module est le navigateur (le seul qui
// franchit Cloudflare). collectReq/scrapeReq passent par ici en mode live.
export const fetchReq = fetchReqBrowser;
