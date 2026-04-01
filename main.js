const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const path = require('path');
const fs = require('fs');
const { scanReceipt } = require('./utils/scanner');
const { validateTitle } = require('./utils/helpers');

const scrapersDir = path.join(__dirname, 'scrapers');
const scrapers = {};
if (fs.existsSync(scrapersDir)) {
  fs.readdirSync(scrapersDir).forEach(file => {
    if (file.endsWith('.js')) scrapers[file.replace('.js', '')] = require(path.join(scrapersDir, file));
  });
}

(async () => {
  console.log('⚡ COMPARATEUR IA DÉMARRÉ\n');
  const imagePath = path.join(__dirname, 'ticket.jpg');

  const articles = await scanReceipt(imagePath);
  if (articles.length === 0) return console.log("❌ Aucun article trouvé.");

  console.log('\n📋 PANIER DÉTECTÉ :');
  console.table(articles);

  const browser = await chromium.launch({ headless: true });

  for (const item of articles) {
    console.log(`\n🔎 Recherche : "${item.nom}" (${item.prix}€)`);
    const results = {};

    for (const [name, scraperFn] of Object.entries(scrapers)) {
      try {
        const res = await scraperFn(browser, item.nom);
        if (res.status === 'found' && validateTitle(res.product.titre, item.nom)) {
          results[name] = {
            titre: res.product.titre,
            prix: parseFloat(res.product.prix.replace(',', '.'))
          };
        }
      } catch (e) { console.log(`   ⚠️ Erreur scraper ${name}`); }
    }

    const magasins = Object.keys(results);
    if (magasins.length > 0) {
      const pTicket = parseFloat(item.prix.replace(',', '.'));
      const sorted = magasins.sort((a, b) => results[a].prix - results[b].prix);
      const best = results[sorted[0]];
      console.log(`   🏆 Meilleur : ${sorted[0].toUpperCase()} (${best.prix.toFixed(2)}€)`);
      if (best.prix < pTicket) console.log(`   💡 GAIN : -${(pTicket - best.prix).toFixed(2)}€`);
    } else {
      console.log(`   ❌ Non trouvé ailleurs.`);
    }
  }

  await browser.close();
})();