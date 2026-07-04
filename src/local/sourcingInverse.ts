import { Firestore } from '@google-cloud/firestore';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { pathToFileURL } from 'url';
import { parserHTMLAdministrateurs } from './parsers/reqParser';

puppeteer.use(StealthPlugin());

const db = new Firestore({ projectId: 'primexpert-msss-registre' });

// codesRegions : si fourni (ex. ['04']), on ne traite que ces régions (mode
// quotidien aligné sur le collecteur). Sinon : balayage complet de la base.
export async function executerSourcingInverseLocal({ codesRegions = null }: { codesRegions?: string[] | null } = {}) {
  console.log("⚡ Démarrage du pipeline de sourcing REQ LOCAL sur /Volumes/SAUVEGARDE GRIS/03_WEBSCRAPPER");

  // 1. Extraction des fiches à traiter.
  let query: FirebaseFirestore.Query = db.collection('residences');
  if (codesRegions && codesRegions.length) {
    // Firestore 'in' accepte jusqu'à 10 valeurs (les jours de calendrier en ont ≤5).
    query = query.where('_regionCdRSS', 'in', codesRegions);
    console.log(`🎯 Périmètre : région(s) ${codesRegions.join(', ')} (mode quotidien).`);
  } else {
    query = query.where('section2_titulaires.personneMorale.neqNormalise', '!=', '');
    console.log('🌐 Périmètre : base complète.');
  }
  const snapshot = await query.get();

  console.log(`📋 ${snapshot.size} fiches dans le périmètre.`);

  if (snapshot.empty) return;

  // BASE DE CACHE REQ POUR CETTE SESSION
  const cacheAdministrateurs = new Map<string, { admins: any[], status: string, erreur?: string }>();

  // 2. Initialisation d'une SEULE instance de navigateur pour tout le lot
  const browser = await puppeteer.launch({ 
    headless: true,
    channel: 'chrome' // Utilise le Chrome local (souvent plus furtif que Chromium embarqué)
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const REQ_RECHERCHE_URL = 'https://www.registreentreprises.gouv.qc.ca/REQNA/GR/GR03/GR03A71.RechercheRegistre.MVC/GR03A71';

  for (const doc of snapshot.docs) {
    const fichesData = doc.data();
    const neq = fichesData.section2_titulaires?.personneMorale?.neqNormalise;
    const nomResidence = fichesData.section1_identification?.nomResidence || `Fiche ID: ${doc.id}`;

    // Sans NEQ : rien à chercher au REQ (le filtre région ne l'écarte pas en amont).
    if (!neq) continue;

    // Idempotence : On saute si le palier 1 REQ est déjà enregistré [Charte §II]
    if (fichesData.enrichissement?.sourcingInverse?.status === 'REQ_DONE') {
      console.log(`⏩ [IDEMPOTENCE] NEQ ${neq} (${nomResidence}) déjà traité. Skip.`);
      continue;
    }

    // 2. OPTIMISATION MULTI-SITE : Vérification du cache local
    if (neq && cacheAdministrateurs.has(neq)) {
      const cacheHit = cacheAdministrateurs.get(neq)!;
      console.log(`⚡ [CACHE HIT TOTAL] Réutilisation du statut [${cacheHit.status}] pour le doublon : ${neq} (${nomResidence})`);
      
      await db.collection('residences').doc(doc.id).update({
        'enrichissement.sourcingInverse': {
          status: cacheHit.status,
          updatedAt: new Date().toISOString(),
          administrateurs: cacheHit.admins,
          ...(cacheHit.erreur ? { erreur: cacheHit.erreur } : {})
        }
      });
      continue; // On passe à la fiche suivante sans ouvrir internet !
    }

    console.log(`🔍 [REQ LIVE] Traitement : ${nomResidence} | NEQ: ${neq}`);

    const MAX_RETRIES = 2;
    let success = false;

    for (let tentative = 1; tentative <= MAX_RETRIES && !success; tentative++) {
      try {
        // Navigation vers le portail de recherche
        await page.goto(REQ_RECHERCHE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        
        // Attendre le défi CloudFront/Cloudflare éventuel puis le formulaire NEQ
        await page.waitForSelector('#Objet', { timeout: 90000 });

        // 🧹 VIDER le champ avant de taper pour éviter la concaténation (ex: 11410160721141016072)
        await page.evaluate(() => {
          const input = document.getElementById('Objet') as HTMLInputElement | null;
          if (input) input.value = '';
        });

        await page.type('#Objet', neq, { delay: 30 });

        // Cocher la case des conditions d'utilisation
        await page.evaluate(() => {
          const checkbox = document.getElementById('ConditionUtilisationCochee') as HTMLInputElement | null;
          if (checkbox && !checkbox.checked) checkbox.click();
        });

        // Attente de la navigation et du chargement de la fiche
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }),
          page.click('button[type="submit"]'),
        ]);

        // Extraction du HTML rendu
        const htmlRendu = await page.content();
        
        // Extraction via notre parser Cheerio validé
        const admins = parserHTMLAdministrateurs(htmlRendu);

        // Sécurité : Si 0 admin, on marque A_REVISER
        if (admins.length === 0) {
          console.log(`⚠️ [REQ VIDE] Aucun admin extrait pour le NEQ ${neq}. Marquage A_REVISER.`);
          
          // ON ENREGISTRE L'ÉCHEC DANS LE CACHE MEMOIRE pour éviter le pilonnage
          if (neq) cacheAdministrateurs.set(neq, { admins: [], status: 'A_REVISER', erreur: '0 admins extraits en live' });

          await db.collection('residences').doc(doc.id).update({
            'enrichissement.sourcingInverse': {
              status: 'A_REVISER',
              updatedAt: new Date().toISOString(),
              erreur: '0 admins extraits en live',
              administrateurs: []
            }
          });
          success = true; // Fin des retries pour cette fiche
          continue;
        }

        // Mettre en cache pour les prochaines fiches partageant ce NEQ
        if (neq) cacheAdministrateurs.set(neq, { admins, status: 'REQ_DONE' });

        // Écriture incrémentale Firestore sans écraser le reste [Charte §IV]
        await db.collection('residences').doc(doc.id).update({
          'enrichissement.sourcingInverse': {
            status: 'REQ_DONE', // Forcément > 0 ici
            updatedAt: new Date().toISOString(),
            administrateurs: admins
          }
        });

        console.log(`✅ [FIRESTORE] ${nomResidence} mis à jour (${admins.length} admins trouvés).`);
        success = true;

        // PAUSE STRATÉGIQUE (Anti-Ban) : Entre 3 et 5 secondes de manière aléatoire
        const tempsPause = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
        await new Promise(resolve => setTimeout(resolve, tempsPause));

      } catch (error) {
        console.error(`⚠️ [TENTATIVE ${tentative}/${MAX_RETRIES}] Échec pour la fiche ${nomResidence} (NEQ: ${neq})`);
        
        if (tentative === MAX_RETRIES) {
          console.error(`❌ [ERREUR BATCH] Abandon pour ${nomResidence} après ${MAX_RETRIES} tentatives.`);
          // Règle Fail-safe : Marquage sans inventer de données [Charte §III]
          await db.collection('residences').doc(doc.id).update({
            'enrichissement.sourcingInverse.status': 'A_REVISER',
            'enrichissement.sourcingInverse.erreur': `Timeout ou echec de redirection REQ (${MAX_RETRIES} tentatives)`
          });
        } else {
          // Pause plus longue avant de retenter pour laisser le temps au navigateur et à Cloudflare de retomber
          await new Promise(resolve => setTimeout(resolve, 8000));
        }
      }
    }
  }

  // Fermeture propre du navigateur à la fin du lot
  await browser.close();
  console.log("🏁 Pipeline de sourcing REQ terminé avec succès.");
}

// Auto-exécution (balayage complet) SEULEMENT si lancé directement, jamais à
// l'import — sinon importer ce module depuis sourcingQuotidien déclencherait
// un scrape involontaire.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  executerSourcingInverseLocal();
}
