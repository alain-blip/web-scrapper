import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('https://www.registreentreprises.gouv.qc.ca/REQNA/GR/GR03/GR03A71.RechercheRegistre.MVC/GR03A71', { waitUntil: 'networkidle2' });
  
  await page.type('#Objet', '1141016072');
  await page.evaluate(() => { document.getElementById('ConditionUtilisationCochee').click(); });
  
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('button[type="submit"]')
  ]);
  
  const html = await page.content();
  fs.writeFileSync('stealth_req_result.html', html);
  console.log('Final URL:', page.url());
  console.log('Length:', html.length);
  if (html.includes('table-resultats-req') || html.includes('CHETIOUI') || html.includes('ligne-administrateur') || html.includes('Château Pierrefonds') || html.includes('Administrateurs')) {
    console.log('✅ Structure trouvée dans les résultats !');
  } else {
    console.log('❌ Échec.');
  }
  await browser.close();
})();