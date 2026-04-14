const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');
const fs = require('fs');
const { scanReceipt } = require('./utils/scanner');

const IGNORED_SCRAPERS = ['leclerc.js'];

// Tolérance de 25% sur l'écart de prix
const MATCH_THRESHOLD = 0.25; 

const loadScrapers = () => {
  const scrapersDir = path.join(__dirname, 'scrapers');
  const loaded = {};
  if (fs.existsSync(scrapersDir)) {
    fs.readdirSync(scrapersDir).forEach(file => {
      if (file.endsWith('.js') && !IGNORED_SCRAPERS.includes(file)) {
        loaded[file.replace('.js', '')] = require(path.join(scrapersDir, file));
      }
    });
  }
  return loaded;
};

const runComparator = async (imagePath) => {
  const scrapers = loadScrapers();
  const articles = await scanReceipt(imagePath);
  if (!articles.length) return;

  console.table(articles);
  const browser = await chromium.launch({ headless: true });

  let totalOriginal = 0;
  const totaux = {};
  Object.keys(scrapers).forEach(n => totaux[n] = 0);

  for (const item of articles) {
    if (item.prix_total === null || item.prix_total === undefined) continue;
    
    const pTicket = parseFloat(String(item.prix_total).replace(',', '.'));
    if (isNaN(pTicket)) continue;
    
    totalOriginal += pTicket;

    console.log(`\n🔎 Recherche : "${item.recherche_optimisee}" (${pTicket.toFixed(2)}€)`);
    const results = {};

    const promises = Object.entries(scrapers).map(async ([name, scraperFn]) => {
      try {
        const res = await scraperFn(browser, item, pTicket);
        
        if (res && res.status === 'found') {
          let pScraped = parseFloat(String(res.product.prix).replace(',', '.'));
          
          // 🎯 CALCUL DE L'ÉCART
          const diff = Math.abs(pScraped - pTicket) / pTicket;
          
          if (diff <= MATCH_THRESHOLD) { 
            results[name] = { prix: pScraped, titre: res.product.titre };
            console.log(`   ✅ [${name}] Validé: ${res.product.titre} à ${pScraped.toFixed(2)}€`);
          } else {
            console.log(`   ⚠️ [${name}] Rejeté: Écart de prix (${(diff*100).toFixed(1)}%). Trouvé à ${pScraped.toFixed(2)}€`);
          }
        } else {
            console.log(`   ❌ [${name}] Introuvable sur le site`);
        }
      } catch (e) { console.log(`   ❌ Erreur ${name}: ${e.message}`); }
    });

    await Promise.all(promises);

    // Si on n'a rien trouvé, on garde le prix du ticket
    Object.keys(scrapers).forEach(n => {
      totaux[n] += results[n] ? results[n].prix : pTicket;
    });
  }

  await browser.close();
  console.log(`\n============================`);
  console.log(`TOTAL TICKET ORIGINE: ${totalOriginal.toFixed(2)}€`);
  Object.entries(totaux).forEach(([m, t]) => {
    const eco = totalOriginal - t;
    console.log(`${m.toUpperCase()}: ${t.toFixed(2)}€ ${eco > 0 ? `(Économie: ${eco.toFixed(2)}€ 📉)` : ''}`);
  });
  console.log(`============================\n`);
};

runComparator(path.join(__dirname, 'ticket.jpg'));