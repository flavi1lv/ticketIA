const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');
const fs = require('fs');
const { scanReceipt } = require('./utils/scanner');

const IGNORED_SCRAPERS = ['auchan.js']; 

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
    if (item.prix === null || item.prix === undefined) continue;
    
    const pTicket = parseFloat(String(item.prix).replace(',', '.'));
    if (isNaN(pTicket)) continue;
    
    totalOriginal += pTicket;

    console.log(`\n🔎 Recherche : "${item.nom}" (${pTicket.toFixed(2)}€)`);
    const results = {};

    const promises = Object.entries(scrapers).map(async ([name, scraperFn]) => {
      try {
        // 🚀 MODIF : On envoie pTicket au scraper pour activer le bonus de score !
        const res = await scraperFn(browser, item.nom, pTicket);
        
        if (res && res.status === 'found') {
          let pScraped = parseFloat(String(res.product.prix).replace(',', '.'));
          
          // ⚖️ LOGIQUE POIDS
          const weightMatch = item.nom.match(/(\d+[.,]\d+)\s*kg/i);
          if (weightMatch && res.product.isKg) {
            const weight = parseFloat(weightMatch[1].replace(',', '.'));
            pScraped = pScraped * weight;
          }

          const diff = Math.abs(pScraped - pTicket) / pTicket;
          
          // 🍎 MODIF : Tolérance spéciale pour le frais (Vrac/Légumes)
          const isFrais = /(POIREAU|POIVRON|ORANGE|BANANE|VRAC|KG)/i.test(item.nom);
          const maxAllowedDiff = isFrais ? 1.50 : 0.40;

          if (diff <= maxAllowedDiff) {
            results[name] = { prix: pScraped, titre: res.product.titre };
            console.log(`   ✅ [${name}] Trouvé: ${res.product.titre} à ${pScraped.toFixed(2)}€`);
          } else {
            console.log(`   ⚠️ [${name}] Rejeté: Écart trop grand (${(diff*100).toFixed(0)}%)`);
          }
        } else {
            console.log(`   ❌ [${name}] Introuvable`);
        }
      } catch (e) { console.log(`   ❌ Erreur ${name}: ${e.message}`); }
    });

    await Promise.all(promises);

    Object.keys(scrapers).forEach(n => {
      totaux[n] += results[n] ? results[n].prix : pTicket;
    });
  }

  await browser.close();
  console.log(`\n============================`);
  console.log(`TOTAL TICKET: ${totalOriginal.toFixed(2)}€`);
  Object.entries(totaux).forEach(([m, t]) => console.log(`${m.toUpperCase()}: ${t.toFixed(2)}€`));
  console.log(`============================\n`);
};

runComparator(path.join(__dirname, 'ticket.jpg'));