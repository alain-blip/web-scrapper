import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const REQ_RECHERCHE_URL =
  'https://www.registreentreprises.gouv.qc.ca/REQNA/GR/GR03/GR03A71.RechercheRegistre.MVC/GR03A71';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface AdministrateurREQ {
  nom: string;
  prenom: string;
  fonction: string;
  adresseResidentielle: string;
}

/**
 * Analyse le HTML rendu par le REQ (structure kx-synthese post-2024).
 * Compatible aussi avec l'ancienne table `.table-resultats-req` si présente.
 */
export function parserHTMLAdministrateurs(html: string): AdministrateurREQ[] {
  const $ = cheerio.load(html);
  const administrateurs: AdministrateurREQ[] = [];

  // Voie moderne : flexibilité totale pour Incs, SEC, Dirigeants, Gestionnaires
  const adminsHeader = $('h4, .titre-section-dirigeant').filter((_, el) => {
    const texte = $(el).text().trim();
    return /Administrateurs|Commandités|Dirigeants|Gestionnaires|Fondés de pouvoir/i.test(texte);
  });

  adminsHeader.each((_, header) => {
    let currentEl = $(header).next();

    while (currentEl.length > 0 && currentEl[0].name.toLowerCase() !== 'h4') {
      if (currentEl[0].name.toLowerCase() === 'ul' && currentEl.hasClass('kx-synthese')) {
        let nom = '';
        let prenom = '';
        let fonction = '';
        let adresse = '';

        currentEl.find('li.kx-display').each((_, li) => {
          const label = $(li).find('.kx-display-label').text().trim();
          const value = $(li).find('.kx-display-field').text().replace(/\s+/g, ' ').trim();

          if (label === 'Nom de famille') nom = value;
          if (label === 'Prénom') prenom = value;
          if (label.includes('Fonctions')) fonction = value;
          if (label.includes('Adresse du domicile')) adresse = value;
          if (
            label.includes('Adresse professionnelle') &&
            (adresse === '' || adresse === 'Adresse non publiable')
          ) {
            adresse = value;
          }
        });

        if (nom && prenom) {
          administrateurs.push({
            nom,
            prenom,
            fonction: fonction || $(header).text().trim(), // Ex: Prendra le nom "Commandités" par défaut
            adresseResidentielle: adresse,
          });
        }
      }
      currentEl = currentEl.next();
    }
  });

  // Voie legacy : table `.table-resultats-req` (mock unitaire / anciennes pages)
  if (administrateurs.length === 0) {
    $('.table-resultats-req tbody tr.ligne-administrateur').each((_, element) => {
      const nomFamille = $(element).find('.col-nom .nom-famille').text().trim();
      const prenom = $(element).find('.col-nom .prenom').text().trim();
      const fonction = $(element).find('.col-fonction .libelle-fonction').text().trim();

      let adresseBrute = $(element).find('.col-adresse').html() || '';
      adresseBrute = adresseBrute.replace(/<br\s*\/?>/gi, ' ');
      const adresseNettoyee = cheerio.load(adresseBrute).text().replace(/\s+/g, ' ').trim();

      if (nomFamille && prenom) {
        administrateurs.push({
          nom: nomFamille,
          prenom,
          fonction: fonction || 'Administrateur',
          adresseResidentielle: adresseNettoyee,
        });
      }
    });
  }

  return administrateurs;
}

/**
 * Contourne CloudFront via navigateur headless (Puppeteer + stealth).
 * Soumet le NEQ sur le formulaire officiel REQNA, récupère le HTML rendu.
 */
export async function extraireAdministrateursREQ(neq: string): Promise<AdministrateurREQ[]> {
  const browser = await puppeteer.launch({
    headless: true,
    channel: 'chrome',
  });
  const page = await browser.newPage();

  try {
    await page.setUserAgent(USER_AGENT);

    await page.goto(REQ_RECHERCHE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Attendre le défi CloudFront éventuel puis le formulaire NEQ
    await page.waitForSelector('#Objet', { timeout: 90000 });

    await page.type('#Objet', neq, { delay: 30 });

    await page.evaluate(() => {
      const checkbox = document.getElementById('ConditionUtilisationCochee') as HTMLInputElement | null;
      if (checkbox && !checkbox.checked) checkbox.click();
    });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }),
      page.click('button[type="submit"]'),
    ]);

    const htmlRendu = await page.content();
    return parserHTMLAdministrateurs(htmlRendu);
  } catch (error) {
    console.error(`[PUPPETEER ERROR] Échec pour le NEQ ${neq}:`, error);
    throw error;
  } finally {
    await browser.close();
  }
}
